import { describe, it, expect } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import {
  ASK_CUSTOM_OPTION_ID,
  ASK_USER_MAX_MODEL_OPTIONS,
  isAskCustomOption,
  reservedCustomOption,
  type AskUserPayload,
} from '@/lib/planAgent/askUser'
import { toChatView } from '@/lib/tripPlan/view'
import type { PointFinder } from '@/lib/planAgent/points'
import type { Prisma } from '@prisma/client'

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

async function makeDeps(): Promise<{ deps: PlanAgentToolDeps; planId: string }> {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  return { deps: { planId: plan.id, repo, points: finder }, planId: plan.id }
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

describe('ask_user 自定义选项契约（最终澄清：仅 opinion 追加 __custom__）', () => {
  it('work_selection single_choice：模型选项原样保留，不追加保留的自定义选项', async () => {
    const { deps } = await makeDeps()
    const payload = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '选一部',
      options: [
        { id: 'a', label: '本传', sublabel: '47 个点位', bangumiId: 115908 },
        { id: 'b', label: '剧场版', bangumiId: 115909 },
      ],
    })
    expect(payload.options?.map((o) => o.id)).toEqual(['a', 'b'])
    // 作品选择卡不渲染自定义卡，服务端也不追加该保留项
    expect(payload.options?.some(isAskCustomOption)).toBe(false)
  })

  it('opinion single_choice：模型选项保留，末位追加保留的自定义选项', async () => {
    const { deps } = await makeDeps()
    const payload = await askSignal(deps, {
      taskType: 'opinion',
      kind: 'single_choice',
      prompt: '交通方式？',
      options: [
        { id: 'car', label: '自驾/租车', preferenceOnly: true },
        { id: 'transit', label: '公共交通', preferenceOnly: true },
      ],
    })
    expect(payload.options?.map((o) => o.id)).toEqual(['car', 'transit', ASK_CUSTOM_OPTION_ID])
    const custom = payload.options?.[payload.options.length - 1]
    expect(isAskCustomOption(custom!)).toBe(true)
  })

  it('multi_choice：work 不追加自定义；选项溯源字段透传并清洗', async () => {
    const { deps } = await makeDeps()
    const payload = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'multi_choice',
      prompt: '想去哪几部？',
      options: [
        {
          id: 'a',
          label: '本传',
          bangumiId: 115908,
          sourceKind: 'anitabi',
          sourceUrl: 'anitabi:bangumi:115908',
        },
      ],
    })
    const first = payload.options?.[0]
    expect(first).toMatchObject({
      id: 'a',
      label: '本传',
      bangumiId: 115908,
      sourceKind: 'anitabi',
      sourceUrl: 'anitabi:bangumi:115908',
    })
    expect(payload.options?.some(isAskCustomOption)).toBe(false)
  })

  it('date_range：不追加任何选项（日期组件语义不变）', async () => {
    const { deps } = await makeDeps()
    const payload = await askSignal(deps, { taskType: 'date_range', kind: 'date_range', prompt: '什么时候去？' })
    expect(payload.options).toBeUndefined()
  })

  it('模型选项超过 19 个时结构化拒绝——保证 opinion 的自定义选项始终放得进 20 上限', async () => {
    const { deps } = await makeDeps()
    const tooMany = Array.from({ length: ASK_USER_MAX_MODEL_OPTIONS + 1 }, (_, i) => ({ id: `o${i}`, label: `选项${i}` }))
    const out = JSON.parse(await executePlanTool(deps, 'ask_user', { taskType: 'work_selection', kind: 'single_choice', prompt: '选', options: tooMany }))
    expect(out.error).toContain(String(ASK_USER_MAX_MODEL_OPTIONS))

    // 恰好 19 个：work 放行且保持 19 个；opinion 放行并追加自定义后共 20
    const work = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '选',
      options: Array.from({ length: ASK_USER_MAX_MODEL_OPTIONS }, (_, i) => ({ id: `o${i}`, label: `选项${i}`, preferenceOnly: true })),
    })
    expect(work.options).toHaveLength(ASK_USER_MAX_MODEL_OPTIONS)
    const opinion = await askSignal(deps, {
      taskType: 'opinion',
      kind: 'single_choice',
      prompt: '选',
      options: Array.from({ length: ASK_USER_MAX_MODEL_OPTIONS }, (_, i) => ({ id: `o${i}`, label: `选项${i}`, preferenceOnly: true })),
    })
    expect(opinion.options).toHaveLength(ASK_USER_MAX_MODEL_OPTIONS + 1)
    expect(opinion.options?.[opinion.options.length - 1]?.id).toBe(ASK_CUSTOM_OPTION_ID)
  })

  it('作品选项无图但有 bangumiId → 服务端按封面阶梯补齐图与来源', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const deps: PlanAgentToolDeps = {
      planId: plan.id,
      repo,
      points: finder,
      resolveOptionCover: async (input) =>
        input.bangumiId === 115908
          ? {
              image: 'https://image.anitabi.cn/cover.jpg',
              source: 'anitabi',
              sourceUrl: 'anitabi:bangumi:115908',
              fetchedAt: '2026-09-01T00:00:00.000Z',
              attribution: 'Anitabi',
            }
          : null,
    }
    const payload = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '选一部',
      options: [
        { id: 'a', label: '本传', bangumiId: 115908 },
        { id: 'b', label: '不知道 id 的作品', preferenceOnly: true },
      ],
    })
    const enriched = payload.options?.[0]
    expect(enriched?.image).toBe('https://image.anitabi.cn/cover.jpg')
    expect(enriched?.imageSource).toBe('anitabi')
    expect(enriched?.imageAttribution).toBe('Anitabi')
    expect(enriched?.sourceKind).toBe('anitabi')
    // 无 bangumiId 的选项保持无图
    expect(payload.options?.[1]?.image).toBeUndefined()
  })

  it('历史 ask 载荷（无自定义选项/无溯源字段）仍然可渲染', () => {
    const entries = toChatView([
      {
        id: 'm1',
        planId: 'p1',
        kind: 'ask',
        content: {
          askId: 'ask-1',
          kind: 'single_choice',
          prompt: '选一个',
          options: [{ id: 'a', label: '本传' }],
        } as unknown as Prisma.JsonValue,
        createdAt: new Date(),
      },
    ])
    expect(entries[0]?.ask?.options).toEqual([{ id: 'a', label: '本传' }])
    // isCustom 只认 id，历史载荷不含它
    expect(entries[0]?.ask?.options?.some(isAskCustomOption)).toBe(false)
    expect(reservedCustomOption().id).toBe(ASK_CUSTOM_OPTION_ID)
  })
})

