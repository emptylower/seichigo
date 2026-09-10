import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { DEFAULT_PLAN_TITLE } from '@/lib/tripPlan/repo'
import { maybeSetGeneratedTitle } from '@/lib/planAgent/title'
import { PLAN_AGENT_SYSTEM_PROMPT } from '@/lib/planAgent/prompt'

describe('maybeSetGeneratedTitle（标题侧信道）', () => {
  it('标题仍是默认值时写入生成标题并回调 onTitleUpdated', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: DEFAULT_PLAN_TITLE })
    const onTitleUpdated = vi.fn()
    const updateMeta = vi.spyOn(repo, 'updateMeta')

    await maybeSetGeneratedTitle(
      { repo, planId: plan.id, createTitle: async () => '京吹京都三日巡礼', onTitleUpdated },
      '帮我安排去京都的京吹圣地巡礼',
    )

    expect(updateMeta).toHaveBeenCalledTimes(1)
    expect((await repo.getPlan(plan.id))?.title).toBe('京吹京都三日巡礼')
    expect(onTitleUpdated).toHaveBeenCalledTimes(1)
  })

  it('标题已被 agent 主流程改写时不覆盖', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 'LLM 已起好的标题' })
    const onTitleUpdated = vi.fn()
    const updateMeta = vi.spyOn(repo, 'updateMeta')

    await maybeSetGeneratedTitle(
      { repo, planId: plan.id, createTitle: async () => '侧信道标题', onTitleUpdated },
      '改一下第二天的安排',
    )

    expect(updateMeta).not.toHaveBeenCalled()
    expect((await repo.getPlan(plan.id))?.title).toBe('LLM 已起好的标题')
    expect(onTitleUpdated).not.toHaveBeenCalled()
  })

  it('生成结果为空时什么都不写', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: DEFAULT_PLAN_TITLE })
    const onTitleUpdated = vi.fn()

    await maybeSetGeneratedTitle(
      { repo, planId: plan.id, createTitle: async () => null, onTitleUpdated },
      '帮我规划',
    )

    expect((await repo.getPlan(plan.id))?.title).toBe(DEFAULT_PLAN_TITLE)
    expect(onTitleUpdated).not.toHaveBeenCalled()
  })

  it('标题生成调用失败时静默吞掉，不抛出', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: DEFAULT_PLAN_TITLE })

    await expect(
      maybeSetGeneratedTitle(
        { repo, planId: plan.id, createTitle: async () => { throw new Error('网络超时') } },
        '帮我规划',
      ),
    ).resolves.toBeUndefined()

    expect((await repo.getPlan(plan.id))?.title).toBe(DEFAULT_PLAN_TITLE)
  })

  it('repo 查询失败时静默吞掉，不抛出', async () => {
    const repo = new MemoryTripPlanRepo()
    vi.spyOn(repo, 'getPlanTitle').mockRejectedValue(new Error('db down'))

    await expect(
      maybeSetGeneratedTitle(
        { repo, planId: 'plan-x', createTitle: async () => '标题' },
        '帮我规划',
      ),
    ).resolves.toBeUndefined()
  })

  it('计划不存在（getPlanTitle 返回 null）→ 不调 updateMeta', async () => {
    const repo = new MemoryTripPlanRepo()
    const updateMeta = vi.spyOn(repo, 'updateMeta')

    await maybeSetGeneratedTitle(
      { repo, planId: 'plan-missing', createTitle: async () => '标题' },
      '帮我规划',
    )

    expect(updateMeta).not.toHaveBeenCalled()
  })

  it('title 为空串 → 不调 updateMeta（回归：证明没写成 if (!title0)）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: '' })
    const updateMeta = vi.spyOn(repo, 'updateMeta')

    await maybeSetGeneratedTitle(
      { repo, planId: plan.id, createTitle: async () => '标题' },
      '帮我规划',
    )

    expect(updateMeta).not.toHaveBeenCalled()
    expect((await repo.getPlan(plan.id))?.title).toBe('')
  })
})

describe('system prompt 标题时机提示', () => {
  it('工作流程引导确定作品后先写初步标题', () => {
    expect(PLAN_AGENT_SYSTEM_PROMPT).toMatch(/update_plan_meta/)
    expect(PLAN_AGENT_SYSTEM_PROMPT).toMatch(/初步标题|先写入.*标题/)
  })
})
