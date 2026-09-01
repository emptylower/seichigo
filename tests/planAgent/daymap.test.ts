import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import { parseDaymapPayload, toChatView, type DaymapMessagePayload } from '@/lib/tripPlan/view'
import type { PointFinder } from '@/lib/planAgent/points'
import type { TripPlanMessage } from '@/lib/tripPlan/repo'

const finder: PointFinder = {
  async searchBangumi() {
    return []
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return []
  },
  async getPointsByIds() {
    return [
      { id: '115908:uji', lat: 34.8892, lng: 135.8075 },
      { id: '115908:daikichi', lat: 34.8963, lng: 135.8123 },
    ]
  },
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessage

function assistantMessage(partial: Partial<ChatMessage>): ChatMessage {
  return { role: 'assistant', content: null, refusal: null, ...partial } as ChatMessage
}

function saveCall(days: unknown, id = 'call_save') {
  return {
    id,
    type: 'function' as const,
    function: { name: 'save_plan_days', arguments: JSON.stringify({ days }) },
  }
}

async function makeDeps(): Promise<{ deps: PlanAgentToolDeps; repo: MemoryTripPlanRepo; planId: string }> {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  return { deps: { planId: plan.id, repo, points: finder }, repo, planId: plan.id }
}

/** 交通/时间/地点齐全的一天（快照完整性断言用） */
function richDay() {
  return [
    {
      dayIndex: 1,
      citySlug: 'kyoto',
      summary: '宇治巡礼日',
      items: [
        { type: 'point', pointId: '115908:uji', title: '宇治桥', timeHint: '09:00', reason: '第 1 集取景地' },
        {
          type: 'transit',
          title: '步行前往大吉山',
          payload: {
            transport: {
              mode: 'walk',
              durationMin: 8,
              distanceKm: 0.65,
              provider: 'google',
              polyline: [
                [34.8892, 135.8075],
                [34.8963, 135.8123],
              ],
            },
          },
        },
        { type: 'point', pointId: '115908:daikichi', title: '大吉山', timeHint: '10:30' },
      ],
    },
  ]
}

describe('save_plan_days 的 daymap 交付物（后端契约）', () => {
  it('成功保存后追加一条 kind=daymap 消息：快照含归一化时间、交通 payload、provider 折线与城市/摘要', async () => {
    const { deps, repo, planId } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'save_plan_days', { days: richDay() }))
    expect(out.ok).toBe(true)
    expect(out.revisionId).toMatch(/^[0-9a-f-]{36}$/)

    const daymapMessages = (await repo.listMessages(planId)).filter((m) => m.kind === 'daymap')
    expect(daymapMessages).toHaveLength(1)
    const payload = parseDaymapPayload(daymapMessages[0]!.content)
    expect(payload).not.toBeNull()
    expect(payload!.revisionId).toBe(out.revisionId)
    expect(payload!.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(payload!.days).toHaveLength(1)
    const day = payload!.days[0]!
    expect(day.citySlug).toBe('kyoto')
    expect(day.summary).toBe('宇治巡礼日')
    const titles = day.items.map((i) => i.title)
    expect(titles).toEqual(['宇治桥', '步行前往大吉山', '大吉山'])
    // 归一化 schedule（服务端确定性时间区间）
    const transit = day.items[1]!
    expect(transit.payload).toMatchObject({
      transport: { mode: 'walk', durationMin: 8, provider: 'google' },
    })
    const transitPayload = transit.payload as Record<string, unknown>
    expect(transitPayload.schedule).toMatchObject({ confidence: 'estimated' })
    // provider 折线原样进快照（历史地图渲染优先用它，不再回读当前计划）
    expect((transitPayload.transport as Record<string, unknown>).polyline).toEqual([
      [34.8892, 135.8075],
      [34.8963, 135.8123],
    ])
  })

  it('两次保存产生两个不同 revision；第一条消息的 days 快照不被第二次保存改写', async () => {
    const { deps, repo, planId } = await makeDeps()
    const first = JSON.parse(await executePlanTool(deps, 'save_plan_days', { days: richDay() }))
    const second = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'free', title: '全新安排' }] }],
      }),
    )
    expect(first.revisionId).not.toBe(second.revisionId)

    const daymapMessages = (await repo.listMessages(planId)).filter((m) => m.kind === 'daymap')
    expect(daymapMessages).toHaveLength(2)
    const firstPayload = parseDaymapPayload(daymapMessages[0]!.content)!
    const secondPayload = parseDaymapPayload(daymapMessages[1]!.content)!
    // 旧快照保持第一次保存的内容（宇治桥还在），当前计划已整体替换
    expect(firstPayload.days[0]!.items.map((i) => i.title)).toContain('宇治桥')
    expect(secondPayload.days[0]!.items.map((i) => i.title)).toEqual(['全新安排'])
    expect((await repo.getPlan(planId))?.days[0].items[0].title).toBe('全新安排')
  })

  it('失败路径不产生 daymap：畸形时间/未知点位被拒时零消息、零天数写入', async () => {
    const { deps, repo, planId } = await makeDeps()
    const bad = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', pointId: 'ghost:id', title: '幽灵点位' }] }],
      }),
    )
    expect(bad.error).toBeTruthy()
    const messages = await repo.listMessages(planId)
    expect(messages.filter((m) => m.kind === 'daymap')).toHaveLength(0)
    expect((await repo.getPlan(planId))?.days).toHaveLength(0)
  })

  it('repo 原子方法：非 token 持有者调用 replaceDaysWithDaymapIfActive 返回 null，两写都不发生', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const run = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
      content: { role: 'user', content: 'hi' },
    })
    if (run.status !== 'ok') throw new Error('unreachable')

    const result = await repo.replaceDaysWithDaymapIfActive(
      plan.id,
      'not-the-token',
      [{ dayIndex: 1, items: [{ type: 'free', title: 'x' }] }],
      () => ({ type: 'daymap' }),
    )
    expect(result).toBeNull()
    expect((await repo.getPlan(plan.id))?.days).toHaveLength(0)
    expect((await repo.listMessages(plan.id)).filter((m) => m.kind === 'daymap')).toHaveLength(0)

    // 持有者调用则两写同时发生
    const ok = await repo.replaceDaysWithDaymapIfActive(
      plan.id,
      run.token,
      [{ dayIndex: 1, items: [{ type: 'free', title: 'x' }] }],
      (saved) => ({ type: 'daymap', revisionId: 'rev-1', savedAt: new Date().toISOString(), days: saved.days.map(() => null) }),
    )
    expect(ok).not.toBeNull()
    expect((await repo.getPlan(plan.id))?.days).toHaveLength(1)
    expect((await repo.listMessages(plan.id)).filter((m) => m.kind === 'daymap')).toHaveLength(1)
  })

  it('repo 原子方法：daymap 构建器抛错时整体回滚——天数保持第一版，不追加新 daymap 消息', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    await repo.replaceDaysWithDaymap(
      plan.id,
      [{ dayIndex: 1, items: [{ type: 'free', title: '第一版' }] }],
      (saved) => ({
        type: 'daymap',
        revisionId: 'rev-seed',
        savedAt: '2026-09-01T00:00:00Z',
        days: saved.days.map(() => null),
      }),
    )
    const daysBefore = (await repo.getPlan(plan.id))!.days

    await expect(
      repo.replaceDaysWithDaymap(
        plan.id,
        [{ dayIndex: 1, items: [{ type: 'free', title: '第二版' }] }],
        () => {
          throw new Error('daymap builder failed')
        },
      ),
    ).rejects.toThrow('daymap builder failed')

    const daysAfter = (await repo.getPlan(plan.id))!.days
    expect(daysAfter).toEqual(daysBefore)
    expect(daysAfter[0]!.items[0]!.title).toBe('第一版')
    expect((await repo.listMessages(plan.id)).filter((m) => m.kind === 'daymap')).toHaveLength(1)
  })

  it('repo 原子方法：持有者的 IfActive 版本构建器抛错同样回滚——两写都不发生', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    await repo.replaceDaysWithDaymap(
      plan.id,
      [{ dayIndex: 1, items: [{ type: 'free', title: '第一版' }] }],
      (saved) => ({
        type: 'daymap',
        revisionId: 'rev-seed',
        savedAt: '2026-09-01T00:00:00Z',
        days: saved.days.map(() => null),
      }),
    )
    const daysBefore = (await repo.getPlan(plan.id))!.days
    const run = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
      content: { role: 'user', content: 'hi' },
    })
    if (run.status !== 'ok') throw new Error('unreachable')

    await expect(
      repo.replaceDaysWithDaymapIfActive(
        plan.id,
        run.token,
        [{ dayIndex: 1, items: [{ type: 'free', title: '第二版' }] }],
        () => {
          throw new Error('daymap builder failed')
        },
      ),
    ).rejects.toThrow('daymap builder failed')

    expect((await repo.getPlan(plan.id))!.days).toEqual(daysBefore)
    expect((await repo.listMessages(plan.id)).filter((m) => m.kind === 'daymap')).toHaveLength(1)
  })

  it('repo 原子方法：持有权已被释放的旧 token 调用 IfActive 返回 null，天数与既有 daymap 均保持原状', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    await repo.replaceDaysWithDaymap(
      plan.id,
      [{ dayIndex: 1, items: [{ type: 'free', title: '第一版' }] }],
      (saved) => ({
        type: 'daymap',
        revisionId: 'rev-seed',
        savedAt: '2026-09-01T00:00:00Z',
        days: saved.days.map(() => null),
      }),
    )
    const daysBefore = (await repo.getPlan(plan.id))!.days
    const run = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
      content: { role: 'user', content: 'hi' },
    })
    if (run.status !== 'ok') throw new Error('unreachable')
    await repo.endAgentRun(plan.id, run.token)

    const result = await repo.replaceDaysWithDaymapIfActive(
      plan.id,
      run.token,
      [{ dayIndex: 1, items: [{ type: 'free', title: '越权写入' }] }],
      () => ({ type: 'daymap' }),
    )
    expect(result).toBeNull()
    expect((await repo.getPlan(plan.id))!.days).toEqual(daysBefore)
    expect((await repo.listMessages(plan.id)).filter((m) => m.kind === 'daymap')).toHaveLength(1)
  })
})

