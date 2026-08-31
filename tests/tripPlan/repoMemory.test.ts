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

  it('beginAgentRun enforces the daily quota atomically', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const since = new Date(Date.now() - 60_000)
    const base = { planId: plan.id, userId: 'u1', since, limit: 2, busyTtlMs: 60_000 }

    const first = await repo.beginAgentRun({ ...base, content: { role: 'user', content: 'hi' } })
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') throw new Error('unreachable')
    await repo.endAgentRun(plan.id, first.token)

    const second = await repo.beginAgentRun({ ...base, content: { role: 'user', content: 'again' } })
    expect(second.status).toBe('ok')
    if (second.status !== 'ok') throw new Error('unreachable')
    await repo.endAgentRun(plan.id, second.token)

    const third = await repo.beginAgentRun({ ...base, content: { role: 'user', content: 'over' } })
    expect(third.status).toBe('quota_exceeded')
    // 被拒的消息不落库
    expect(await repo.countHumanMessagesSince('u1', since)).toBe(2)
    expect(await repo.listMessages(plan.id)).toHaveLength(2)
  })

  it('beginAgentRun rejects a second run on the same plan until endAgentRun', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const since = new Date(Date.now() - 60_000)
    const base = { planId: plan.id, userId: 'u1', since, limit: 10, busyTtlMs: 60_000 }

    const first = await repo.beginAgentRun({ ...base, content: { role: 'user', content: 'a' } })
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') throw new Error('unreachable')

    const concurrent = await repo.beginAgentRun({ ...base, content: { role: 'user', content: 'b' } })
    expect(concurrent.status).toBe('busy')
    // busy 不落库、不占配额
    expect(await repo.listMessages(plan.id)).toHaveLength(1)

    await repo.endAgentRun(plan.id, first.token)
    const after = await repo.beginAgentRun({ ...base, content: { role: 'user', content: 'c' } })
    expect(after.status).toBe('ok')
  })

  it('beginAgentRun treats an expired busy claim as free (stale-lock recovery)', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const since = new Date(Date.now() - 60_000)

    const first = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since, limit: 10, busyTtlMs: -1000,
      content: { role: 'user', content: 'a' },
    })
    expect(first.status).toBe('ok')
    // TTL 已过期（负数模拟崩溃后未清锁），新请求可接管
    const second = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since, limit: 10, busyTtlMs: 60_000,
      content: { role: 'user', content: 'b' },
    })
    expect(second.status).toBe('ok')
  })

  it('endAgentRun with a stale token does not release a newer holder\'s lock (ABA)', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const since = new Date(Date.now() - 60_000)

    // 旧请求：TTL 极短，很快过期（模拟卡死到超时才走到 finally 的请求）
    const stale = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since, limit: 10, busyTtlMs: -1000,
      content: { role: 'user', content: 'stale' },
    })
    expect(stale.status).toBe('ok')
    if (stale.status !== 'ok') throw new Error('unreachable')

    // 新请求接管过期的锁
    const fresh = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since, limit: 10, busyTtlMs: 60_000,
      content: { role: 'user', content: 'fresh' },
    })
    expect(fresh.status).toBe('ok')
    if (fresh.status !== 'ok') throw new Error('unreachable')

    // 旧请求这时才跑到 finally，用自己拿到的旧 token 释放——必须是空操作
    await repo.endAgentRun(plan.id, stale.token)

    // 新请求的锁必须依然生效：第三个请求应该拿到 busy，而不是趁虚而入
    const intruder = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since, limit: 10, busyTtlMs: 60_000,
      content: { role: 'user', content: 'intruder' },
    })
    expect(intruder.status).toBe('busy')

    // 用正确的 token 释放才应该真正生效
    await repo.endAgentRun(plan.id, fresh.token)
    const afterCorrectRelease = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since, limit: 10, busyTtlMs: 60_000,
      content: { role: 'user', content: 'ok-now' },
    })
    expect(afterCorrectRelease.status).toBe('ok')
  })
})
