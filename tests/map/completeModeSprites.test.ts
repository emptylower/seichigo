import { describe, it, expect, vi, beforeEach } from 'vitest'

const cutSpriteSheetMock = vi.fn(
  async (
    bangumiId: number,
    _theme: unknown,
    points: Array<{ id: string }>,
  ) => new Map(
    points.map((point) => [
      `sprite-${bangumiId}-${point.id}`,
      { imageData: {} as ImageData, width: 10, height: 10 },
    ]),
  ),
)

vi.mock('@/components/map/utils/spriteRenderer', () => ({
  cutSpriteSheet: (...args: unknown[]) => (cutSpriteSheetMock as any)(...args),
}))

const {
  buildViewportSignature,
  estimateSpriteSheetBytes,
  selectSpriteCandidates,
  topUpSpritesForViewport,
} = await import('@/features/map/anitabi/completeModeSprites')

type Bangumi = Parameters<typeof selectSpriteCandidates>[0]['bangumiList'][number]

const THEME = { ids: ['a'], src: '/ptheme/1_100_76.webp' }

/** 东京视口（约 139.5~140.0E / 35.5~35.9N）。 */
const TOKYO_BOUNDS = { west: 139.5, south: 35.5, east: 140.0, north: 35.9 }
/** 大阪视口，与东京不重叠（含外扩一圈也不重叠）。 */
const OSAKA_BOUNDS = { west: 135.3, south: 34.5, east: 135.7, north: 34.8 }

function makeBangumi(
  bangumiId: number,
  points: Array<[number, number]>,
  theme: unknown = THEME,
): Bangumi {
  return {
    bangumiId,
    color: '#333',
    theme,
    points: points.map((geo, index) => ({ id: `${bangumiId}-p${index}`, geo })),
  }
}

/** 在给定经纬度附近生成 count 个点位。 */
function pointsNear(lat: number, lng: number, count: number): Array<[number, number]> {
  return Array.from({ length: count }, (_, index) => [
    lat + index * 0.0005,
    lng + index * 0.0005,
  ] as [number, number])
}

describe('estimateSpriteSheetBytes', () => {
  it('与生产实测的 405785_100_76.webp（1,934,006 B / 1023 格）误差 < 1%', () => {
    const estimated = estimateSpriteSheetBytes(1023)
    const measured = 1_934_006
    expect(Math.abs(estimated - measured) / measured).toBeLessThan(0.01)
  })

  it('非法格数返回 0', () => {
    expect(estimateSpriteSheetBytes(0)).toBe(0)
    expect(estimateSpriteSheetBytes(Number.NaN)).toBe(0)
  })
})

describe('selectSpriteCandidates 视口过滤', () => {
  it('只选视口内确实有点位的番剧，视口外的不入选', () => {
    const inViewport = makeBangumi(1, pointsNear(35.7, 139.7, 4))
    const outOfViewport = makeBangumi(2, pointsNear(34.6, 135.5, 40))

    const selection = selectSpriteCandidates({
      bangumiList: [inViewport, outOfViewport],
      bounds: TOKYO_BOUNDS,
      maxBangumi: 220,
    })

    expect(selection.candidates.map((item) => item.bangumiId)).toEqual([1])
  })

  it('主题非法的番剧不入选', () => {
    const invalidTheme = makeBangumi(1, pointsNear(35.7, 139.7, 4), null)

    const selection = selectSpriteCandidates({
      bangumiList: [invalidTheme],
      bounds: TOKYO_BOUNDS,
      maxBangumi: 220,
    })

    expect(selection.candidates).toEqual([])
  })

  it('已处理过的番剧被跳过（不重复下载）', () => {
    const first = makeBangumi(1, pointsNear(35.7, 139.7, 6))
    const second = makeBangumi(2, pointsNear(35.72, 139.72, 3))

    const selection = selectSpriteCandidates({
      bangumiList: [first, second],
      bounds: TOKYO_BOUNDS,
      maxBangumi: 220,
      isProcessed: (bangumiId) => bangumiId === 1,
    })

    expect(selection.candidates.map((item) => item.bangumiId)).toEqual([2])
  })
})

