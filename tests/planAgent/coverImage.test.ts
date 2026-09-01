import { describe, it, expect, vi } from 'vitest'
import { resolveWorkCover, type WorkCoverLookup } from '@/lib/planAgent/coverImage'
import { buildPlanAgentServerDeps } from '@/lib/planAgent/serverDeps'

function makeLookup(overrides: Partial<WorkCoverLookup> = {}): WorkCoverLookup {
  return {
    getAnitabiCover: vi.fn(async () => null),
    getMappedAnimeCover: vi.fn(async () => null),
    getBgmSubjectCover: vi.fn(async () => null),
    ...overrides,
  }
}

describe('resolveWorkCover（作品封面来源阶梯）', () => {
  it('第一优先：站内 Anitabi 作品封面', async () => {
    const lookup = makeLookup({ getAnitabiCover: vi.fn(async () => 'https://image.anitabi.cn/works/1.jpg') })
    const cover = await resolveWorkCover({ bangumiId: 115908 }, lookup)
    expect(cover).toMatchObject({
      image: 'https://image.anitabi.cn/works/1.jpg',
      source: 'anitabi',
      sourceUrl: 'anitabi:bangumi:115908',
      attribution: 'Anitabi',
    })
    expect(lookup.getMappedAnimeCover).not.toHaveBeenCalled()
    expect(lookup.getBgmSubjectCover).not.toHaveBeenCalled()
  })

  it('第二优先：Anitabi 映射的站内 Anime 封面', async () => {
    const lookup = makeLookup({ getMappedAnimeCover: vi.fn(async () => 'https://seichigo.com/covers/anime.jpg') })
    const cover = await resolveWorkCover({ bangumiId: 42 }, lookup)
    expect(cover).toMatchObject({ image: 'https://seichigo.com/covers/anime.jpg', source: 'anime' })
    expect(lookup.getBgmSubjectCover).not.toHaveBeenCalled()
  })

  it('第三优先：bgm.tv 条目封面（bgm.tv 是图片代理白名单 host，可直连展示）', async () => {
    const lookup = makeLookup({ getBgmSubjectCover: vi.fn(async () => 'https://lain.bgm.tv/pic/cover/l/12/34/115908.jpg') })
    const cover = await resolveWorkCover({ bangumiId: 115908, bgmSubjectId: 115908 }, lookup)
    expect(cover).toMatchObject({
      image: 'https://lain.bgm.tv/pic/cover/l/12/34/115908.jpg',
      source: 'bgm',
      sourceUrl: 'https://bgm.tv/subject/115908',
      attribution: 'Bangumi',
    })
  })

  it('非 http(s) 的脏数据（javascript:、空串）被逐级跳过；全部失败返回 null（不编造封面）', async () => {
    const lookup = makeLookup({ getAnitabiCover: vi.fn(async () => 'javascript:alert(1)') })
    expect(await resolveWorkCover({ bangumiId: 1 }, lookup)).toBeNull()

    const empty = makeLookup({ getAnitabiCover: vi.fn(async () => '   ') })
    expect(await resolveWorkCover({ bangumiId: 1 }, empty)).toBeNull()
  })

  it('任一级抛错都静默降级，不影响后续层级', async () => {
    const lookup = makeLookup({
      getAnitabiCover: vi.fn(async () => {
        throw new Error('db down')
      }),
      getMappedAnimeCover: vi.fn(async () => 'https://seichigo.com/a.jpg'),
    })
    const cover = await resolveWorkCover({ bangumiId: 1 }, lookup)
    expect(cover).toMatchObject({ source: 'anime' })
  })

  it('无任何 id → 直接 null，不发起任何查询', async () => {
    const lookup = makeLookup()
    expect(await resolveWorkCover({}, lookup)).toBeNull()
    expect(lookup.getAnitabiCover).not.toHaveBeenCalled()
  })
})

