import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ThinkingChain, type ThinkingTurn, type ToolCallEntry } from '@/app/(authed)/plan/[id]/components/ThinkingChain'

const STAGGER_MS = 80

function tool(id: string, over: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return { id, name: 'list_points', argsSummary: `摘要 ${id}`, status: 'running', ...over }
}

function turnWith(calls: ToolCallEntry[], over: Partial<ThinkingTurn> = {}): ThinkingTurn {
  // reasoning 置空：避开打字机 rAF，专注工具行节奏
  return { reasoning: '', statusPhrase: '处理中', toolCalls: calls, startedAt: Date.now(), ...over }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ThinkingChain 工具行错开插入（任务 B）', () => {
  it('active：同帧到达的多条工具行按 ~80ms 间隔逐条出现', () => {
    const { rerender } = render(
      <ThinkingChain thinking={turnWith([])} active expanded onToggle={() => {}} />,
    )
    // 同一帧快照一下到达 3 条
    rerender(
      <ThinkingChain thinking={turnWith([tool('a'), tool('b'), tool('c')])} active expanded onToggle={() => {}} />,
    )
    expect(screen.queryByText('摘要 a')).toBeNull()
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    expect(screen.getByText('摘要 a')).toBeTruthy()
    expect(screen.queryByText('摘要 b')).toBeNull()
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    expect(screen.getByText('摘要 b')).toBeTruthy()
    expect(screen.queryByText('摘要 c')).toBeNull()
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    expect(screen.getByText('摘要 c')).toBeTruthy()
  })

  it('active：running→done 同 id 更新立即生效，不被插入队列延迟', () => {
    const { rerender } = render(
      <ThinkingChain thinking={turnWith([tool('a')])} active expanded onToggle={() => {}} />,
    )
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    expect(screen.getByText('摘要 a')).toBeTruthy()

    // 下一帧：a 变 done（带服务端 durationMs），同时新到 b —— b 还在排队
    rerender(
      <ThinkingChain
        thinking={turnWith([tool('a', { status: 'done', durationMs: 1234 }), tool('b')])}
        active
        expanded
        onToggle={() => {}}
      />,
    )
    // 不推进任何计时器：a 的 done 态与服务端耗时必须立刻可见
    expect(screen.getByText('1.2s')).toBeTruthy()
    expect(screen.queryByText('摘要 b')).toBeNull()
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    expect(screen.getByText('摘要 b')).toBeTruthy()
  })

  it('active=false 历史回看：挂载即全部显示，不走错开', () => {
    render(
      <ThinkingChain
        thinking={turnWith([tool('a'), tool('b'), tool('c')], { endedAt: Date.now() + 5000 })}
        active={false}
        expanded
        onToggle={() => {}}
      />,
    )
    expect(screen.getByText('摘要 a')).toBeTruthy()
    expect(screen.getByText('摘要 b')).toBeTruthy()
    expect(screen.getByText('摘要 c')).toBeTruthy()
  })
})

describe('ThinkingChain 存活信号（C1/C3）', () => {
  it('C1：active pill 显示本地已用秒数并每秒推进', () => {
    const startedAt = Date.now() - 3000
    render(<ThinkingChain thinking={turnWith([], { startedAt })} active expanded={false} onToggle={() => {}} />)
    expect(screen.getByText(/已用 3s/)).toBeTruthy()
    act(() => void vi.advanceTimersByTime(2000))
    expect(screen.getByText(/已用 5s/)).toBeTruthy()
  })

  it('C1：startedAt 为 0（首帧遥测未到的兜底回合）不显示计时', () => {
    render(<ThinkingChain thinking={turnWith([], { startedAt: 0 })} active expanded={false} onToggle={() => {}} />)
    expect(screen.queryByText(/已用/)).toBeNull()
  })

  it('C3：running 工具行显示本地已用秒数并推进；durationMs 到达后以服务端值为准', () => {
    const { rerender } = render(
      <ThinkingChain thinking={turnWith([tool('a')])} active expanded onToggle={() => {}} />,
    )
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    expect(screen.getByText('0s')).toBeTruthy()
    act(() => void vi.advanceTimersByTime(3000))
    expect(screen.getByText('3s')).toBeTruthy()

    rerender(
      <ThinkingChain
        thinking={turnWith([tool('a', { status: 'done', durationMs: 738 })])}
        active
        expanded
        onToggle={() => {}}
      />,
    )
    expect(screen.getByText('738ms')).toBeTruthy()
  })
})

