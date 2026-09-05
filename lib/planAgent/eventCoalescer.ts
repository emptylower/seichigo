import type { PlanAgentEvent } from './loop'

/**
 * 第九轮 A2：SSE 事件合并器。
 *
 * 长 run（10 分钟级）里每个 token 一条 reasoning 事件（一回合 3,000+ 条），
 * 每条都要 JSON.stringify + TextEncoder——是 CPU 大头之一。本合并器把
 * reasoning / text 增量按「距上次 flush ≥ flushIntervalMs 或缓冲 ≥
 * flushChars」合并成单条事件再下发；任何其他类型事件（status/tool_call/
 * done/error……）到来时先 flush 缓冲再转发该事件，保证顺序与内容完整。
 * loop 的 emit 全部经此合并器（SSE 与实况 writer 都在合并器之后接收）。
 */

export type EventCoalescerOptions = {
  /** 时间阈值：距上次 flush 超过该毫秒数时合并发出（默认 120） */
  flushIntervalMs?: number
  /** 字数阈值：缓冲达到该字符数时立即合并发出（默认 160） */
  flushChars?: number
  /** 可注入时钟（测试用假时钟驱动时间阈值） */
  now?: () => number
  /** 可注入定时器（测试用假定时器驱动无事件时的兜底 flush） */
  setTimer?: (callback: () => void, ms: number) => () => void
}

export type EventCoalescer = {
  /** 事件入口：reasoning/text 进缓冲（同类型增量累积），其余先 flush 再透传 */
  emit(event: PlanAgentEvent): void
  /** 立刻刷出缓冲（无缓冲时为 no-op） */
  flush(): void
  /** run 结束收尾：刷出残余缓冲、取消定时器；之后的 emit 直接透传不再合并 */
  dispose(): void
}

const DEFAULT_FLUSH_INTERVAL_MS = 120
const DEFAULT_FLUSH_CHARS = 160

function defaultSetTimer(callback: () => void, ms: number): () => void {
  const timer = setTimeout(callback, ms)
  return () => clearTimeout(timer)
}

export function createEventCoalescer(
  onEvent: (event: PlanAgentEvent) => void,
  options: EventCoalescerOptions = {},
): EventCoalescer {
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
  const flushChars = options.flushChars ?? DEFAULT_FLUSH_CHARS
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? defaultSetTimer

  // 同一时刻只缓冲一种可合并类型（reasoning / text）；loop 的事件流里两者
  // 从不交错（reasoning 流结束才有 text），类型切换时先 flush 保序
  let bufferedType: 'reasoning' | 'text' | null = null
  let buffer = ''
  let lastFlushAt = now()
  let cancelTimer: (() => void) | null = null
  let disposed = false

  function flush(): void {
    if (cancelTimer) {
      cancelTimer()
      cancelTimer = null
    }
    const type = bufferedType
    const payload = buffer
    bufferedType = null
    buffer = ''
    if (!type || !payload) return
    lastFlushAt = now()
    onEvent(type === 'reasoning' ? { type: 'reasoning', delta: payload } : { type: 'text', text: payload })
  }

  /** 缓冲起步时排一个兜底定时器：流停住（无后续事件）也能按时刷出 */
  function scheduleTimer(): void {
    if (cancelTimer) return
    const wait = Math.max(0, flushIntervalMs - (now() - lastFlushAt))
    cancelTimer = setTimer(() => {
      cancelTimer = null
      flush()
    }, wait)
  }

  return {
    emit(event) {
      if (disposed) {
        onEvent(event)
        return
      }
      if (event.type === 'reasoning' || event.type === 'text') {
        const chunk = event.type === 'reasoning' ? event.delta : event.text
        if (bufferedType && bufferedType !== event.type) flush()
        if (!bufferedType) {
          bufferedType = event.type
          buffer = ''
        }
        buffer += chunk
        if (buffer.length >= flushChars || now() - lastFlushAt >= flushIntervalMs) {
          flush()
          return
        }
        scheduleTimer()
        return
      }
      // 其他类型事件：先 flush 缓冲再转发——done/error 前缓冲必被刷出，
      // status/tool_call 等遥测与 reasoning 的相对顺序保持不变
      flush()
      onEvent(event)
    },

    flush,

    dispose() {
      disposed = true
      flush()
      if (cancelTimer) {
        cancelTimer()
        cancelTimer = null
      }
    },
  }
}
