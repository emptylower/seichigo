import { describe, it, expect } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'

describe('MemoryTripPlanRepo', () => {
  it('creates and lists plans scoped to user', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: '京都京吹巡礼' })
    await repo.createPlan({ userId: 'u2', title: '别人的计划' })

    expect(plan.status).toBe('draft')
    expect(plan.dayCount).toBe(1)
    const list = await repo.listPlans('u1')
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('京都京吹巡礼')
  })

  it('replaceDays swaps the whole day structure and resolves seeded points', async () => {
    const repo = new MemoryTripPlanRepo({
      points: new Map([
        ['p1', { id: 'p1', name: 'Uji Bridge', nameZh: '宇治桥', lat: 34.889, lng: 135.807, image: null }],
      ]),
    })
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const updated = await repo.replaceDays(plan.id, [
      {
        dayIndex: 1,
        summary: '宇治日',
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥', reason: '京吹核心取景地' },
          { type: 'transit', title: 'JR 奈良线', note: '约 20 分钟' },
        ],
      },
    ])

    expect(updated.days).toHaveLength(1)
    expect(updated.days[0].items).toHaveLength(2)
    expect(updated.days[0].items[0].sortOrder).toBe(0)
    expect(updated.days[0].items[0].point?.nameZh).toBe('宇治桥')
    expect(updated.days[0].items[1].point).toBeNull()

    const replaced = await repo.replaceDays(plan.id, [
      { dayIndex: 1, items: [{ type: 'free', title: '自由活动' }] },
    ])
    expect(replaced.days[0].items).toHaveLength(1)
  })

  it('updateMeta patches fields and bumps updatedAt', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const updated = await repo.updateMeta(plan.id, { title: '新标题', dayCount: 4, status: 'upcoming', bangumiIds: [115908] })
    expect(updated.title).toBe('新标题')
    expect(updated.dayCount).toBe(4)
    expect(updated.status).toBe('upcoming')
    expect(updated.bangumiIds).toEqual([115908])
  })

  it('counts plans and messages since a date for quota checks', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    await repo.appendMessage(plan.id, 'human', { role: 'user', content: 'hi' })
    await repo.appendMessage(plan.id, 'tool', { role: 'user', content: [] })
    await repo.appendMessage(plan.id, 'assistant', { role: 'assistant', content: [] })

    const since = new Date(Date.now() - 60_000)
    expect(await repo.countPlansCreatedSince('u1', since)).toBe(1)
    expect(await repo.countHumanMessagesSince('u1', since)).toBe(1)
    expect(await repo.countHumanMessagesSince('u2', since)).toBe(0)
    expect(await repo.listMessages(plan.id)).toHaveLength(3)
  })

  it('appendHumanMessageIfWithinQuota persists atomically and rejects once limit reached', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const since = new Date(Date.now() - 60_000)

    const first = await repo.appendHumanMessageIfWithinQuota({
      planId: plan.id,
      userId: 'u1',
      content: { role: 'user', content: 'hi' },
      since,
      limit: 2,
    })
    expect(first).not.toBeNull()
    expect(first?.kind).toBe('human')

    const second = await repo.appendHumanMessageIfWithinQuota({
      planId: plan.id,
      userId: 'u1',
      content: { role: 'user', content: 'again' },
      since,
      limit: 2,
    })
    expect(second).not.toBeNull()

    const third = await repo.appendHumanMessageIfWithinQuota({
      planId: plan.id,
      userId: 'u1',
      content: { role: 'user', content: 'over' },
      since,
      limit: 2,
    })
    expect(third).toBeNull()
    // 被拒的消息不落库
    expect(await repo.countHumanMessagesSince('u1', since)).toBe(2)
    expect(await repo.listMessages(plan.id)).toHaveLength(2)
  })
})