describe('ask_user 选项证据门（M3 修订）', () => {
  it('拒绝不安全的图片 URL：javascript:、data:、带 key 参数、// 协议相对', async () => {
    const { deps } = await makeDeps()
    for (const image of [
      'javascript:alert(1)',
      'data:image/png;base64,xxxx',
      'https://maps.googleapis.com/maps/api/place/photo?photoreference=R&key=SECRET',
      '//evil.com/x.jpg',
    ]) {
      const out = JSON.parse(
        await executePlanTool(deps, 'ask_user', {
          taskType: 'work_selection',
          kind: 'single_choice',
          prompt: '选',
          options: [{ id: 'a', label: 'A', image, sourceKind: 'model', sourceUrl: 'https://example.com/x', fetchedAt: '2026-09-01T00:00:00Z' }],
        }),
      )
      expect(out.error).toContain('不安全')
      expect(out.error).toContain('A')
    }
  })

  it('拒绝无出处的外部图源选项；带 sourceKind/sourceUrl 的同图通过', async () => {
    const { deps } = await makeDeps()
    const externalImage = 'https://lh3.googleusercontent.com/a/photo.jpg'
    const uncited = JSON.parse(
      await executePlanTool(deps, 'ask_user', {
        taskType: 'work_selection',
        kind: 'single_choice',
        prompt: '选',
        options: [{ id: 'a', label: '某地点', image: externalImage, sourceKind: 'google_places', sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJ1' }],
      }),
    )
    // 有图有部分出处但缺 fetchedAt → 三件套不齐被拒
    expect(uncited.error).toContain('fetchedAt')

    const cited = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '选',
      options: [
        {
          id: 'a',
          label: '某地点',
          image: externalImage,
          sourceKind: 'google_places',
          sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJ1',
          fetchedAt: '2026-09-01T00:00:00Z',
        },
      ],
    })
    expect(cited.options?.[0]?.image).toBe(externalImage)
    expect(cited.options?.[0]?.sourceKind).toBe('google_places')
    expect(cited.options?.[0]?.fetchedAt).toBe('2026-09-01T00:00:00Z')
  })

  it('三件套契约：无出处选项被拒；preferenceOnly 显式豁免；缺项被拒', async () => {
    const { deps } = await makeDeps()
    // 完全无出处（外部事实候选）→ 拒
    const uncited = JSON.parse(
      await executePlanTool(deps, 'ask_user', {
        taskType: 'work_selection',
        kind: 'single_choice',
        prompt: '选',
        options: [{ id: 'a', label: '东京迪士尼' }],
      }),
    )
    expect(uncited.error).toContain('sourceKind')
    expect(uncited.error).toContain('preferenceOnly')

    // 纯偏好选项显式声明 → 过
    const preference = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '节奏怎么排？',
      options: [
        { id: 'easy', label: '轻松一点', preferenceOnly: true },
        { id: 'tight', label: '紧凑一点', preferenceOnly: true },
      ],
    })
    expect(preference.options?.[0]).toMatchObject({ id: 'easy', preferenceOnly: true })

    // 部分出处（缺 sourceUrl/fetchedAt）→ 拒，提示补齐
    const partial = JSON.parse(
      await executePlanTool(deps, 'ask_user', {
        taskType: 'work_selection',
        kind: 'single_choice',
        prompt: '选',
        options: [{ id: 'a', label: 'X', sourceKind: 'google_places' }],
      }),
    )
    expect(partial.error).toContain('三者必齐')

    // preferenceOnly 却又带出处字段且不齐 → 拒（自相矛盾）
    const conflicted = JSON.parse(
      await executePlanTool(deps, 'ask_user', {
        taskType: 'work_selection',
        kind: 'single_choice',
        prompt: '选',
        options: [{ id: 'a', label: 'X', preferenceOnly: true, sourceKind: 'web' }],
      }),
    )
    expect(conflicted.error).toContain('preferenceOnly')
  })

  it('bangumiId 选项自动补齐规范出处三件套（封面补齐失败也照补）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    // resolveOptionCover 缺省（封面阶梯不可用）——出处与封面无关，必须照补
    const deps: PlanAgentToolDeps = { planId: plan.id, repo, points: finder }
    const payload = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '选一部',
      options: [{ id: 'a', label: '本传', bangumiId: 115908 }],
    })
    expect(payload.options?.[0]).toMatchObject({
      bangumiId: 115908,
      sourceKind: 'anitabi',
      sourceUrl: 'anitabi:bangumi:115908',
    })
    expect(payload.options?.[0]?.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('模型自带的三件套出处原样保留（不被服务端覆盖）', async () => {
    const { deps } = await makeDeps()
    const payload = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '选',
      options: [
        {
          id: 'a',
          label: '迪士尼',
          sourceKind: 'google_places',
          sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJ_disney',
          fetchedAt: '2026-09-01T08:00:00.000Z',
        },
      ],
    })
    expect(payload.options?.[0]).toMatchObject({
      sourceKind: 'google_places',
      sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJ_disney',
      fetchedAt: '2026-09-01T08:00:00.000Z',
    })
  })

  it('已知安全图源（anitabi/bgm/站内相对路径）图片本身无需额外出处', async () => {
    const { deps } = await makeDeps()
    const payload = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '选',
      options: [
        { id: 'a', label: 'A', image: 'https://img-tc.anitabi.cn/works/1.jpg', sourceKind: 'anitabi', sourceUrl: 'anitabi:works:1', fetchedAt: '2026-09-01T00:00:00Z' },
        { id: 'b', label: 'B', image: '/api/google/place-photo?ref=Aref_1234567890', sourceKind: 'google_places', sourceUrl: 'https://maps.example', fetchedAt: '2026-09-01T00:00:00Z' },
      ],
    })
    expect(payload.options?.slice(0, 2).every((o) => o.image)).toBe(true)
  })

  it('真实引用来源门控（M3 修订）：伪造 sourceUrl/fetchedAt 被拒，值必须可解析且合理', async () => {
    const { deps } = await makeDeps()
    const validUrl = 'https://www.google.com/maps/place/?q=place_id:ChIJ1'
    const validAt = '2026-09-01T08:00:00Z'

    // 伪造 sourceUrl：协议、凭据、密钥参数、非 URL 纯文本
    for (const sourceUrl of [
      'javascript:alert(1)',
      'https://user:pass@evil.com/x',
      'https://x.com/img?key=SECRET',
      'https://x.com/img?token=T',
      '不是链接也不是稳定标识',
    ]) {
      const out = JSON.parse(
        await executePlanTool(deps, 'ask_user', {
          taskType: 'work_selection',
          kind: 'single_choice',
          prompt: '选',
          options: [{ id: 'a', label: 'X', sourceKind: 'google_places', sourceUrl, fetchedAt: validAt }],
        }),
      )
      expect(out.error).toContain('sourceUrl 不是合法来源')
      expect(out.error).toContain('X')
    }

    // 伪造 fetchedAt：非 ISO 文本、纯数字、早于数据窗口、超过现在+24h 的未来时间
    for (const fetchedAt of ['昨天上午', '12345', '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z']) {
      const out = JSON.parse(
        await executePlanTool(deps, 'ask_user', {
          taskType: 'work_selection',
          kind: 'single_choice',
          prompt: '选',
          options: [{ id: 'a', label: 'Y', sourceKind: 'google_places', sourceUrl: validUrl, fetchedAt }],
        }),
      )
      expect(out.error).toContain('fetchedAt')
      expect(out.error).toContain('Y')
    }
  })

  it('真实引用来源门控：合法 stable ID 与 Google Maps URI / 干净 URL 通过', async () => {
    const { deps } = await makeDeps()
    const payload = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '选',
      options: [
        { id: 'a', label: '本传', sourceKind: 'anitabi', sourceUrl: 'anitabi:bangumi:115908', fetchedAt: '2026-09-01T00:00:00Z' },
        { id: 'b', label: '封面页', sourceKind: 'anitabi', sourceUrl: 'anitabi:works:12', fetchedAt: '2026-09-01' },
        { id: 'c', label: '映射', sourceKind: 'anime', sourceUrl: 'anime:bangumi:42', fetchedAt: '2026-09-01T00:00:00Z' },
        { id: 'd', label: '条目', sourceKind: 'bgm', sourceUrl: 'bgm:subject:115908', fetchedAt: '2026-09-01T00:00:00Z' },
        {
          id: 'e',
          label: '迪士尼',
          sourceKind: 'google_places',
          sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJ_disney',
          fetchedAt: '2026-09-01T08:00:00Z',
        },
      ],
    })
    // 全部通过（work_selection 不追加自定义选项，保持 5 个）
    expect(payload.options).toHaveLength(5)
    expect(payload.options?.every((o) => o.sourceUrl)).toBe(true)
  })

  it('门控不破坏既有豁免：preferenceOnly 与 bangumiId 自动 canonical 出处照常通过', async () => {
    const { deps } = await makeDeps()
    const payload = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '选',
      options: [
        { id: 'p', label: '轻松节奏', preferenceOnly: true },
        { id: 'w', label: '本传', bangumiId: 115908 },
      ],
    })
    // preferenceOnly 无出处字段不被门控拦截
    expect(payload.options?.[0]).toMatchObject({ id: 'p', preferenceOnly: true })
    // bangumiId 的 canonical 三件套（anitabi:bangumi:id + now ISO）恒合法
    expect(payload.options?.[1]).toMatchObject({ sourceKind: 'anitabi', sourceUrl: 'anitabi:bangumi:115908' })
    expect(payload.options?.[1]?.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('本地 bangumi 数据：封面补齐自动推断出处，且模型给的出处原样保留', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const deps: PlanAgentToolDeps = {
      planId: plan.id,
      repo,
      points: finder,
      resolveOptionCover: async (input) =>
        input.bangumiId === 115908
          ? {
              image: 'https://img-tc.anitabi.cn/works/1.jpg',
              source: 'anitabi',
              sourceUrl: 'anitabi:bangumi:115908',
              fetchedAt: '2026-09-01T00:00:00.000Z',
              attribution: 'Anitabi',
            }
          : null,
    }
    // 模型完全没给出处 → 补齐后自动有（anitabi 安全域，也过证据门）
    const inferred = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '选',
      options: [{ id: 'a', label: '本传', bangumiId: 115908 }],
    })
    expect(inferred.options?.[0]).toMatchObject({ imageSource: 'anitabi', sourceKind: 'anitabi', sourceUrl: 'anitabi:bangumi:115908' })

    // 模型已给出处 → 原样保留，不被覆盖
    const preserved = await askSignal(deps, {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '选',
      options: [{ id: 'a', label: '本传', bangumiId: 115908, sourceKind: 'bangumi', sourceUrl: 'https://bgm.tv/subject/115908', fetchedAt: '2026-09-01T00:00:00Z' }],
    })
    expect(preserved.options?.[0]?.sourceKind).toBe('bangumi')
    expect(preserved.options?.[0]?.sourceUrl).toBe('https://bgm.tv/subject/115908')
    expect(preserved.options?.[0]?.imageSource).toBe('anitabi')
  })
})
