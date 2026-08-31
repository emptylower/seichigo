import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThinkingChain, type ThinkingTurn } from '@/app/(authed)/plan/[id]/components/ThinkingChain'

const baseTurn: ThinkingTurn = {
  reasoning: '先把点位按区域分组。',
  statusPhrase: '正在获取点位列表',
  startedAt: 0,
  toolCalls: [
    {
      id: 'call-1',
      name: 'list_points',
      argsSummary: '作品 id 115908',
      status: 'done',
      durationMs: 738,
      resultSummary: '找到 47 个点位',
    },
    { id: 'call-2', name: 'save_plan_days', argsSummary: '3 天行程', status: 'running' },
  ],
}

describe('ThinkingChain', () => {
  it('active: shows current status phrase in the working bar', () => {
    render(<ThinkingChain thinking={baseTurn} active expanded={false} onToggle={() => {}} />)
    expect(screen.getByText('正在获取点位列表')).toBeTruthy()
  })

  it('active: falls back to default phrase when no status received yet', () => {
    render(
      <ThinkingChain
        thinking={{ reasoning: '', statusPhrase: null, toolCalls: [], startedAt: 0 }}
        active
        expanded={false}
        onToggle={() => {}}
      />,
    )
    expect(screen.getByText('规划师思考中…')).toBeTruthy()
  })

  it('expanded: renders reasoning text and tool call timeline', () => {
    render(<ThinkingChain thinking={baseTurn} active expanded onToggle={() => {}} />)
    expect(screen.getByText('先把点位按区域分组。')).toBeTruthy()
    expect(screen.getByText('作品 id 115908')).toBeTruthy()
    expect(screen.getByText('找到 47 个点位')).toBeTruthy()
    expect(screen.getByText('738ms')).toBeTruthy()
    expect(screen.getByText('3 天行程')).toBeTruthy()
  })

  it('frozen: renders summary line and toggles via 查看思考过程', () => {
    let expanded = false
    const frozen: ThinkingTurn = { ...baseTurn, endedAt: 12000 }
    const { rerender } = render(
      <ThinkingChain thinking={frozen} active={false} expanded={expanded} onToggle={() => { expanded = !expanded }} />,
    )
    expect(screen.getByText(/已完成 2 步/)).toBeTruthy()
    expect(screen.getByText(/用时 12s/)).toBeTruthy()
    // 折叠态不渲染时间线
    expect(screen.queryByText('先把点位按区域分组。')).toBeNull()

    fireEvent.click(screen.getByText('查看思考过程'))
    rerender(
      <ThinkingChain thinking={frozen} active={false} expanded={expanded} onToggle={() => { expanded = !expanded }} />,
    )
    expect(screen.getByText('先把点位按区域分组。')).toBeTruthy()
    expect(screen.getByText('收起思考过程')).toBeTruthy()
  })

  it('frozen: renders nothing when the turn has no content', () => {
    const { container } = render(
      <ThinkingChain
        thinking={{ reasoning: '', statusPhrase: '正在处理…', toolCalls: [], startedAt: 0, endedAt: 100 }}
        active={false}
        expanded={false}
        onToggle={() => {}}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
