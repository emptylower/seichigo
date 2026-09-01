import { describe, it, expect, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool, PLAN_AGENT_TOOLS } from '@/lib/planAgent/tools'
import { PLAN_AGENT_SYSTEM_PROMPT } from '@/lib/planAgent/prompt'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import type { WorkCover } from '@/lib/planAgent/coverImage'
import {
  ASK_CUSTOM_OPTION_ID,
  ASK_USER_MAX_MODEL_OPTIONS,
  inferLegacyAskTaskType,
  type AskUserPayload,
} from '@/lib/planAgent/askUser'
import { toChatView } from '@/lib/tripPlan/view'
import type { PointFinder } from '@/lib/planAgent/points'

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
    return []
  },
}

async function makeDeps(): Promise<{ deps: PlanAgentToolDeps; repo: MemoryTripPlanRepo }> {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  return { deps: { planId: plan.id, repo, points: finder }, repo }
}

async function askSignal(deps: PlanAgentToolDeps, args: Record<string, unknown>): Promise<AskUserPayload> {
  const err = await executePlanTool(deps, 'ask_user', args).then(
    () => null,
    (e: unknown) => e,
  )
  if (!err || typeof (err as { payload?: AskUserPayload }).payload !== 'object') {
    throw new Error('expected AskUserSignal')
  }
  return (err as { payload: AskUserPayload }).payload
}

async function askError(deps: PlanAgentToolDeps, args: Record<string, unknown>): Promise<{ error?: string }> {
  return executePlanTool(deps, 'ask_user', args).then(
    (out) => JSON.parse(out) as { error?: string },
    () => {
      throw new Error('expected structured JSON error, not a signal')
    },
  )
}