describe('server dep 装配路径的封面阶梯（M3 修订：bgm 兜底真实可达）', () => {
  /** 经 buildPlanAgentServerDeps 装配的真实注入依赖路径（ask 选项补齐用） */
  function serverCover(lookup: WorkCoverLookup) {
    const deps = buildPlanAgentServerDeps({ apiKey: 'k', rateKey: 'cover-test', coverLookup: lookup })
    if (!deps.resolveOptionCover) throw new Error('resolveOptionCover missing')
    return deps.resolveOptionCover
  }

  it('本地 Anitabi 封面在场 → 第一优先命中，绝不外呼 bgm.tv', async () => {
    const lookup = makeLookup({ getAnitabiCover: vi.fn(async () => 'https://img-tc.anitabi.cn/works/1.jpg') })
    const cover = await serverCover(lookup)({ bangumiId: 115908, label: '本传' })
    expect(cover).toMatchObject({ source: 'anitabi', image: 'https://img-tc.anitabi.cn/works/1.jpg' })
    expect(lookup.getBgmSubjectCover).not.toHaveBeenCalled()
  })

  it('Anitabi 缺、Anime 映射在场 → 第二优先命中，仍不外呼', async () => {
    const lookup = makeLookup({ getMappedAnimeCover: vi.fn(async () => 'https://seichigo.com/covers/a.jpg') })
    const cover = await serverCover(lookup)({ bangumiId: 115908, label: '本传' })
    expect(cover).toMatchObject({ source: 'anime' })
    expect(lookup.getBgmSubjectCover).not.toHaveBeenCalled()
  })

  it('本地两级皆缺 → bgm.tv 兜底真实可达：同一规范 bangumiId 作为 subject id 传入', async () => {
    const bgmFetch = vi.fn(async (subjectId: number) => `https://lain.bgm.tv/pic/cover/l/${subjectId}.jpg`)
    const lookup = makeLookup({ getBgmSubjectCover: bgmFetch })
    const cover = await serverCover(lookup)({ bangumiId: 115908, label: '本传' })
    // 兜底被触达，且 id 是 ask 选项携带的同一规范 bangumiId（subject id 同源）
    expect(bgmFetch).toHaveBeenCalledWith(115908)
    expect(cover).toMatchObject({
      source: 'bgm',
      image: 'https://lain.bgm.tv/pic/cover/l/115908.jpg',
      sourceUrl: 'https://bgm.tv/subject/115908',
      attribution: 'Bangumi',
    })
    // 阶梯顺序：先本地两级、再 bgm
    expect(lookup.getAnitabiCover).toHaveBeenCalledWith(115908)
    expect(lookup.getMappedAnimeCover).toHaveBeenCalledWith(115908)
  })

  it('三级全缺 → null（不编造封面）；查表只读，无任何回写', async () => {
    const lookup = makeLookup()
    expect(await serverCover(lookup)({ bangumiId: 1, label: 'X' })).toBeNull()
    // 注入的查表全部是只读 spy——没有 put/update 类回写面
    expect(Object.keys(lookup).sort()).toEqual(['getAnitabiCover', 'getBgmSubjectCover', 'getMappedAnimeCover'])
  })

  it('端到端：ask 选项经注入的 server dep 补齐 bgm 兜底封面，且模型出处原样保留', async () => {
    const lookup = makeLookup({ getBgmSubjectCover: vi.fn(async (id: number) => `https://lain.bgm.tv/pic/cover/l/${id}.jpg`) })
    const { executePlanTool } = await import('@/lib/planAgent/tools')
    const { MemoryTripPlanRepo } = await import('@/lib/tripPlan/repoMemory')
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const deps = {
      planId: plan.id,
      repo,
      points: {
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
      },
      resolveOptionCover: serverCover(lookup),
    }

    const AskUserSignalCtor = (await import('@/lib/planAgent/askUser')).AskUserSignal
    const signal = await executePlanTool(deps, 'ask_user', {
      taskType: 'work_selection',
      kind: 'single_choice',
      prompt: '选一部',
      options: [{ id: 'a', label: '本传', bangumiId: 115908, sourceKind: 'anitabi', sourceUrl: 'anitabi:bangumi:115908', fetchedAt: '2026-09-01T00:00:00Z' }],
    }).then(
      () => null,
      (err: unknown) => err,
    )
    expect(signal).toBeInstanceOf(AskUserSignalCtor)
    const option = (signal as InstanceType<typeof AskUserSignalCtor>).payload.options?.[0]
    // bgm 兜底封面 + 图片来源标识
    expect(option).toMatchObject({
      image: 'https://lain.bgm.tv/pic/cover/l/115908.jpg',
      imageSource: 'bgm',
      imageAttribution: 'Bangumi',
    })
    // 模型/服务端已给的出处不被兜底覆盖
    expect(option?.sourceKind).toBe('anitabi')
    expect(option?.sourceUrl).toBe('anitabi:bangumi:115908')
    expect(option?.fetchedAt).toBe('2026-09-01T00:00:00Z')
  })
})