describe('selectSpriteCandidates 排序', () => {
  it('按视口内点位数降序，而不是点位总数', () => {
    // 总数大但视口内少：视口内 2 个，视口外 100 个。
    const bigButMostlyOffscreen = makeBangumi(1, [
      ...pointsNear(35.7, 139.7, 2),
      ...pointsNear(34.6, 135.5, 100),
    ])
    // 总数小但视口内多。
    const smallButOnscreen = makeBangumi(2, pointsNear(35.75, 139.75, 8))

    const selection = selectSpriteCandidates({
      bangumiList: [bigButMostlyOffscreen, smallButOnscreen],
      bounds: TOKYO_BOUNDS,
      maxBangumi: 220,
    })

    expect(selection.candidates.map((item) => item.bangumiId)).toEqual([2, 1])
  })

  it('视口内数量相同时，离视口中心更近的优先', () => {
    const near = makeBangumi(1, pointsNear(35.7, 139.75, 3))
    const far = makeBangumi(2, pointsNear(35.55, 139.55, 3))

    const selection = selectSpriteCandidates({
      bangumiList: [far, near],
      bounds: TOKYO_BOUNDS,
      center: [139.75, 35.7],
      maxBangumi: 220,
    })

    expect(selection.candidates.map((item) => item.bangumiId)).toEqual([1, 2])
  })
})

describe('selectSpriteCandidates 字节预算', () => {
  it('累计估算字节超预算后停止取更多候选，已取的不受影响', () => {
    const first = makeBangumi(1, pointsNear(35.7, 139.7, 5)) // 约 9455 B
    const second = makeBangumi(2, pointsNear(35.72, 139.72, 4)) // 约 7564 B

    const selection = selectSpriteCandidates({
      bangumiList: [first, second],
      bounds: TOKYO_BOUNDS,
      maxBangumi: 220,
      byteBudget: 10_000,
    })

    expect(selection.candidates.map((item) => item.bangumiId)).toEqual([1])
    expect(selection.byteBudgetHit).toBe(1)
    expect(selection.estimatedBytes).toBeLessThanOrEqual(10_000)
  })

  it('单张表估算就超预算时被跳过，而不是吃光预算', () => {
    const oversize = makeBangumi(1, pointsNear(35.7, 139.7, 6)) // 约 11346 B > 预算
    const affordable = makeBangumi(2, pointsNear(35.72, 139.72, 4)) // 约 7564 B

    const selection = selectSpriteCandidates({
      bangumiList: [oversize, affordable],
      bounds: TOKYO_BOUNDS,
      maxBangumi: 220,
      byteBudget: 10_000,
    })

    expect(selection.candidates.map((item) => item.bangumiId)).toEqual([2])
    expect(selection.oversizeSkipped).toBe(1)
    expect(selection.byteBudgetHit).toBe(0)
  })

  it('预算按「本次补齐」计：同一份预算可以被下一次调用重新使用', () => {
    const tokyo = makeBangumi(1, pointsNear(35.7, 139.7, 5))
    const osaka = makeBangumi(2, pointsNear(34.6, 135.5, 5))
    const args = { bangumiList: [tokyo, osaka], maxBangumi: 220, byteBudget: 10_000 }

    const firstPass = selectSpriteCandidates({ ...args, bounds: TOKYO_BOUNDS })
    const secondPass = selectSpriteCandidates({
      ...args,
      bounds: OSAKA_BOUNDS,
      isProcessed: (bangumiId) => bangumiId === 1,
    })

    expect(firstPass.candidates.map((item) => item.bangumiId)).toEqual([1])
    expect(secondPass.candidates.map((item) => item.bangumiId)).toEqual([2])
  })

  it('拿不到视口时退化为不过滤，但仍受字节预算约束', () => {
    const first = makeBangumi(1, pointsNear(35.7, 139.7, 5))
    const second = makeBangumi(2, pointsNear(34.6, 135.5, 4))

    const selection = selectSpriteCandidates({
      bangumiList: [first, second],
      bounds: null,
      maxBangumi: 220,
      byteBudget: 10_000,
    })

    expect(selection.candidates.map((item) => item.bangumiId)).toEqual([1])
    expect(selection.byteBudgetHit).toBe(1)
  })
})

function createMockMap(bounds: typeof TOKYO_BOUNDS) {
  const images = new Map<string, unknown>()
  const state = { bounds }
  return {
    images,
    setBounds(next: typeof TOKYO_BOUNDS) {
      state.bounds = next
    },
    getBounds: () => ({
      getWest: () => state.bounds.west,
      getSouth: () => state.bounds.south,
      getEast: () => state.bounds.east,
      getNorth: () => state.bounds.north,
    }),
    getCenter: () => ({
      lng: (state.bounds.west + state.bounds.east) / 2,
      lat: (state.bounds.south + state.bounds.north) / 2,
    }),
    hasImage: (id: string) => images.has(id),
    addImage: (id: string, data: unknown) => {
      images.set(id, data)
    },
  }
}