describe('ask_user taskType 显式任务类型契约', () => {
  it('taskType 缺失/非法时结构化拒绝，不静默猜类型', async () => {
    const { deps } = await makeDeps()
    const missing = await askError(deps, { kind: 'date_range', prompt: 'x' })
    expect(missing.error).toContain('taskType')

    const invalid = await askError(deps, { taskType: 'vibes', kind: 'single_choice', prompt: 'x', options: [{ id: 'a', label: 'A', preferenceOnly: true }] })
    expect(invalid.error).toContain('taskType')
  })

  it('date_range：taskType/kind 不匹配的组合全部结构化拒绝', async () => {
    const { deps } = await makeDeps()
    const choiceOnDate = await askError(deps, { taskType: 'date_range', kind: 'single_choice', prompt: 'x' })
    expect(choiceOnDate.error).toContain('date_range')

    const dateOnChoice = await askError(deps, { taskType: 'opinion', kind: 'date_range', prompt: 'x' })
    expect(dateOnChoice.error).toContain('opinion')

    const dateOnWork = await askError(deps, { taskType: 'work_selection', kind: 'date_range', prompt: 'x' })
    expect(dateOnWork.error).toContain('work_selection')

    // date_range 带 options 也是不匹配结构
    const withOptions = await askError(deps, {
      taskType: 'date_range',
      kind: 'date_range',
      prompt: 'x',
      options: [{ id: 'a', label: 'A', preferenceOnly: true }],
    })
    expect(withOptions.error).toContain('options')
  })

  it('date_range 正常路径不受影响：无 options、载荷带 taskType', async () => {
    const { deps } = await makeDeps()
    const payload = await askSignal(deps, { taskType: 'date_range', kind: 'date_range', prompt: '什么时候出发？' })
    expect(payload.taskType).toBe('date_range')
    expect(payload.kind).toBe('date_range')
    expect(payload.options).toBeUndefined()
  })

  it('work_selection：单选/多选都合法，封面补齐与 bangumiId 规范出处保持', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const coverSpy = vi.fn(async (): Promise<WorkCover> => ({
      image: 'https://image.anitabi.cn/cover.jpg',
      source: 'anitabi',
      sourceUrl: 'anitabi:bangumi:115908',
      fetchedAt: '2026-09-01T00:00:00.000Z',
      attribution: 'Anitabi',
    }))
    const deps: PlanAgentToolDeps = { planId: plan.id, repo, points: finder, resolveOptionCover: coverSpy }

    for (const kind of ['single_choice', 'multi_choice'] as const) {
      const payload = await askSignal(deps, {
        taskType: 'work_selection',
        kind,
        prompt: '想巡礼哪部？',
        options: [{ id: 'a', label: '吹响吧！上低音号', bangumiId: 115908 }],
      })
      expect(payload.taskType).toBe('work_selection')
      expect(payload.options?.[0]).toMatchObject({
        bangumiId: 115908,
        image: 'https://image.anitabi.cn/cover.jpg',
        imageSource: 'anitabi',
        sourceKind: 'anitabi',
        sourceUrl: 'anitabi:bangumi:115908',
      })
      // 最终澄清：作品选择不追加保留的自定义选项（自由文本走全局输入框）
      expect(payload.options?.some((o) => o.id === ASK_CUSTOM_OPTION_ID)).toBe(false)
    }
    expect(coverSpy).toHaveBeenCalledTimes(2)
  })

  it('opinion：不调用 resolveOptionCover，拒绝 bangumiId 与 image 作品字段', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const coverSpy = vi.fn(async () => null)
    const deps: PlanAgentToolDeps = { planId: plan.id, repo, points: finder, resolveOptionCover: coverSpy }

    const withBangumi = await askError(deps, {
      taskType: 'opinion',
      kind: 'single_choice',
      prompt: '交通方式？',
      options: [
        { id: 'car', label: '自驾/租车', preferenceOnly: true },
        { id: 'work', label: '某作品', bangumiId: 115908 },
      ],
    })
    expect(withBangumi.error).toContain('bangumiId')
    expect(withBangumi.error).toContain('opinion')

    const withImage = await askError(deps, {
      taskType: 'opinion',
      kind: 'single_choice',
      prompt: '交通方式？',
      options: [
        { id: 'car', label: '自驾/租车', preferenceOnly: true },
        { id: 'pic', label: '带图选项', image: 'https://img-tc.anitabi.cn/works/1.jpg', sourceKind: 'anitabi', sourceUrl: 'anitabi:works:1', fetchedAt: '2026-09-01T00:00:00Z' },
      ],
    })
    expect(withImage.error).toContain('image')

    expect(coverSpy).not.toHaveBeenCalled()
  })

  it('opinion：preferenceOnly 纯偏好选项与带三件套出处的事实选项都通过，末位追加自定义', async () => {
    const { deps } = await makeDeps()
    const payload = await askSignal(deps, {
      taskType: 'opinion',
      kind: 'single_choice',
      prompt: '这次山区行程以什么交通方式为主？',
      options: [
        { id: 'car', label: '自驾/租车', sublabel: '山区公交班次少，自驾最灵活', preferenceOnly: true },
        { id: 'transit', label: '公共交通', sublabel: '经济但换乘耗时', preferenceOnly: true },
        { id: 'mix', label: '混合方式', preferenceOnly: true },
        {
          id: 'fact',
          label: '参考某地点方案',
          sourceKind: 'google_places',
          sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJ1',
          fetchedAt: '2026-09-01T08:00:00Z',
        },
      ],
    })
    expect(payload.taskType).toBe('opinion')
    expect(payload.options).toHaveLength(5)
    expect(payload.options?.[payload.options.length - 1]?.id).toBe(ASK_CUSTOM_OPTION_ID)
    // 纯偏好选项显式带 preferenceOnly，事实选项保留三件套但无作品字段
    expect(payload.options?.[0]?.preferenceOnly).toBe(true)
    expect(payload.options?.[3]).toMatchObject({ sourceKind: 'google_places' })
    expect(payload.options?.every((o) => o.bangumiId === undefined && o.image === undefined)).toBe(true)
  })

  it('opinion：无出处的选项仍被证据门拒绝（三件套契约不因任务类型放松）', async () => {
    const { deps } = await makeDeps()
    const uncited = await askError(deps, {
      taskType: 'opinion',
      kind: 'single_choice',
      prompt: '交通方式？',
      options: [{ id: 'car', label: '自驾/租车' }],
    })
    expect(uncited.error).toContain('sourceKind')
    expect(uncited.error).toContain('preferenceOnly')
  })

  it('两类选择题超过 19 个模型选项仍拒绝（opinion 的自定义入口保留在末位）', async () => {
    const { deps } = await makeDeps()
    const tooMany = Array.from({ length: ASK_USER_MAX_MODEL_OPTIONS + 1 }, (_, i) => ({
      id: `o${i}`,
      label: `选项${i}`,
      preferenceOnly: true,
    }))
    for (const taskType of ['work_selection', 'opinion'] as const) {
      const out = await askError(deps, { taskType, kind: 'single_choice', prompt: '选', options: tooMany })
      expect(out.error).toContain(String(ASK_USER_MAX_MODEL_OPTIONS))
    }
  })
})

