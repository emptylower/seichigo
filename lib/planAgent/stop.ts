/**
 * 第十一轮 A3：停止（§0 契约）。"停止"是服务端可识别的一等语义，不是断开
 * 连接——若只断开，服务端会按 client_disconnected 记 interrupted，页面回来
 * 后第八轮的自动续跑会把它续起来。因此：
 * 1. repo.stopAgentRun 原子地清 busy/token、写持久 stopped 运行日志并在
 *    TripPlanRunLive 行写停止标记（跨隔离体可见，不改 schema）；
 * 2. 正在跑的 loop 在下一次 renewLease 失败时结束（现有 RunFencedError 语义）；
 * 3. 模型流式期间由这里的租约看守定期轮询，发现被停止就 abort 模型请求。
 */

import { RUN_STOP_MARKER } from '@/lib/tripPlan/repo'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'

/** 停止标记（L5：权威定义在 lib/tripPlan/repo.ts，这里 re-export 供 agent 层使用） */
export { RUN_STOP_MARKER }

/** 停止证据读取所需的最小 repo 面（2026-09-10 自 loop.ts 抽出的两个助手） */
export type StopEvidenceRepo = Pick<TripPlanRepo, 'getRunLive' | 'listRunLogs'>

/**
 * 停止证据检查（§0 + H2，自 loop.ts 抽出）：token 已不匹配的栅栏/abort
 * 是否因"用户停止"而起。两份证据任一成立即可：实况行停止标记（loop 收尾
 * 前、GET 5 分钟保鲜内），或同 token 的持久 stopped 运行日志（stopAgentRun
 * 落笔，不会被 GET 回收——标记行被并发清掉时 loop 仍能正确归类）。
 */
export async function stopEvidencePresent(
  repo: StopEvidenceRepo,
  planId: string,
  runToken: string | null,
): Promise<boolean> {
  if (!runToken) return false
  try {
    const row = await repo.getRunLive(planId)
    if (row?.runToken === runToken && row.statusText === RUN_STOP_MARKER) return true
  } catch {
    // 读实况失败继续查日志
  }
  try {
    return (await repo.listRunLogs(planId)).some((log) => log.stage === 'stopped' && log.runToken === runToken)
  } catch {
    return false
  }
}

/** H2：stopAgentRun 是否已为本次停止写过持久日志（loop 收尾据此去重） */
export async function stoppedLogExists(
  repo: StopEvidenceRepo,
  planId: string,
  runToken: string | null,
): Promise<boolean> {
  if (!runToken) return false
  try {
    return (await repo.listRunLogs(planId)).some((log) => log.stage === 'stopped' && log.runToken === runToken)
  } catch {
    return false
  }
}

/** 看守 abort 模型请求用的 reason（与 client_disconnected 同一模式） */
export function userStoppedAbort(): DOMException {
  return new DOMException('user_stopped', 'AbortError')
}

/** 判断异常是否"看守触发的 user_stopped abort"（loop 据此走 stopped 收尾） */
export function isUserStoppedAbort(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const candidate = err as { name?: unknown; message?: unknown }
  return candidate.name === 'AbortError' && candidate.message === 'user_stopped'
}

/**
 * 租约看守：模型调用前 start（传入该次模型请求的 AbortController）、调用
 * 返回/抛错后 stop。轮询 check()（默认每 3 秒（L7：与停止承诺的"几秒内
 * 生效"对齐并留出余量），start 时立即查一次），返回
 * true 即 `abort(DOMException('user_stopped','AbortError'))` 并可选回调
 * onStopped。触发一次后自动停表；stop() 后不再触发（check 翻真也无效）。
 * check 抛错按"未停止"处理——停止的主检测路径是 renewLease 的栅栏语义，
 * 看守只是流式期间的加速通道，不能被库抖动干扰。
 */
export function createLeaseWatcher(input: {
  check: () => Promise<boolean>
  intervalMs?: number
  onStopped?: () => void
}): { start(signalController: AbortController): void; stop(): void } {
  const intervalMs = input.intervalMs ?? 3_000
  let timer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  const clearTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  const poll = (signalController: AbortController): void => {
    if (stopped) return
    void (async () => {
      let shouldStop = false
      try {
        shouldStop = await input.check()
      } catch {
        shouldStop = false
      }
      if (!shouldStop || stopped) return
      stopped = true
      clearTimer()
      signalController.abort(userStoppedAbort())
      input.onStopped?.()
    })()
  }

  return {
    start(signalController: AbortController): void {
      if (timer !== null || stopped) return
      poll(signalController)
      timer = setInterval(() => poll(signalController), intervalMs)
    },
    stop(): void {
      stopped = true
      clearTimer()
    },
  }
}
