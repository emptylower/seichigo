import { describe, it, expect } from 'vitest'
import { createEventCoalescer } from '@/lib/planAgent/eventCoalescer'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'

/** 第九轮 A2：SSE 事件合并器——时间/字数阈值、顺序保真、done/error 前强制 flush */

function toolCallRunning(): PlanAgentEvent {
  return { type: 'tool_call', id: 'c1', name: 'list_points', argsSummary: '作品 id 1', status: 'running' }
}

/** 假时钟：手动推进时间并触发到点的定时器（不依赖 vi.useFakeTimers） */
function makeFakeClock() {
  let currentMs = 0
  const timers: Array<{ at: number; cb: () => void; cancelled: boolean }> = []
  return {
    now: () => currentMs,
    setTimer: (cb: () => void, ms: number) => {
      const timer = { at: currentMs + ms, cb, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    advanceTo(ms: number) {
      currentMs = ms
      for (const timer of timers) {
        if (!timer.cancelled && timer.at <= currentMs) {
          timer.cancelled = true
          timer.cb()
        }
      }
    },
  }
}

describe('createEventCoalescer（第九轮 A2）', () => {
  it('100 个 3 字符 reasoning 增量在 0–50 ms 内到达 → 输出 ≤ 2 条且拼接内容完整', () => {
    const clock = makeFakeClock()
    const out: PlanAgentEvent[] = []
    const coalescer = createEventCoalescer((e) => out.push(e), {
      flushIntervalMs: 120,
      flushChars: 160,
      now: clock.now,
      setTimer: clock.setTimer,
    })
    const total = Array.from({ length: 100 }, (_, i) => String(i).padStart(3, '0'))
    for (let i = 0; i < 100; i++) {
      clock.advanceTo(i / 2) // 0–50 ms 内均匀到达
      coalescer.emit({ type: 'reasoning', delta: total[i]! })
    }
    coalescer.dispose() // 收尾刷出残余缓冲
    const reasoningEvents = out.filter((e) => e.type === 'reasoning')
    expect(reasoningEvents.length).toBeLessThanOrEqual(2)
    expect(reasoningEvents.map((e) => (e as { delta: string }).delta).join('')).toBe(total.join(''))
  })

  it('reasoning 后紧跟 tool_call → 先 reasoning 再 tool_call（顺序保真）', () => {
    const out: PlanAgentEvent[] = []
    const coalescer = createEventCoalescer((e) => out.push(e), { flushIntervalMs: 60_000, flushChars: 1_000_000 })
    coalescer.emit({ type: 'reasoning', delta: '先想' })
    coalescer.emit({ type: 'reasoning', delta: '想完' })
    coalescer.emit(toolCallRunning())
    expect(out.map((e) => e.type)).toEqual(['reasoning', 'tool_call'])
    expect((out[0] as { delta: string }).delta).toBe('先想想完')
    coalescer.dispose()
  })

  it('done 前缓冲被强制刷出；error 同样先 flush 再透传', () => {
    const out: PlanAgentEvent[] = []
    const coalescer = createEventCoalescer((e) => out.push(e), { flushIntervalMs: 60_000, flushChars: 1_000_000 })
    coalescer.emit({ type: 'reasoning', delta: '收尾前的思考' })
    coalescer.emit({ type: 'done' })
    expect(out.map((e) => e.type)).toEqual(['reasoning', 'done'])
    expect((out[0] as { delta: string }).delta).toBe('收尾前的思考')

    coalescer.emit({ type: 'reasoning', delta: '出错的思考' })
    coalescer.emit({ type: 'error', message: '网络不稳定' })
    expect(out.map((e) => e.type)).toEqual(['reasoning', 'done', 'reasoning', 'error'])
    coalescer.dispose()
  })

  it('text 事件同样合并；与 reasoning 类型切换时先 flush 保序', () => {
    const out: PlanAgentEvent[] = []
    const coalescer = createEventCoalescer((e) => out.push(e), { flushIntervalMs: 60_000, flushChars: 1_000_000 })
    coalescer.emit({ type: 'text', text: '第一段' })
    coalescer.emit({ type: 'text', text: '第二段' })
    coalescer.emit({ type: 'reasoning', delta: '切换类型' })
    coalescer.emit({ type: 'done' })
    expect(out).toEqual([
      { type: 'text', text: '第一段第二段' },
      { type: 'reasoning', delta: '切换类型' },
      { type: 'done' },
    ])
    coalescer.dispose()
  })

  it('时间阈值兜底：流停住后定时器到点自动 flush（无需后续事件触发）', () => {
    const clock = makeFakeClock()
    const out: PlanAgentEvent[] = []
    const coalescer = createEventCoalescer((e) => out.push(e), {
      flushIntervalMs: 120,
      flushChars: 1_000_000,
      now: clock.now,
      setTimer: clock.setTimer,
    })
    coalescer.emit({ type: 'reasoning', delta: '一小段' }) // 缓冲，未达字数阈值
    expect(out).toHaveLength(0)
    clock.advanceTo(120) // 定时器到点
    expect(out).toEqual([{ type: 'reasoning', delta: '一小段' }])
    coalescer.dispose()
  })

  it('缓冲达到字数阈值时立即合并发出（不等时间阈值）', () => {
    const out: PlanAgentEvent[] = []
    const coalescer = createEventCoalescer((e) => out.push(e), { flushIntervalMs: 60_000, flushChars: 5 })
    coalescer.emit({ type: 'reasoning', delta: 'abc' })
    expect(out).toHaveLength(0)
    coalescer.emit({ type: 'reasoning', delta: 'de' }) // 缓冲 ≥ 5 字符
    expect(out).toEqual([{ type: 'reasoning', delta: 'abcde' }])
    coalescer.dispose()
  })

  it('dispose 后的 emit 直接透传不再合并', () => {
    const out: PlanAgentEvent[] = []
    const coalescer = createEventCoalescer((e) => out.push(e), { flushIntervalMs: 60_000, flushChars: 1_000_000 })
    coalescer.dispose()
    coalescer.emit({ type: 'reasoning', delta: 'a' })
    coalescer.emit({ type: 'reasoning', delta: 'b' })
    expect(out).toEqual([{ type: 'reasoning', delta: 'a' }, { type: 'reasoning', delta: 'b' }])
  })
})
