import { describe, it, expect } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { RUN_LIVE_REASONING_MAX, clampRunLiveReasoning } from '@/lib/tripPlan/repo'

/** 第七轮 A1：TripPlanRepo 运行实况（repoMemory 实现）的写入语义 */
describe('TripPlanRepo 运行实况（repoMemory）', () => {
  it('首写建行；同 runToken 追加 reasoning、增量覆盖 statusText/toolCalls；getRunLive 读回', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const first = await repo.upsertRunLive(plan.id, {
      runToken: 'run-1',
      reasoningAppend: '第一段',
      statusText: '搜索中',
      toolCalls: [{ name: 'search_bangumi_tv', status: 'running' }],
    })
    expect(first).toMatchObject({ planId: plan.id, runToken: 'run-1', reasoning: '第一段', statusText: '搜索中' })

    await repo.upsertRunLive(plan.id, {
      runToken: 'run-1',
      reasoningAppend: '第二段',
      toolCalls: [{ name: 'search_bangumi_tv', status: 'done', summary: '找到 3 部' }],
    })
    const row = await repo.getRunLive(plan.id)
    // 同 token：reasoning 追加；statusText 未传保持；toolCalls 传入覆盖
    expect(row?.reasoning).toBe('第一段第二段')
    expect(row?.statusText).toBe('搜索中')
    expect(row?.toolCalls).toEqual([{ name: 'search_bangumi_tv', status: 'done', summary: '找到 3 部' }])
  })

  it('reasoningReplace 整体替换（同 token）；undefined 的 statusText/toolCalls 保持原值', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    await repo.upsertRunLive(plan.id, { runToken: 'run-1', reasoningReplace: '旧全文', statusText: 's', toolCalls: [] })
    await repo.upsertRunLive(plan.id, { runToken: 'run-1', reasoningReplace: '新全文' })
    const row = await repo.getRunLive(plan.id)
    expect(row?.reasoning).toBe('新全文')
    expect(row?.statusText).toBe('s')
    expect(row?.toolCalls).toEqual([])
  })

  it('不同 runToken = 新 run 接管：整行重置（reasoning 不拼接旧值，未传字段回到 null）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    await repo.upsertRunLive(plan.id, {
      runToken: 'run-old',
      reasoningReplace: '旧 run 的思考',
      statusText: '旧状态',
      toolCalls: [{ name: 'read_plan', status: 'done' }],
    })
    await repo.upsertRunLive(plan.id, { runToken: 'run-new', reasoningAppend: '新 run 起步' })
    const row = await repo.getRunLive(plan.id)
    expect(row).toMatchObject({ runToken: 'run-new', reasoning: '新 run 起步', statusText: null, toolCalls: null })
  })

  it('reasoning 超 20,000 字符截头保尾（clampRunLiveReasoning + repo 落库同规则）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const long = 'a'.repeat(25_000)
    expect(clampRunLiveReasoning(long)).toHaveLength(RUN_LIVE_REASONING_MAX)
    expect(clampRunLiveReasoning(long).startsWith('a')).toBe(true)

    await repo.upsertRunLive(plan.id, { runToken: 'run-1', reasoningReplace: long })
    const row = await repo.getRunLive(plan.id)
    expect(row?.reasoning).toHaveLength(RUN_LIVE_REASONING_MAX)

    // 追加路径同样截尾：总长超限时保留末尾
    await repo.clearRunLive(plan.id)
    await repo.upsertRunLive(plan.id, { runToken: 'run-2', reasoningAppend: 'b'.repeat(RUN_LIVE_REASONING_MAX) })
    await repo.upsertRunLive(plan.id, { runToken: 'run-2', reasoningAppend: '尾部新增' })
    const appended = await repo.getRunLive(plan.id)
    expect(appended?.reasoning).toHaveLength(RUN_LIVE_REASONING_MAX)
    expect(appended?.reasoning.endsWith('尾部新增')).toBe(true)
  })

  it('getRunLive 无行返回 null；clearRunLive 删除行（幂等）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    expect(await repo.getRunLive(plan.id)).toBeNull()
    await repo.upsertRunLive(plan.id, { runToken: 'run-1', reasoningReplace: 'x' })
    expect(await repo.getRunLive(plan.id)).not.toBeNull()
    await repo.clearRunLive(plan.id)
    expect(await repo.getRunLive(plan.id)).toBeNull()
    await expect(repo.clearRunLive(plan.id)).resolves.toBeUndefined()
  })

  it('实况行按 planId 隔离，互不串扰', async () => {
    const repo = new MemoryTripPlanRepo()
    const a = await repo.createPlan({ userId: 'u1', title: 'a' })
    const b = await repo.createPlan({ userId: 'u1', title: 'b' })
    await repo.upsertRunLive(a.id, { runToken: 'run-a', reasoningReplace: 'A' })
    await repo.upsertRunLive(b.id, { runToken: 'run-b', reasoningReplace: 'B' })
    expect((await repo.getRunLive(a.id))?.runToken).toBe('run-a')
    expect((await repo.getRunLive(b.id))?.runToken).toBe('run-b')
    await repo.clearRunLive(a.id)
    expect(await repo.getRunLive(a.id)).toBeNull()
    expect(await repo.getRunLive(b.id)).not.toBeNull()
  })
})
