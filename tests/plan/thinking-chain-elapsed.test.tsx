import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ThinkingChain, type ThinkingTurn } from '@/app/(authed)/plan/[id]/components/ThinkingChain'
import { liveToThinkingTurn } from '@/app/(authed)/plan/[id]/lib/chatState'

function turn(over: Partial<ThinkingTurn> = {}): ThinkingTurn {
  // reasoning 置空：避开打字机 rAF，专注 pill 上的「已用」计时
  return { reasoning: '', statusPhrase: '正在读取对话历史', toolCalls: [], startedAt: Date.now(), ...over }
}

function elapsedText(): string {
  return screen.getByText(/已用 \d+s/).textContent ?? ''
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-11T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ThinkingChain active pill「已用 Ns」锚定在本轮 run 起点', () => {
  it('状态短句切换（携带新的 startedAt）时已用秒数单调不减；新一轮开始才归零', () => {
    const { rerender } = render(
      <ThinkingChain thinking={turn()} active expanded={false} onToggle={() => {}} />,
    )
    expect(elapsedText()).toContain('已用 0s')

    act(() => void vi.advanceTimersByTime(5000))
    expect(elapsedText()).toContain('已用 5s')

    // 生产路径：观察流首帧 live 快照 / 内联回落的 freezeTurn 会为同一进行中的
    // 回合带入新的 startedAt（=此刻），同时状态短句从 A 切到 B——计时不能回退
    rerender(
      <ThinkingChain
        thinking={turn({ statusPhrase: '正在组织思路', startedAt: Date.now() })}
        active
        expanded={false}
        onToggle={() => {}}
      />,
    )
    expect(screen.getByText('正在组织思路')).toBeTruthy()
    expect(elapsedText()).toContain('已用 5s')

    act(() => void vi.advanceTimersByTime(1000))
    expect(elapsedText()).toContain('已用 6s')

    // 再切一次短句、再漂移一次 startedAt，仍然单调
    rerender(
      <ThinkingChain
        thinking={turn({ statusPhrase: '正在获取点位列表', startedAt: Date.now() })}
        active
        expanded={false}
        onToggle={() => {}}
      />,
    )
    act(() => void vi.advanceTimersByTime(2000))
    expect(elapsedText()).toContain('已用 8s')

    // 回合结束（active=false，定格摘要）→ 新一轮开始（active=true + 新 startedAt）：归零
    rerender(
      <ThinkingChain
        thinking={turn({ reasoning: '想了想。', endedAt: Date.now() })}
        active={false}
        expanded={false}
        onToggle={() => {}}
      />,
    )
    expect(screen.queryByText(/已用 \d+s/)).toBeNull()

    act(() => void vi.advanceTimersByTime(3000))
    rerender(
      <ThinkingChain
        thinking={turn({ statusPhrase: '正在读取对话历史', startedAt: Date.now() })}
        active
        expanded={false}
        onToggle={() => {}}
      />,
    )
    expect(elapsedText()).toContain('已用 0s')
    act(() => void vi.advanceTimersByTime(1000))
    expect(elapsedText()).toContain('已用 1s')
  })

  it('恢复路径占位 turn（startedAt=0）：拿到快照后从首次可见时刻起算，而不是快照到达时刻', () => {
    const { rerender } = render(
      <ThinkingChain
        thinking={{ reasoning: '', statusPhrase: null, toolCalls: [], startedAt: 0 }}
        active
        expanded={false}
        onToggle={() => {}}
      />,
    )
    // 还没有遥测：pill 不显示计时（既有行为不变）
    expect(screen.queryByText(/已用 \d+s/)).toBeNull()

    act(() => void vi.advanceTimersByTime(4000))
    rerender(
      <ThinkingChain
        thinking={turn({ statusPhrase: '正在组织思路', startedAt: Date.now() })}
        active
        expanded={false}
        onToggle={() => {}}
      />,
    )
    expect(elapsedText()).toContain('已用 4s')
  })
})

/** 刷新恢复时观察流/轮询推来的实况快照（本页没有在途回合，prev 为空） */
const LIVE_SNAPSHOT = { reasoning: '', statusText: '正在组织思路', toolCalls: [] }

describe('刷新恢复：「已用 Ns」锚定在服务端的 run 启动时刻', () => {
  it('run 已跑 6 秒时刷新：首帧 live 快照直接显示 ≈6s，而不是从 0 重来', () => {
    // GET /api/me/plans/:id 的 runStartedAt（TripPlan.agentRunStartedAt）解析后的毫秒
    const runStartedAt = Date.now() - 6_000
    const recovered = liveToThinkingTurn(LIVE_SNAPSHOT, null, runStartedAt)
    expect(recovered.startedAt).toBe(runStartedAt)

    render(<ThinkingChain thinking={recovered} active expanded={false} onToggle={() => {}} />)
    expect(elapsedText()).toContain('已用 6s')

    act(() => void vi.advanceTimersByTime(1000))
    expect(elapsedText()).toContain('已用 7s')
  })

  it('服务端没给锚点（未 busy / run 尚未被领取 / 解析失败）：退回本地此刻', () => {
    const now = Date.now()
    expect(liveToThinkingTurn(LIVE_SNAPSHOT, null, null).startedAt).toBe(now)
    expect(liveToThinkingTurn(LIVE_SNAPSHOT, null, undefined).startedAt).toBe(now)
    expect(liveToThinkingTurn(LIVE_SNAPSHOT, null, Number.NaN).startedAt).toBe(now)

    render(<ThinkingChain thinking={liveToThinkingTurn(LIVE_SNAPSHOT, null, null)} active expanded={false} onToggle={() => {}} />)
    expect(elapsedText()).toContain('已用 0s')
  })

  it('服务端时刻超前本地（时钟偏斜）：钳到 0 而不是负数', () => {
    const recovered = liveToThinkingTurn(LIVE_SNAPSHOT, null, Date.now() + 30_000)
    expect(recovered.startedAt).toBe(Date.now())

    render(<ThinkingChain thinking={recovered} active expanded={false} onToggle={() => {}} />)
    expect(elapsedText()).toContain('已用 0s')

    act(() => void vi.advanceTimersByTime(2000))
    expect(elapsedText()).toContain('已用 2s')
  })

  it('本页发起的新回合不受影响：仍以点击时刻（prev.startedAt）为准', () => {
    const clickedAt = Date.now()
    act(() => void vi.advanceTimersByTime(1200))
    // 本页已有在途回合（prev 非空）：即便传了服务端锚点也不改写，计时连续
    const next = liveToThinkingTurn(
      LIVE_SNAPSHOT,
      { reasoning: '', statusPhrase: null, toolCalls: [], startedAt: clickedAt },
      Date.now() - 90_000,
    )
    expect(next.startedAt).toBe(clickedAt)

    render(<ThinkingChain thinking={next} active expanded={false} onToggle={() => {}} />)
    expect(elapsedText()).toContain('已用 1s')
  })
})
