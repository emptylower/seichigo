import { describe, it, expect } from 'vitest'
import {
  applyThinkingEvent,
  hasThinkingContent,
  newThinkingTurn,
} from '@/app/(authed)/plan/[id]/components/ThinkingChain'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'

describe('thinking turn accumulator', () => {
  it('accumulates status phrase and reasoning deltas', () => {
    let turn = newThinkingTurn(1000)
    expect(hasThinkingContent(turn)).toBe(false)

    turn = applyThinkingEvent(turn, { type: 'status', phase: '正在获取点位列表' })
    expect(turn.statusPhrase).toBe('正在获取点位列表')
    // 只有 status 短语不算有内容
    expect(hasThinkingContent(turn)).toBe(false)

    turn = applyThinkingEvent(turn, { type: 'reasoning', delta: '用户想去' })
    turn = applyThinkingEvent(turn, { type: 'reasoning', delta: '京都。' })
    expect(turn.reasoning).toBe('用户想去京都。')
    expect(hasThinkingContent(turn)).toBe(true)
  })

  it('upserts tool_call by id: running frame inserts, done frame updates', () => {
    let turn = newThinkingTurn()
    const running: PlanAgentEvent = {
      type: 'tool_call',
      id: 'call-1',
      name: 'list_points',
      argsSummary: '作品 id 115908',
      status: 'running',
    }
    turn = applyThinkingEvent(turn, running)
    turn = applyThinkingEvent(turn, {
      type: 'tool_call',
      id: 'call-2',
      name: 'cluster_points',
      argsSummary: '47 个点位 · 3 天',
      status: 'running',
    })
    expect(turn.toolCalls).toHaveLength(2)
    expect(turn.toolCalls[0].status).toBe('running')

    turn = applyThinkingEvent(turn, {
      type: 'tool_call',
      id: 'call-1',
      name: 'list_points',
      argsSummary: '作品 id 115908',
      status: 'done',
      durationMs: 738,
      resultSummary: '找到 47 个点位',
    })
    expect(turn.toolCalls).toHaveLength(2)
    expect(turn.toolCalls[0]).toMatchObject({ status: 'done', durationMs: 738, resultSummary: '找到 47 个点位' })
    expect(turn.toolCalls[1].status).toBe('running')
  })

  it('ignores non-telemetry events', () => {
    const turn = newThinkingTurn()
    expect(applyThinkingEvent(turn, { type: 'text', text: 'hi' })).toBe(turn)
    expect(applyThinkingEvent(turn, { type: 'done' })).toBe(turn)
    expect(applyThinkingEvent(turn, { type: 'plan_updated' })).toBe(turn)
    expect(applyThinkingEvent(turn, { type: 'error', message: 'x' })).toBe(turn)
  })
})
