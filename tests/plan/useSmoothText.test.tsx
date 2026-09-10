import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSmoothText } from '@/app/(authed)/plan/[id]/hooks/useSmoothText'

/**
 * 假 rAF + 假时钟：rafCallbacks 保存当前挂起的帧回调，stepFrames 以固定步长
 * 推进 rAF 时间轴并逐个触发（回调里注册的新帧进入下一轮）；wallNowMs 模拟
 * Date.now（EMA 到达间隔估计用）。
 */
let rafCallbacks: Map<number, FrameRequestCallback>
let rafSeq: number
let rafNowMs: number
let wallNowMs: number

function stepFrames(count: number, dtMs = 1000 / 60) {
  for (let i = 0; i < count; i++) {
    rafNowMs += dtMs
    const pending = [...rafCallbacks.values()]
    rafCallbacks.clear()
    for (const cb of pending) cb(rafNowMs)
  }
}

beforeEach(() => {
  rafCallbacks = new Map()
  rafSeq = 0
  rafNowMs = 0
  wallNowMs = 10_000
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafSeq += 1
    rafCallbacks.set(rafSeq, cb)
    return rafSeq
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafCallbacks.delete(id)
  })
  vi.spyOn(Date, 'now').mockImplementation(() => wallNowMs)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useSmoothText（打字机播放缓冲）', () => {
  it('匀速推进：逐帧逼近 target，单帧不超过 12 字，最终放到全长', () => {
    const target = '假'.repeat(300)
    const { result, rerender } = renderHook(({ t }) => useSmoothText(t), { initialProps: { t: '' } })
    expect(result.current).toBe('')

    rerender({ t: target })
    act(() => stepFrames(1))
    let prevLen = result.current.length
    expect(prevLen).toBeGreaterThan(0)
    expect(prevLen).toBeLessThanOrEqual(12)

    for (let i = 0; i < 200 && result.current.length < target.length; i++) {
      act(() => stepFrames(1))
      const len = result.current.length
      expect(len).toBeGreaterThan(prevLen)
      expect(len - prevLen).toBeLessThanOrEqual(12)
      prevLen = len
    }
    expect(result.current).toBe(target)
  })

  it('前缀校验：新 target 不以已渲染前缀开头（截头保尾）→ 直接 snap 到末尾', () => {
    const first = 'abcdefghijklmnopqrstuvwxyz'
    const { result, rerender } = renderHook(({ t }) => useSmoothText(t), { initialProps: { t: first } })
    act(() => stepFrames(2))
    expect(result.current.length).toBeGreaterThan(0)
    expect(result.current.length).toBeLessThan(first.length)

    // 服务端截头保尾后的新快照：与已渲染前缀完全对不上
    const truncated = '【截断】' + first.slice(20) + '，后续全新的推理内容'
    expect(truncated.startsWith(result.current)).toBe(false)
    rerender({ t: truncated })
    expect(result.current).toBe(truncated)
    act(() => stepFrames(5))
    expect(result.current).toBe(truncated)
  })

  it('done=true：立刻 flush 到全长并停掉 rAF（含挂载即 done 的历史回看）', () => {
    // 历史回看：挂载即 done → 首帧就是全量，看不到打字机重放
    const history = renderHook(() => useSmoothText('早已结束的推理全文', { done: true }))
    expect(history.result.current).toBe('早已结束的推理全文')
    history.unmount()

    const target = '进行中的推理'.repeat(40)
    const { result, rerender } = renderHook(({ t, done }) => useSmoothText(t, { done }), {
      initialProps: { t: target, done: false },
    })
    act(() => stepFrames(2))
    expect(result.current.length).toBeLessThan(target.length)

    rerender({ t: target, done: true })
    expect(result.current).toBe(target)
    // rAF 已停：继续推帧不会再有任何回调执行
    act(() => stepFrames(5))
    expect(result.current).toBe(target)
    expect(rafCallbacks.size).toBe(0)
  })

  it('prefers-reduced-motion: reduce 时全程直通，直接返回 target', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }))
    const { result, rerender } = renderHook(({ t }) => useSmoothText(t), { initialProps: { t: '第一段' } })
    expect(result.current).toBe('第一段')

    rerender({ t: '第一段第二段第三段' })
    expect(result.current).toBe('第一段第二段第三段')
    act(() => stepFrames(3))
    expect(result.current).toBe('第一段第二段第三段')
  })

  it('空闲时停掉 rAF 循环：不再产生帧回调，也不再调用 onFrame', () => {
    const onFrame = vi.fn()
    const target = '推理内容片段'
    const { result, rerender } = renderHook(({ t }) => useSmoothText(t, { onFrame }), { initialProps: { t: '' } })
    rerender({ t: target })
    for (let i = 0; i < 50 && result.current.length < target.length; i++) {
      act(() => stepFrames(1))
    }
    expect(result.current).toBe(target)
    // 推进完成后循环自行停止：挂起帧归零
    act(() => stepFrames(3))
    expect(rafCallbacks.size).toBe(0)
    const callsWhenIdle = onFrame.mock.calls.length
    // 空闲期间继续推帧：既无帧回调也不再触发 onFrame
    act(() => stepFrames(5))
    expect(rafCallbacks.size).toBe(0)
    expect(onFrame.mock.calls.length).toBe(callsWhenIdle)
  })

  it('空闲停止后 target 再次变长：立刻恢复推进直到新全长', () => {
    const first = '第一段推理'
    const { result, rerender } = renderHook(({ t }) => useSmoothText(t), { initialProps: { t: '' } })
    rerender({ t: first })
    for (let i = 0; i < 50 && result.current.length < first.length; i++) {
      act(() => stepFrames(1))
    }
    expect(result.current).toBe(first)
    act(() => stepFrames(3))
    expect(rafCallbacks.size).toBe(0)

    const second = first + '，追加的后续推理'
    rerender({ t: second })
    // 检测到变长的同一个 commit 就重新挂上 rAF
    expect(rafCallbacks.size).toBe(1)
    act(() => stepFrames(1))
    expect(result.current.length).toBeGreaterThan(first.length)
    for (let i = 0; i < 100 && result.current.length < second.length; i++) {
      act(() => stepFrames(1))
    }
    expect(result.current).toBe(second)
  })
})
