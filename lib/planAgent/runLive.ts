import type { PlanAgentEvent } from './loop'
import type { TripPlanRepo, TripPlanRunLivePatch } from '@/lib/tripPlan/repo'

/**
 * 第七轮 A1（M1/M2 修订）：运行实况旁路写库（刷新恢复用）。
 *
 * loop 把 onEvent 旁路给 writer；writer 累积 reasoning（整段缓存，落库时由
 * repo 截尾）、最新 statusText 与 toolCalls 列表状态，按"距上次 flush 的
 * 时间 ≥ flushIntervalMs 或新增字符 ≥ flushChars"节流 upsertRunLive——
 * 绝不逐事件写库（DeepSeek reasoning 每秒几十帧，逐帧 upsert 会打爆
 * 数据库）。第九轮 A3 起 reasoning 走增量追加：首次 flush 用
 * reasoningReplace 整段建行，之后每次只发自上次 flush 以来的增量
 * reasoningAppend（repo 侧同 token 追加、20,000 字符截头保尾）。写库失败只
 * warn，绝不影响 SSE 主链路。run 结束时 finish()
 * 强制 flush 最后一份实况再 clearRunLive；被接管（fenced）的 run 传
 * `{ flush: false, clear: false }`——只取消尚未执行的 flush、丢弃未刷新
 * 的增量，不写库（旧 run 用自己的 token 落笔会覆盖新 run 的实况行），
 * 也不 clear（行由接管的新 run 覆盖；读侧还有 runToken 匹配过滤、GET 的
 * agentBusy=false 顺手清理兜底）。
 */

export type RunLiveWriterDeps = {
  repo: Pick<TripPlanRepo, 'upsertRunLive' | 'clearRunLive'>
  planId: string
  runToken: string
  flushIntervalMs?: number
  flushChars?: number
}

export type RunLiveWriter = {
  /** 旁路接收 loop 事件（只消费 reasoning / status / tool_call，其余忽略） */
  onEvent(event: PlanAgentEvent): void
  /**
   * 强制 flush 最后一份实况并 clearRunLive；flush/clear 缺省 true。
   * 被接管的 run 传 `{ flush: false, clear: false }`：丢弃未刷新的增量、
   * 取消排队中的 flush，完全不写库。客户端断开（interrupted）/ 用户停止
   * （stopped）的 run 传 `{ flush: false, clear: true }`：不再写实况（没人
   * 再看），但必须清行——读侧才能区分「在跑」与「被打断」。M4：clear:true
   * 时返回排入 clear 的 chain（等它落定），loop 的 2 秒预算才覆盖到清行。
   */
  finish(options?: { flush?: boolean; clear?: boolean }): Promise<void>
}

const DEFAULT_FLUSH_INTERVAL_MS = 1_500
const DEFAULT_FLUSH_CHARS = 400
/** 内存缓冲上限：远大于落库截尾上限即可，防止超长 run 无界增长 */
const REASONING_BUFFER_MAX = 64_000