describe('ThinkingChain 连接状态（C2）', () => {
  it('degraded：pill 文案换成「连接不稳，重试中…」', () => {
    render(
      <ThinkingChain
        thinking={turnWith([])}
        active
        expanded={false}
        onToggle={() => {}}
        connectionState="degraded"
      />,
    )
    expect(screen.getByText('连接不稳，重试中…')).toBeTruthy()
    expect(screen.queryByText('处理中')).toBeNull()
  })

  it('live（缺省）：显示当前状态短语', () => {
    render(<ThinkingChain thinking={turnWith([])} active expanded={false} onToggle={() => {}} />)
    expect(screen.getByText('处理中')).toBeTruthy()
  })
})

describe('ThinkingChain 跨展开保持与新回合重置（阶段二修正）', () => {
  it('进行中收起再展开：已揭示的行立即全量显示，不重放错开；仅新到达的行继续错开', () => {
    const thinking = turnWith([tool('a'), tool('b')])
    const { rerender } = render(<ThinkingChain thinking={thinking} active expanded onToggle={() => {}} />)
    // 推进到两条都已揭示
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    expect(screen.getByText('摘要 a')).toBeTruthy()
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    expect(screen.getByText('摘要 b')).toBeTruthy()

    // 收起：时间线整个卸载
    rerender(<ThinkingChain thinking={thinking} active expanded={false} onToggle={() => {}} />)
    expect(screen.queryByText('摘要 a')).toBeNull()

    // 再展开：不推进任何计时器，已揭示的行必须立即全部显示（不重放 80ms 错开）
    rerender(<ThinkingChain thinking={thinking} active expanded onToggle={() => {}} />)
    expect(screen.getByText('摘要 a')).toBeTruthy()
    expect(screen.getByText('摘要 b')).toBeTruthy()

    // 此后新到达的行仍然按 ~80ms 错开
    const next = { ...thinking, toolCalls: [...thinking.toolCalls, tool('c')] }
    rerender(<ThinkingChain thinking={next} active expanded onToggle={() => {}} />)
    expect(screen.queryByText('摘要 c')).toBeNull()
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    expect(screen.getByText('摘要 c')).toBeTruthy()
  })

  it('新回合开始（上一回合结束后再 active）：揭示进度重置，新一轮从 0 重新错开', () => {
    const t0 = Date.now()
    const turnA = turnWith([tool('a'), tool('b')], { startedAt: t0 })
    const { rerender } = render(<ThinkingChain thinking={turnA} active expanded onToggle={() => {}} />)
    // 步进器是链式的：每 80ms 揭示一条，分两次推进
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    expect(screen.getByText('摘要 a')).toBeTruthy()
    expect(screen.getByText('摘要 b')).toBeTruthy()

    // 上一回合结束
    rerender(<ThinkingChain thinking={{ ...turnA, endedAt: t0 + 5000 }} active={false} expanded onToggle={() => {}} />)

    // 新回合：全新 startedAt，首帧同快照到达 2 条——揭示进度不得沿用上一轮的 2 条
    const turnB = turnWith([tool('x'), tool('y')], { startedAt: t0 + 6000 })
    rerender(<ThinkingChain thinking={turnB} active expanded onToggle={() => {}} />)
    expect(screen.queryByText('摘要 x')).toBeNull()
    expect(screen.queryByText('摘要 y')).toBeNull()
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    expect(screen.getByText('摘要 x')).toBeTruthy()
    expect(screen.queryByText('摘要 y')).toBeNull()
    act(() => void vi.advanceTimersByTime(STAGGER_MS))
    expect(screen.getByText('摘要 y')).toBeTruthy()
  })
})
