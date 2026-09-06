import { describe, it, expect } from 'vitest'
import { toolStatusPhrase, summarizeToolArgs, summarizeToolResult } from '@/lib/planAgent/statusPhrases'

describe('toolStatusPhrase', () => {
  it('maps every known tool to a Chinese phrase with args interpolated', () => {
    expect(toolStatusPhrase('search_anime', { query: '上低音号' })).toBe('正在搜索作品「上低音号」')
    expect(toolStatusPhrase('search_bangumi_tv', { keyword: '京吹' })).toBe('正在从 bgm.tv 搜索「京吹」')
    expect(toolStatusPhrase('list_points', { bangumiId: 115908 })).toBe('正在获取点位列表')
    expect(toolStatusPhrase('cluster_points', { pointIds: ['a', 'b'], dayCount: 3 })).toBe('正在规划每日路线')
    expect(toolStatusPhrase('estimate_transit', { fromPointId: 'a', toPointId: 'b' })).toBe('正在估算交通方式')
    expect(toolStatusPhrase('read_plan', {})).toBe('正在读取当前计划')
    expect(toolStatusPhrase('update_plan_meta', { title: 'x' })).toBe('正在更新计划信息')
    expect(toolStatusPhrase('save_plan_days', { days: [] })).toBe('正在保存行程')
    expect(toolStatusPhrase('ask_user', { kind: 'date_range', prompt: '什么时候去？' })).toBe('正在向用户发起提问')
  })

  it('ask_user 状态短语按任务类型（taskType）区分术语', () => {
    expect(toolStatusPhrase('ask_user', { taskType: 'date_range', kind: 'date_range', prompt: 'x' })).toBe('正在询问出行日期')
    expect(toolStatusPhrase('ask_user', { taskType: 'work_selection', kind: 'single_choice', prompt: 'x' })).toBe('正在请你选择作品')
    expect(toolStatusPhrase('ask_user', { taskType: 'opinion', kind: 'single_choice', prompt: 'x' })).toBe('正在征求你的意见')
  })

  it('falls back to a generic phrase for unknown tools', () => {
    expect(toolStatusPhrase('mystery_tool', {})).toBe('正在处理…')
  })

  it('renders phrases in en / ja when locale is passed', () => {
    expect(toolStatusPhrase('search_anime', { query: 'x' }, 'en')).toBe('Searching for "x"')
    expect(toolStatusPhrase('search_anime', { query: 'x' }, 'ja')).toBe('作品「x」を検索中')
    expect(toolStatusPhrase('list_points', {}, 'en')).toBe('Loading spots')
    expect(toolStatusPhrase('ask_user', { taskType: 'date_range' }, 'en')).toBe('Asking about your travel dates')
    expect(toolStatusPhrase('mystery_tool', {}, 'ja')).toBe('処理中…')
  })
})

describe('summarizeToolArgs', () => {
  it('gives short human-readable summaries per tool', () => {
    expect(summarizeToolArgs('search_anime', { query: '上低音号' })).toBe('作品「上低音号」')
    expect(summarizeToolArgs('search_bangumi_tv', { keyword: '京吹' })).toBe('关键词「京吹」')
    expect(summarizeToolArgs('list_points', { bangumiId: 115908 })).toBe('作品 id 115908')
    expect(summarizeToolArgs('cluster_points', { pointIds: ['a', 'b', 'c'], dayCount: 2 })).toBe('3 个点位 · 2 天')
    expect(summarizeToolArgs('estimate_transit', { fromPointId: '1:p1', toPointId: '1:p2' })).toBe('1:p1 → 1:p2')
    expect(summarizeToolArgs('read_plan', {})).toBe('读取当前计划')
    expect(summarizeToolArgs('update_plan_meta', { title: 't', dayCount: 3, startDate: '2026-10-01' })).toBe(
      '更新 title、dayCount、startDate',
    )
    expect(summarizeToolArgs('save_plan_days', { days: [{ dayIndex: 1 }, { dayIndex: 2 }] })).toBe('2 天行程')
    expect(summarizeToolArgs('ask_user', { kind: 'date_range', prompt: '你打算什么时候出发去巡礼？' })).toBe(
      '提问「你打算什么时候出发去巡礼？」',
    )
  })

  it('truncates raw JSON for unknown tools', () => {
    const summary = summarizeToolArgs('mystery_tool', { foo: 'bar' })
    expect(summary).toContain('foo')
    expect(summary.length).toBeLessThanOrEqual(80)
  })
})

describe('summarizeToolResult', () => {
  it('extracts counts for point/cluster/save tools', () => {
    expect(summarizeToolResult('list_points', JSON.stringify({ points: [{}, {}, {}] }))).toBe('找到 3 个点位')
    expect(summarizeToolResult('cluster_points', JSON.stringify({ clusters: [{}, {}] }))).toBe('分成 2 天')
    expect(summarizeToolResult('save_plan_days', JSON.stringify({ ok: true, savedDays: 3 }))).toBe('已保存 3 天')
  })

  it('summarizes search hits and transit estimates', () => {
    expect(summarizeToolResult('search_anime', JSON.stringify({ results: [{}, {}] }))).toBe('返回 2 个结果')
    expect(summarizeToolResult('search_bangumi_tv', JSON.stringify({ candidates: [{}] }))).toBe('返回 1 个候选')
    expect(
      summarizeToolResult('estimate_transit', JSON.stringify({ distanceKm: 0.7, mode: 'walk', durationMin: 9 })),
    ).toBe('步行 9 分钟')
    expect(
      summarizeToolResult('estimate_transit', JSON.stringify({ distanceKm: 7.2, mode: 'transit', durationMin: 29 })),
    ).toBe('公共交通 29 分钟')
  })

  it('surfaces tool errors and falls back to 已完成', () => {
    expect(summarizeToolResult('list_points', JSON.stringify({ error: 'bangumiId 必须是数字' }))).toBe(
      '失败：bangumiId 必须是数字',
    )
    expect(summarizeToolResult('update_plan_meta', JSON.stringify({ ok: true }))).toBe('已完成')
    expect(summarizeToolResult('read_plan', JSON.stringify({ plan: {} }))).toBe('已完成')
    expect(summarizeToolResult('mystery_tool', '{}')).toBe('已完成')
  })

  it('renders results in en / ja when locale is passed', () => {
    expect(summarizeToolResult('estimate_travel', '{"mode":"walk","durationMin":8}', 'en')).toBe('Walk 8 min')
    expect(summarizeToolResult('estimate_travel', '{"mode":"driving","durationMin":25}', 'en')).toBe('Drive 25 min')
    expect(summarizeToolResult('estimate_travel', '{"mode":"walk","durationMin":8}', 'ja')).toBe('徒歩 8 分')
    expect(summarizeToolResult('list_points', '{"points":[{},{}]}', 'en')).toBe('Found 2 spots')
    expect(summarizeToolResult('list_points', '{"error":"boom"}', 'en')).toBe('Failed: boom')
    expect(summarizeToolResult('mystery_tool', '{}', 'en')).toBe('Done')
    expect(summarizeToolArgs('cluster_points', { pointIds: ['a'], dayCount: 2 }, 'en')).toBe('1 spots · 2 days')
  })
})