describe('历史 ask 载荷的兼容归一化（渲染层）', () => {
  it('inferLegacyAskTaskType：date_range / 全 preferenceOnly 无 bangumiId → opinion / 其余 → work_selection', () => {
    expect(inferLegacyAskTaskType({ kind: 'date_range' })).toBe('date_range')
    expect(
      inferLegacyAskTaskType({
        kind: 'single_choice',
        options: [
          { id: 'a', label: '轻松', preferenceOnly: true },
          { id: 'b', label: '紧凑', preferenceOnly: true },
        ],
      }),
    ).toBe('opinion')
    // 回归：旧 M3 意见题落库时已带服务端追加的末位 __custom__（无 preferenceOnly），
    // 判定"全部 preferenceOnly"必须忽略保留自定义项，否则刷新后误渲染成作品卡
    expect(
      inferLegacyAskTaskType({
        kind: 'multi_choice',
        options: [
          { id: 'car', label: '自驾/租车', preferenceOnly: true },
          { id: 'transit', label: '公共交通', preferenceOnly: true },
          { id: 'mix', label: '混合方式', preferenceOnly: true },
          { id: ASK_CUSTOM_OPTION_ID, label: '其他（自行输入）' },
        ],
      }),
    ).toBe('opinion')
    // 带 bangumiId 的旧作品选择 → work_selection（旧作品卡视觉不变）
    expect(
      inferLegacyAskTaskType({
        kind: 'single_choice',
        options: [
          { id: 'a', label: '本传', bangumiId: 115908 },
          { id: 'b', label: '剧场版', preferenceOnly: true },
        ],
      }),
    ).toBe('work_selection')
    // 有出处三件套的旧事实选项（非全 preferenceOnly）→ work_selection
    expect(
      inferLegacyAskTaskType({
        kind: 'single_choice',
        options: [{ id: 'a', label: '迪士尼', sourceKind: 'google_places', sourceUrl: 'https://maps.example', fetchedAt: '2026-09-01T00:00:00Z' }],
      }),
    ).toBe('work_selection')
    expect(inferLegacyAskTaskType({ kind: 'multi_choice' })).toBe('work_selection')
  })

  it('toChatView 给历史无 taskType 的 ask 补推断值；已有 taskType 的原样保留', () => {
    const entries = toChatView([
      {
        id: 'm1',
        planId: 'p1',
        kind: 'ask',
        // 旧意见题：全部 preferenceOnly 且无 bangumiId（落库形状含末位 __custom__）
        content: {
          askId: 'ask-legacy-opinion',
          kind: 'single_choice',
          prompt: '节奏怎么排？',
          options: [
            { id: 'easy', label: '轻松一点', preferenceOnly: true },
            { id: 'tight', label: '紧凑一点', preferenceOnly: true },
            { id: ASK_CUSTOM_OPTION_ID, label: '其他（自行输入）' },
          ],
        } as unknown as Prisma.JsonValue,
        createdAt: new Date('2026-08-01T00:00:00Z'),
      },
      {
        id: 'm2',
        planId: 'p1',
        kind: 'ask',
        // 旧作品选择：带 bangumiId
        content: {
          askId: 'ask-legacy-work',
          kind: 'single_choice',
          prompt: '选一部',
          options: [{ id: 'a', label: '本传', bangumiId: 115908 }],
        } as unknown as Prisma.JsonValue,
        createdAt: new Date('2026-08-02T00:00:00Z'),
      },
      {
        id: 'm3',
        planId: 'p1',
        kind: 'ask',
        // 新载荷已带 taskType，原样保留
        content: { askId: 'ask-new', kind: 'date_range', taskType: 'date_range', prompt: '什么时候出发？' } as unknown as Prisma.JsonValue,
        createdAt: new Date('2026-08-03T00:00:00Z'),
      },
    ])
    expect(entries.map((e) => e.ask?.taskType)).toEqual(['opinion', 'work_selection', 'date_range'])
  })
})

describe('工具 schema 与提示词的任务类型术语', () => {
  it('ask_user schema 要求 taskType 必填，并写明三种任务类型语义与意见题示例', () => {
    const fn = PLAN_AGENT_TOOLS.map((t) => (t.type === 'function' ? t.function : null)).find((f) => f?.name === 'ask_user')
    expect(fn).toBeDefined()
    const params = fn!.parameters as Record<string, any>
    expect(params.required).toContain('taskType')
    expect(params.properties.taskType.enum).toEqual(['date_range', 'work_selection', 'opinion'])
    expect(fn!.description).toContain('work_selection')
    expect(fn!.description).toContain('opinion')
    expect(fn!.description).toContain('自驾')
  })

  it('系统提示词写明三类 taskType 与"交通方式题必须是 opinion、不能当作品选择"', () => {
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('taskType=work_selection')
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('taskType=opinion')
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('taskType=date_range')
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('自驾/租车')
    expect(PLAN_AGENT_SYSTEM_PROMPT).toMatch(/不能当作品选择|不要用 taskType=work_selection 发起/)
  })
})
