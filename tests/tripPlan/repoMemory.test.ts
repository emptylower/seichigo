import { describe, it, expect, vi } from 'vitest'
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

  it('beginAgentRun with content=null（resume 回合）抢占 busy 位但不追加 human 消息；配额按现有消息数计', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    await repo.appendMessage(plan.id, 'human', { role: 'user', content: '被打断的那条' })
    const since = new Date(0)

    const resume = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', content: null, since, limit: 2, busyTtlMs: 60_000,
    })
    expect(resume.status).toBe('ok')
    if (resume.status !== 'ok') throw new Error('unreachable')
    // 不追加 human：消息数不变；token 照常可用于栅栏写
    expect(await repo.listMessages(plan.id)).toHaveLength(1)

    // 配额检查仍按已落库 human 数计算：被打断的回合已用完当日额度时 resume 也拒绝
    await repo.endAgentRun(plan.id, resume.token)
    const exhausted = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', content: null, since, limit: 1, busyTtlMs: 60_000,
    })
    expect(exhausted.status).toBe('quota_exceeded')
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

  it('appendMessageIfActive / replaceDaysIfActive / updateMetaIfActive atomically no-op once fenced out', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const since = new Date(0)

    const stale = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since, limit: 100, busyTtlMs: -1000,
      content: { role: 'user', content: 'a' },
    })
    if (stale.status !== 'ok') throw new Error('unreachable')
    const fresh = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since, limit: 100, busyTtlMs: 60_000,
      content: { role: 'user', content: 'b' },
    })
    if (fresh.status !== 'ok') throw new Error('unreachable')

    // 用已经过期/被接管的旧 token 尝试三种写，全部必须原子拒绝、不落库
    expect(
      await repo.appendMessageIfActive(plan.id, stale.token, 'assistant', { role: 'assistant', content: 'x' }),
    ).toBeNull()
    expect(
      await repo.replaceDaysIfActive(plan.id, stale.token, [{ dayIndex: 1, items: [{ type: 'free', title: 'x' }] }]),
    ).toBeNull()
    expect(await repo.updateMetaIfActive(plan.id, stale.token, { title: '不该生效' })).toBeNull()

    const plan1 = await repo.getPlan(plan.id)
    expect(plan1?.title).toBe('t')
    expect(plan1?.days).toHaveLength(0)
    expect((await repo.listMessages(plan.id)).filter((m) => m.kind === 'assistant')).toHaveLength(0)

    // 用当前合法 token 则正常生效
    expect(
      await repo.appendMessageIfActive(plan.id, fresh.token, 'assistant', { role: 'assistant', content: 'ok' }),
    ).not.toBeNull()
    expect(
      await repo.replaceDaysIfActive(plan.id, fresh.token, [{ dayIndex: 1, items: [{ type: 'free', title: 'ok' }] }]),
    ).not.toBeNull()
    expect(await repo.updateMetaIfActive(plan.id, fresh.token, { title: '生效了' })).not.toBeNull()

    const plan2 = await repo.getPlan(plan.id)
    expect(plan2?.title).toBe('生效了')
    expect(plan2?.days).toHaveLength(1)
  })

  it('S2：replaceDaysIfUnchanged 版本守卫——updatedAt 不匹配返回 null 不写；匹配则整份替换并推进版本', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-03T00:00:00.000Z'))
      const repo = new MemoryTripPlanRepo()
      const plan = await repo.createPlan({ userId: 'u1', title: 't' })
      await repo.replaceDays(plan.id, [{ dayIndex: 1, items: [{ type: 'free', title: 'v1' }] }])

      vi.setSystemTime(new Date('2026-09-03T00:00:01.000Z'))
      const read = await repo.getPlan(plan.id)
      const staleExpectation = new Date(read!.updatedAt.getTime() - 1000)
      // 期间被并发保存改过（期望值是旧的）→ 整体不写
      expect(
        await repo.replaceDaysIfUnchanged(plan.id, staleExpectation, [
          { dayIndex: 1, items: [{ type: 'free', title: '不该生效' }] },
        ]),
      ).toBeNull()
      expect((await repo.getPlan(plan.id))?.days[0]?.items[0]?.title).toBe('v1')

      // 版本仍匹配 → 写入成功且 updatedAt 前进
      vi.setSystemTime(new Date('2026-09-03T00:00:02.000Z'))
      const out = await repo.replaceDaysIfUnchanged(plan.id, read!.updatedAt, [
        { dayIndex: 1, items: [{ type: 'free', title: 'v2' }] },
      ])
      expect(out?.days[0]?.items[0]?.title).toBe('v2')
      const after = await repo.getPlan(plan.id)
      expect(after?.days[0]?.items[0]?.title).toBe('v2')
      expect(after!.updatedAt.getTime()).toBeGreaterThan(read!.updatedAt.getTime())
      // 版本已前进：旧期望值再写一次必须被拒绝
      expect(
        await repo.replaceDaysIfUnchanged(plan.id, read!.updatedAt, [
          { dayIndex: 1, items: [{ type: 'free', title: '也不该生效' }] },
        ]),
      ).toBeNull()

      // 计划不存在 → null
      expect(await repo.replaceDaysIfUnchanged('plan-不存在', new Date(), [])).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('S2：getPlan 暴露 agentRunToken/agentBusyUntil——运行中可见、endAgentRun 后清空', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    expect((await repo.getPlan(plan.id))?.agentRunToken).toBeNull()
    expect((await repo.getPlan(plan.id))?.agentBusyUntil).toBeNull()

    const run = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
      content: { role: 'user', content: 'hi' },
    })
    if (run.status !== 'ok') throw new Error('unreachable')

    const during = await repo.getPlan(plan.id)
    expect(during?.agentRunToken).toBe(run.token)
    expect(during?.agentBusyUntil).toBeInstanceOf(Date)

    await repo.endAgentRun(plan.id, run.token)
    const after = await repo.getPlan(plan.id)
    expect(after?.agentRunToken).toBeNull()
    expect(after?.agentBusyUntil).toBeNull()
  })

  it('F3：renewAgentRun 续租 busy 位——token 匹配才续、过期后仍可自救、token 不匹配是空操作', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-03T00:00:00.000Z'))
      const repo = new MemoryTripPlanRepo()
      const plan = await repo.createPlan({ userId: 'u1', title: 't' })
      const run = await repo.beginAgentRun({
        planId: plan.id,
        userId: 'u1',
        since: new Date(0),
        limit: 10,
        busyTtlMs: 3 * 60 * 1000,
        content: { role: 'user', content: 'a' },
      })
      if (run.status !== 'ok') throw new Error('unreachable')

      // TTL 内续租：busyUntil 推进到 now + ttl
      vi.setSystemTime(new Date('2026-09-03T00:01:00.000Z'))
      expect(await repo.renewAgentRun(plan.id, run.token, 3 * 60 * 1000)).toBe(true)
      const renewed = await repo.getPlan(plan.id)
      expect(renewed?.agentBusyUntil?.getTime()).toBe(new Date('2026-09-03T00:04:00.000Z').getTime())

      // 原 TTL（00:03:00）已过：靠续租活着的 run 依然持有 busy 位
      vi.setSystemTime(new Date('2026-09-03T00:03:30.000Z'))
      expect(await repo.isAgentBusy(plan.id)).toBe(true)
      const intruder = await repo.beginAgentRun({
        planId: plan.id,
        userId: 'u1',
        since: new Date(0),
        limit: 10,
        busyTtlMs: 60_000,
        content: { role: 'user', content: 'b' },
      })
      expect(intruder.status).toBe('busy')

      // token 不匹配（已被接管/已释放的旧持有者）：空操作且返回 false
      expect(await repo.renewAgentRun(plan.id, 'not-the-holder', 60_000)).toBe(false)
      const untouched = await repo.getPlan(plan.id)
      expect(untouched?.agentBusyUntil?.getTime()).toBe(new Date('2026-09-03T00:04:00.000Z').getTime())

      // run 结束释放后：续租同样失效
      await repo.endAgentRun(plan.id, run.token)
      expect(await repo.renewAgentRun(plan.id, run.token, 60_000)).toBe(false)
      expect(await repo.isAgentBusy(plan.id)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
