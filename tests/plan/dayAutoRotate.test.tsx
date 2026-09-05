import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { useDayAutoRotate } from '@/app/(authed)/plan/[id]/hooks/useDayAutoRotate'

const rotated: number[] = []

/** 受控的 IntersectionObserver 桩：测试自己决定"进没进视口" */
const observerState = {
  callbacks: [] as Array<(entries: Array<{ isIntersecting: boolean }>) => void>,
  observed: [] as Element[],
  disconnected: 0,
}

class FakeIntersectionObserver {
  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    observerState.callbacks.push(cb)
  }
  observe(el: Element) {
    observerState.observed.push(el)
  }
  disconnect() {
    observerState.disconnected += 1
  }
  unobserve() {}
}

function setIntersecting(isIntersecting: boolean) {
  act(() => {
    for (const cb of observerState.callbacks) cb([{ isIntersecting }])
  })
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function Harness({ dayIndexes = [1, 2, 3] }: { dayIndexes?: number[] } = {}) {
  const rotation = useDayAutoRotate({ enabled: true, dayIndexes, onRotate: (index) => rotated.push(index) })
  return (
    <div ref={rotation.containerRef} data-testid="host">
      <button type="button" onClick={rotation.stop}>
        手动切天
      </button>
    </div>
  )
}

describe('useDayAutoRotate（中-6：只在可见且前台时轮播）', () => {
  beforeEach(() => {
    rotated.length = 0
    observerState.callbacks.length = 0
    observerState.observed.length = 0
    observerState.disconnected = 0
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    setDocumentHidden(false)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('没进视口就不轮播；进了视口才开始', () => {
    render(<Harness />)
    expect(observerState.observed).toHaveLength(1)

    act(() => vi.advanceTimersByTime(20000))
    expect(rotated).toEqual([])

    setIntersecting(true)
    act(() => vi.advanceTimersByTime(5000))
    expect(rotated).toEqual([2])
  })

  it('页面切到后台就停，回前台接着转', () => {
    render(<Harness />)
    setIntersecting(true)

    setDocumentHidden(true)
    act(() => vi.advanceTimersByTime(20000))
    expect(rotated).toEqual([])

    setDocumentHidden(false)
    act(() => vi.advanceTimersByTime(5000))
    expect(rotated).toEqual([2])
  })

  it('转满一圈就自己停下来（不无限打转）', () => {
    render(<Harness />)
    setIntersecting(true)

    act(() => vi.advanceTimersByTime(5000 * 3))
    expect(rotated).toEqual([2, 3, 1])

    act(() => vi.advanceTimersByTime(5000 * 5))
    expect(rotated).toEqual([2, 3, 1])
  })

  it('用户一交互就永久停止', () => {
    render(<Harness />)
    setIntersecting(true)

    act(() => vi.advanceTimersByTime(5000))
    expect(rotated).toEqual([2])

    fireEvent.click(screen.getByRole('button', { name: '手动切天' }))
    act(() => vi.advanceTimersByTime(20000))
    expect(rotated).toEqual([2])
  })

  it('只有一天时不轮播', () => {
    render(<Harness dayIndexes={[1]} />)
    setIntersecting(true)

    act(() => vi.advanceTimersByTime(20000))
    expect(rotated).toEqual([])
  })
})