export function createRunLiveWriter(deps: RunLiveWriterDeps): RunLiveWriter {
  const flushIntervalMs = deps.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
  const flushChars = deps.flushChars ?? DEFAULT_FLUSH_CHARS

  let reasoning = ''
  let statusText: string | null = null
  const toolCalls = new Map<string, { name: string; status: 'running' | 'done'; summary?: string }>()
  let pendingChars = 0
  let lastFlushAt = Date.now()
  let dirty = false
  let flushQueued = false
  let finished = false
  // M2：fenced 收尾（flush:false）置位——排队中的 flush 到点也不再落库
  let cancelled = false
  // 第九轮 A3：追加语义口径——sentChars 是缓冲里已落库的字符数；首次 flush
  // （或缓冲被截头导致口径失真）用 reasoningReplace 整段重建，之后每次只
  // 发自上次 flush 以来的增量 reasoningAppend，不再整段快照（长 run 的
  // reasoning 累积到几万字符后，每次 flush 全量序列化是 CPU 大头）
  let sentChars = 0
  let firstFlush = true
  // 串行化所有 upsert：浮动 flush 之间不允许交错落库（后写覆盖先写）
  let chain: Promise<void> = Promise.resolve()

  function warn(err: unknown): void {
    console.warn('[planAgent/runLive] 运行实况写库失败（不影响对话）', err)
  }

  function flushNow(): Promise<void> {
    let reasoningPatch: { reasoningReplace?: string; reasoningAppend?: string } = {}
    if (reasoning) {
      if (firstFlush || reasoning.length < sentChars) {
        reasoningPatch = { reasoningReplace: reasoning }
        sentChars = reasoning.length
      } else if (reasoning.length > sentChars) {
        reasoningPatch = { reasoningAppend: reasoning.slice(sentChars) }
        sentChars = reasoning.length
      }
    }
    firstFlush = false
    const patch: TripPlanRunLivePatch = {
      runToken: deps.runToken,
      ...reasoningPatch,
      statusText,
      ...(toolCalls.size ? { toolCalls: [...toolCalls.values()] as TripPlanRunLivePatch['toolCalls'] } : {}),
    }
    return deps.repo.upsertRunLive(deps.planId, patch).then(
      () => undefined,
      (err) => warn(err),
    )
  }

  /**
   * 排队一次 flush。节流状态（dirty/pendingChars/lastFlushAt）在排队时即重置：
   * patch 是全量快照（reasoningReplace 整段缓冲），排队后到达的事件会自然
   * 并进这次或下一次 flush，不会丢；flushQueued 防止同一时刻重复排队。
   */
  function queueFlush(): void {
    if (flushQueued) return
    flushQueued = true
    dirty = false
    pendingChars = 0
    lastFlushAt = Date.now()
    chain = chain.then(() => {
      flushQueued = false
      // M2：收尾已被判定为 fenced（flush:false）——到点的 flush 直接丢弃
      if (cancelled) return
      return flushNow()
    })
  }

  return {
    onEvent(event) {
      if (finished) return
      if (event.type === 'reasoning') {
        reasoning = (reasoning + event.delta).slice(-REASONING_BUFFER_MAX)
        pendingChars += event.delta.length
        dirty = true
      } else if (event.type === 'status') {
        statusText = event.phase
        dirty = true
      } else if (event.type === 'tool_call') {
        toolCalls.set(event.id, {
          name: event.name,
          status: event.status,
          summary: event.status === 'done' ? event.resultSummary : event.argsSummary,
        })
        dirty = true
      } else {
        return
      }
      if (pendingChars >= flushChars || Date.now() - lastFlushAt >= flushIntervalMs) {
        queueFlush()
      }
    },

    async finish(options = {}) {
      const flush = options.flush !== false
      const clear = options.clear !== false
      finished = true
      if (!flush) {
        // 不再写实况（fenced / interrupted）：取消排队中的 flush、丢弃未刷新
        // 的增量。fenced 时绝不以旧 token 落笔覆盖新 run 的实况行
        cancelled = true
        dirty = false
        pendingChars = 0
        if (clear) {
          // interrupted / stopped（第八轮 A1 + M4）：clear 排到 chain 尾部——
          // 在途/排队的 flush 落定（排队的会看到 cancelled 直接跳过）之后再
          // 清行，避免在途 upsert 在 clear 之后落笔复活该行。M4：返回排入
          // clear 的 chain 本身——loop 的 Promise.race 才有机会在 2 秒预算内
          // 等到 clear 完成（fenced 的 clear:false 仍立即返回，旧 run 必须立刻脱身）
          chain = chain.then(async () => {
            try {
              await deps.repo.clearRunLive(deps.planId)
            } catch (err) {
              warn(err)
            }
          })
          return chain
        }
        return
      }
      if (dirty) queueFlush()
      await chain
      if (clear) {
        try {
          await deps.repo.clearRunLive(deps.planId)
        } catch (err) {
          warn(err)
        }
      }
    },
  }
}
