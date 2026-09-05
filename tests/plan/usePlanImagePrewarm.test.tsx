import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'
import {
  PLAN_PREWARM_MAX_IMAGES,
  collectPlanPrewarmUrls,
  usePlanImagePrewarm,
} from '@/app/(authed)/plan/[id]/hooks/usePlanImagePrewarm'
import { planPrewarmQueue } from '@/app/(authed)/plan/[id]/hooks/planPrewarmQueue'
import {
  hasLoadedMapImage,
  rememberLoadedMapImage,
  resetLoadedMapImageCacheForTest,
} from '@/components/map/utils/mapImageLoadedCache'
import { resetMapImageRequestSchedulerForTest } from '@/features/map/anitabi/mapImageRequestScheduler'

// jsdom 的 Image 不会触发加载：替换为记录 src、由测试手动触发 onload 的桩
type MockImage = { src: string; onload: (() => void) | null; onerror: (() => void) | null }
const createdImages: MockImage[] = []

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private _src = ''
  set src(value: string) {
    this._src = value
    createdImages.push(this as unknown as MockImage)
  }
  get src() {
    return this._src
  }
}

/** 逐轮触发已创建图片的 onload（释放 warmup 槽位让队列继续），直到没有新图片产生 */
async function flushAllImages() {
  const fired = new WeakSet<object>()
  for (let round = 0; round < 200; round++) {
    const pending = createdImages.filter((img) => !fired.has(img))
    for (const img of pending) {
      fired.add(img)
      img.onload?.()
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!createdImages.some((img) => !fired.has(img))) break
  }
}

function makeItem(overrides: Partial<TripPlanItemView>): TripPlanItemView {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    sortOrder: 0,
    type: 'point',
    pointId: null,
    timeHint: null,
    title: '条目',
    note: null,
    reason: null,
    payload: null,
    point: null,
    ...overrides,
  }
}

function makeDay(dayIndex: number, items: TripPlanItemView[]): TripPlanDayView {
  return { id: `day-${dayIndex}`, dayIndex, date: null, citySlug: null, summary: null, items }
}

function mediaItem(id: string, displayUrl: string): TripPlanItemView {
  return makeItem({ id, payload: { media: { source: 'google_places', displayUrl } } })
}

beforeEach(() => {
  createdImages.length = 0
  vi.stubGlobal('Image', FakeImage)
  vi.restoreAllMocks()
  planPrewarmQueue.stop()
  resetLoadedMapImageCacheForTest()
  resetMapImageRequestSchedulerForTest()
})

describe('collectPlanPrewarmUrls（纯函数：收集/去重/上限）', () => {
  it('收集非 transit 条目的 media.displayUrl 与站内点位缩略图候选；相对路径原样保留', () => {
    const days = [
      makeDay(1, [
        mediaItem('a', '/api/google/place-photo?ref=a'),
        makeItem({
          id: 'b',
          pointId: '899:x',
          point: { id: '899:x', name: 'x', nameZh: null, lat: 1, lng: 1, image: 'https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg' },
        }),
      ]),
    ]
    const urls = collectPlanPrewarmUrls(days)
    expect(urls).toHaveLength(2)
    // media.displayUrl 原样
    expect(urls[0]).toBe('/api/google/place-photo?ref=a')
    // 站内点位图走 point-thumbnail 候选梯首档（h160 变体，与 DayCards 渲染口径一致）
    const decoded = decodeURIComponent(decodeURIComponent(urls[1]!))
    expect(decoded).toContain('/api/anitabi/image-render')
    expect(decoded).toContain('plan=h160')
  })

  it('去重 + 跳过 transit 条目 + 上限截断', () => {
    const dup = [
      makeDay(1, [mediaItem('a', '/api/google/place-photo?ref=dup'), mediaItem('b', '/api/google/place-photo?ref=dup')]),
    ]
    expect(collectPlanPrewarmUrls(dup)).toHaveLength(1)

    const withTransit = [
      makeDay(1, [
        makeItem({ id: 't', type: 'transit', payload: { media: { displayUrl: '/api/google/place-photo?ref=transit' } } }),
        mediaItem('p', '/api/google/place-photo?ref=keep'),
      ]),
    ]
    expect(collectPlanPrewarmUrls(withTransit)).toEqual(['/api/google/place-photo?ref=keep'])

    const many = [
      makeDay(
        1,
        Array.from({ length: PLAN_PREWARM_MAX_IMAGES + 10 }, (_, i) => mediaItem(`m${i}`, `/api/google/place-photo?ref=${i}`)),
      ),
    ]
    expect(collectPlanPrewarmUrls(many)).toHaveLength(PLAN_PREWARM_MAX_IMAGES)
  })
})