describe('topUpSpritesForViewport 视口补齐', () => {
  beforeEach(() => {
    cutSpriteSheetMock.mockClear()
  })

  it('视口变化后补齐新进入视口的番剧，已加载的不重复下载', async () => {
    const tokyo = makeBangumi(1, pointsNear(35.7, 139.7, 3))
    const osaka = makeBangumi(2, pointsNear(34.6, 135.5, 3))
    const map = createMockMap(TOKYO_BOUNDS)
    const processedBangumiIds = new Set<number>()
    const spriteImageIds = new Set<string>()
    const refs = {
      viewportSignatureRef: { current: null as string | null },
      inFlightRef: { current: false },
      abortRef: { current: null as AbortController | null },
    }
    const onSpritesAdded = vi.fn()
    const baseInput = {
      map,
      bangumiList: [tokyo, osaka],
      features: [],
      processedBangumiIds,
      spriteImageIds,
      metrics: {} as Record<string, number | string>,
      maxBangumi: 220,
      budgetMs: 9000,
      onSpritesAdded,
      ...refs,
    }

    topUpSpritesForViewport(baseInput)
    await vi.waitFor(() => expect(refs.inFlightRef.current).toBe(false))

    expect(cutSpriteSheetMock.mock.calls.map((call) => call[0])).toEqual([1])
    expect(processedBangumiIds.has(1)).toBe(true)
    expect(spriteImageIds.size).toBe(3)
    expect(onSpritesAdded).toHaveBeenCalledTimes(1)

    // 视口移到大阪：只补 2，不重复下载 1。
    map.setBounds(OSAKA_BOUNDS)
    topUpSpritesForViewport(baseInput)
    await vi.waitFor(() => expect(refs.inFlightRef.current).toBe(false))

    expect(cutSpriteSheetMock.mock.calls.map((call) => call[0])).toEqual([1, 2])
    expect(processedBangumiIds.has(2)).toBe(true)
    expect(spriteImageIds.size).toBe(6)
  })

  it('视口没变时不重复触发补齐', async () => {
    const tokyo = makeBangumi(1, pointsNear(35.7, 139.7, 3))
    const map = createMockMap(TOKYO_BOUNDS)
    const refs = {
      viewportSignatureRef: { current: null as string | null },
      inFlightRef: { current: false },
      abortRef: { current: null as AbortController | null },
    }
    const input = {
      map,
      bangumiList: [tokyo],
      features: [],
      processedBangumiIds: new Set<number>(),
      spriteImageIds: new Set<string>(),
      metrics: {} as Record<string, number | string>,
      maxBangumi: 220,
      budgetMs: 9000,
      onSpritesAdded: vi.fn(),
      ...refs,
    }

    topUpSpritesForViewport(input)
    await vi.waitFor(() => expect(refs.inFlightRef.current).toBe(false))
    topUpSpritesForViewport(input)
    await vi.waitFor(() => expect(refs.inFlightRef.current).toBe(false))

    expect(cutSpriteSheetMock).toHaveBeenCalledTimes(1)
    expect(refs.viewportSignatureRef.current).toBe(buildViewportSignature(TOKYO_BOUNDS))
  })

  it('把 icon 写回 feature，失败的番剧保持圆点回落', async () => {
    const okBangumi = makeBangumi(1, pointsNear(35.7, 139.7, 1))
    const failingBangumi = makeBangumi(2, pointsNear(35.71, 139.71, 1))
    cutSpriteSheetMock.mockImplementationOnce(async () => {
      throw new Error('sheet 404')
    })
    const map = createMockMap(TOKYO_BOUNDS)
    const features = [
      { properties: { pointId: '1-p0', icon: '' } },
      { properties: { pointId: '2-p0', icon: '' } },
    ]
    const refs = {
      viewportSignatureRef: { current: null as string | null },
      inFlightRef: { current: false },
      abortRef: { current: null as AbortController | null },
    }

    topUpSpritesForViewport({
      map,
      // 让 bangumi 2 排在前面（视口内点位数相同则按 id 兜底，这里靠 mockImplementationOnce 命中第一次调用）
      bangumiList: [failingBangumi, okBangumi],
      features,
      processedBangumiIds: new Set<number>(),
      spriteImageIds: new Set<string>(),
      metrics: {} as Record<string, number | string>,
      maxBangumi: 220,
      budgetMs: 9000,
      onSpritesAdded: vi.fn(),
      ...refs,
    })
    await vi.waitFor(() => expect(refs.inFlightRef.current).toBe(false))

    const icons = features.map((feature) => feature.properties.icon)
    expect(icons.filter(Boolean)).toHaveLength(1)
  })
})
