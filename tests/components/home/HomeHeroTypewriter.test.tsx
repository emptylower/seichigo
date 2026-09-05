import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { useTypewriterPlaceholder } from '@/components/home/HomeHeroTypewriter'

function Probe({ examples, enabled = true }: { examples: string[]; enabled?: boolean }) {
  const text = useTypewriterPlaceholder(examples, { typeMs: 45, holdMs: 1800, eraseMs: 20, enabled })
  return <span data-testid="typed">{text}</span>
}

function typed(): string {
  return screen.getByTestId('typed').textContent ?? ''
}

describe('useTypewriterPlaceholder', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('按 typeMs 一字一字推进第一条示例', () => {
    render(<Probe examples={['abcd', 'xy']} />)
    expect(typed()).toBe('')

    act(() => void vi.advanceTimersByTime(45))
    expect(typed()).toBe('a')
    act(() => void vi.advanceTimersByTime(45 * 3))
    expect(typed()).toBe('abcd')
  })

  it('打满后 hold，再按 eraseMs 擦掉并接上下一条', () => {
    render(<Probe examples={['ab', 'xy']} />)

    act(() => void vi.advanceTimersByTime(45 * 2))
    expect(typed()).toBe('ab')

    // hold 期间不动
    act(() => void vi.advanceTimersByTime(1799))
    expect(typed()).toBe('ab')

    act(() => void vi.advanceTimersByTime(1))
    expect(typed()).toBe('a')
    act(() => void vi.advanceTimersByTime(20))
    expect(typed()).toBe('')

    // 下一条从头打
    act(() => void vi.advanceTimersByTime(45))
    expect(typed()).toBe('x')
  })

  it('enabled=false 时不启动定时器，始终空串（交回静态占位）', () => {
    render(<Probe examples={['abcd']} enabled={false} />)
    act(() => void vi.advanceTimersByTime(10_000))
    expect(typed()).toBe('')
  })

  it('examples 为空时不崩也不推进', () => {
    render(<Probe examples={[]} />)
    act(() => void vi.advanceTimersByTime(10_000))
    expect(typed()).toBe('')
  })
})