describe('usePlanImagePrewarm（后台预热）', () => {
  it('3 天各 2 张图 → 6 次加载并全部写入已加载缓存', async () => {
    const days = [1, 2, 3].map((dayIndex) =>
      makeDay(dayIndex, [
        mediaItem(`d${dayIndex}-a`, `/api/google/place-photo?ref=d${dayIndex}a`),
        mediaItem(`d${dayIndex}-b`, `/api/google/place-photo?ref=d${dayIndex}b`),
      ]),
    )
    renderHook(() => usePlanImagePrewarm(days))

    await flushAllImages()
    expect(createdImages.map((img) => img.src).sort()).toEqual(
      [
        '/api/google/place-photo?ref=d1a',
        '/api/google/place-photo?ref=d1b',
        '/api/google/place-photo?ref=d2a',
        '/api/google/place-photo?ref=d2b',
        '/api/google/place-photo?ref=d3a',
        '/api/google/place-photo?ref=d3b',
      ].sort(),
    )
    for (const img of createdImages) {
      expect(hasLoadedMapImage(img.src)).toBe(true)
    }
  })

  it('已在已加载缓存里的 URL 跳过，不再发请求', async () => {
    rememberLoadedMapImage('/api/google/place-photo?ref=cached')
    const days = [
      makeDay(1, [
        mediaItem('a', '/api/google/place-photo?ref=cached'),
        mediaItem('b', '/api/google/place-photo?ref=fresh'),
      ]),
    ]
    renderHook(() => usePlanImagePrewarm(days))

    await flushAllImages()
    expect(createdImages.map((img) => img.src)).toEqual(['/api/google/place-photo?ref=fresh'])
  })

  it('加载失败不写入已加载缓存', async () => {
    const days = [makeDay(1, [mediaItem('a', '/api/google/place-photo?ref=broken')])]
    renderHook(() => usePlanImagePrewarm(days))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(createdImages).toHaveLength(1)
    createdImages[0]!.onerror?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(hasLoadedMapImage('/api/google/place-photo?ref=broken')).toBe(false)
  })

  it('days 变化时取消未开始的加载并只补新图', async () => {
    const day1 = [makeDay(1, [mediaItem('a', '/api/google/place-photo?ref=1')])]
    const { rerender } = renderHook(({ days }) => usePlanImagePrewarm(days), { initialProps: { days: day1 } })
    await flushAllImages()
    expect(createdImages).toHaveLength(1)

    const day2 = [makeDay(1, [mediaItem('a', '/api/google/place-photo?ref=1'), mediaItem('b', '/api/google/place-photo?ref=2')])]
    rerender({ days: day2 })
    await flushAllImages()
    // 已加载的 ref=1 命中缓存跳过，只补 ref=2
    expect(createdImages.map((img) => img.src)).toEqual([
      '/api/google/place-photo?ref=1',
      '/api/google/place-photo?ref=2',
    ])
  })
})

describe('usePlanImagePrewarm（预热常态化：只追加、不重启）', () => {
  it('days 引用变化但 URL 集合不变 → 不重复 enqueue', async () => {
    const spy = vi.spyOn(planPrewarmQueue, 'enqueue')
    const makeDays = () => [makeDay(1, [mediaItem('a', '/api/google/place-photo?ref=same')])]
    const { rerender } = renderHook(({ days }) => usePlanImagePrewarm(days), { initialProps: { days: makeDays() } })
    await flushAllImages()
    expect(spy).toHaveBeenCalledTimes(1)

    rerender({ days: makeDays() })
    await flushAllImages()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(createdImages.map((img) => img.src)).toEqual(['/api/google/place-photo?ref=same'])
  })

  it('chat 文本消息到达（无 daymap 变化）→ 不重启预热', async () => {
    const spy = vi.spyOn(planPrewarmQueue, 'enqueue')
    const days = [makeDay(1, [mediaItem('a', '/api/google/place-photo?ref=steady')])]
    const textEntry = (text: string) =>
      ({ role: 'assistant', kind: 'text', text, daymap: null }) as never
    const { rerender } = renderHook(({ chat }) => usePlanImagePrewarm(days, chat), {
      initialProps: { chat: [textEntry('第 1 条')] },
    })
    await flushAllImages()
    expect(spy).toHaveBeenCalledTimes(1)

    rerender({ chat: [textEntry('第 1 条'), textEntry('第 2 条')] })
    await flushAllImages()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(createdImages.map((img) => img.src)).toEqual(['/api/google/place-photo?ref=steady'])
  })

  it('新增一天 → 只把新 URL 追加到队尾', async () => {
    const spy = vi.spyOn(planPrewarmQueue, 'enqueue')
    const day1 = [makeDay(1, [mediaItem('a', '/api/google/place-photo?ref=old')])]
    const { rerender } = renderHook(({ days }) => usePlanImagePrewarm(days), { initialProps: { days: day1 } })
    await flushAllImages()
    expect(spy).toHaveBeenCalledTimes(1)

    const day2 = [...day1, makeDay(2, [mediaItem('b', '/api/google/place-photo?ref=new')])]
    rerender({ days: day2 })
    await flushAllImages()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[1]![0]).toContain('/api/google/place-photo?ref=new')
    expect(createdImages.map((img) => img.src)).toEqual([
      '/api/google/place-photo?ref=old',
      '/api/google/place-photo?ref=new',
    ])
  })

  it('daymap 快照到达 → 其 days 的新 URL 也进入队列', async () => {
    const spy = vi.spyOn(planPrewarmQueue, 'enqueue')
    const days = [makeDay(1, [mediaItem('a', '/api/google/place-photo?ref=plan')])]
    const daymapEntry = (revisionId: string, ref: string) =>
      ({
        role: 'assistant',
        kind: 'daymap',
        text: '',
        daymap: {
          type: 'daymap',
          revisionId,
          savedAt: '2026-09-04T00:00:00.000Z',
          days: [makeDay(1, [mediaItem('s', `/api/google/place-photo?ref=${ref}`)])],
        },
      }) as never
    const { rerender } = renderHook(({ chat }) => usePlanImagePrewarm(days, chat), { initialProps: { chat: [] as never[] } })
    await flushAllImages()
    expect(spy).toHaveBeenCalledTimes(1)

    rerender({ chat: [daymapEntry('r1', 'snap')] })
    await flushAllImages()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(createdImages.map((img) => img.src)).toContain('/api/google/place-photo?ref=snap')
  })
})