describe('runPlanAgent 的 daymap SSE 与历史重建', () => {
  it('保存成功后按序发出 plan_updated + daymap 事件；快照与落库消息同构；工具遥测不落库', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: ChatMessage[] = [
      assistantMessage({ tool_calls: [saveCall(richDay())] as ChatMessage['tool_calls'] }),
      assistantMessage({ content: '安排好了！' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '安排一天巡礼',
      (e) => events.push(e),
    )

    const daymapEvent = events.find((e) => e.type === 'daymap') as Extract<PlanAgentEvent, { type: 'daymap' }> | undefined
    expect(daymapEvent).toBeDefined()
    expect(events.findIndex((e) => e.type === 'plan_updated')).toBeLessThan(events.findIndex((e) => e.type === 'daymap'))
    expect(daymapEvent!.days[0]!.items.map((i) => i.title)).toContain('宇治桥')

    // SSE 事件过同一个解析器（与前端实时路径一致）
    const fromEvent = parseDaymapPayload(daymapEvent)
    expect(fromEvent!.revisionId).toBe(daymapEvent!.revisionId)

    const persisted = await repo.listMessages(plan.id)
    // daymap 在 tool 回执之前（随工具执行原子落库）；遥测（status/tool_call/reasoning）绝不落库
    expect(persisted.map((m) => m.kind)).toEqual(['human', 'assistant', 'daymap', 'tool', 'assistant'])
    const daymapRow = persisted.find((m) => m.kind === 'daymap')!
    expect(parseDaymapPayload(daymapRow.content)!.days).toEqual(fromEvent!.days)
    const persistedJson = JSON.stringify(persisted.map((m) => m.content))
    for (const telemetry of ['argsSummary', 'resultSummary', 'durationMs', 'phase']) {
      expect(persistedJson).not.toContain(telemetry)
    }
  })

  it('daymap 消息不进入模型上下文：下一轮回放没有 daymap 角色', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: ChatMessage[] = [
      assistantMessage({ tool_calls: [saveCall(richDay())] as ChatMessage['tool_calls'] }),
      assistantMessage({ content: '保存完成。' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '安排一天巡礼',
      () => {},
    )

    const seenRoles: string[] = []
    const secondCreate = vi.fn(async (params: { messages: Array<{ role: string }> }) => {
      seenRoles.push(...params.messages.map((m) => m.role))
      return assistantMessage({ content: '收到。' })
    })
    await runPlanAgent(
      { createMessage: secondCreate, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '再帮我调整一下',
      () => {},
    )
    // system + 历史 human/assistant/tool（成组）+ 收尾 assistant + 本轮 human；
    // daymap 无 role 字段被过滤，绝不进入模型上下文
    expect(seenRoles).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user'])
  })

  it('toChatView 按时间顺序在聊天流中插入 daymap：assistant 解释 → daymap → ask → user', () => {
    const daymapContent: DaymapMessagePayload = {
      type: 'daymap',
      revisionId: 'rev-1',
      savedAt: '2026-09-01T08:00:00Z',
      days: [{ id: 'day-1', dayIndex: 1, date: null, citySlug: null, summary: null, items: [] }],
    }
    const messages: TripPlanMessage[] = [
      { id: 'm1', planId: 'p1', kind: 'human', content: { role: 'user', content: '帮我规划' }, createdAt: new Date('2026-09-01T07:00:00Z') },
      { id: 'm2', planId: 'p1', kind: 'assistant', content: { role: 'assistant', content: '已经保存了第一版行程。' }, createdAt: new Date('2026-09-01T07:30:00Z') },
      { id: 'm3', planId: 'p1', kind: 'tool', content: { role: 'tool', tool_call_id: 'c1', content: '{}' }, createdAt: new Date('2026-09-01T07:30:01Z') },
      { id: 'm4', planId: 'p1', kind: 'daymap', content: daymapContent as unknown as TripPlanMessage['content'], createdAt: new Date('2026-09-01T07:30:02Z') },
      {
        id: 'm5',
        planId: 'p1',
        kind: 'ask',
        content: { askId: 'ask-1', kind: 'single_choice', taskType: 'opinion', prompt: '交通方式？', options: [{ id: 'a', label: '自驾', preferenceOnly: true }] } as unknown as TripPlanMessage['content'],
        createdAt: new Date('2026-09-01T07:40:00Z'),
      },
      { id: 'm6', planId: 'p1', kind: 'human', content: { role: 'user', content: '自驾吧' }, createdAt: new Date('2026-09-01T08:00:00Z') },
    ]
    const entries = toChatView(messages)
    expect(entries.map((e) => e.role)).toEqual(['user', 'assistant', 'assistant', 'assistant', 'user'])
    expect(entries[2]!.daymap?.revisionId).toBe('rev-1')
    expect(entries[2]!.text).toBe('')
    expect(entries[3]!.ask?.taskType).toBe('opinion')
  })
})

describe('parseDaymapPayload 防御性解析', () => {
  it('拒绝畸形载荷：缺 revisionId/savedAt、days 非数组、type 不符', () => {
    expect(parseDaymapPayload(null)).toBeNull()
    expect(parseDaymapPayload({ type: 'daymap' })).toBeNull()
    expect(parseDaymapPayload({ type: 'daymap', revisionId: 'r', savedAt: 's' })).toBeNull()
    expect(parseDaymapPayload({ type: 'other', revisionId: 'r', savedAt: 's', days: [] })).toBeNull()
    expect(parseDaymapPayload({ type: 'daymap', revisionId: '  ', savedAt: 's', days: [] })).toBeNull()
  })

  it('宽容修复次级字段：day 缺 id/dayIndex 时兜底，非对象条目被剔除', () => {
    const parsed = parseDaymapPayload({
      type: 'daymap',
      revisionId: 'rev-x',
      savedAt: '2026-09-01T00:00:00Z',
      days: [
        'not-a-day',
        { dayIndex: 2, items: [{ title: 'a' }, null] },
      ],
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.days).toHaveLength(1)
    expect(parsed!.days[0]!.id).toBe('day-1')
    expect(parsed!.days[0]!.dayIndex).toBe(2)
    expect(parsed!.days[0]!.items).toHaveLength(1)
  })
})
