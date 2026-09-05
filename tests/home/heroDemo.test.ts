import { describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import {
  HERO_DEMO_DEFAULT_TRANSIT,
  parseHomeHeroDemo,
  pickHeroDemo,
} from '@/lib/home/heroDemo'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

function makePointItem(overrides: {
  id?: string
  title?: string
  payload?: unknown
  image?: string | null
  lat?: number | null
  lng?: number | null
  type?: TripPlanItemView['type']
  timeHint?: string | null
} = {}): TripPlanItemView {
  return {
    id: overrides.id ?? 'point-1',
    sortOrder: 0,
    type: overrides.type ?? 'point',
    pointId: 'point-1',
    timeHint: overrides.timeHint ?? null,
    title: overrides.title ?? '京都塔',
    note: null,
    reason: null,
    payload: (overrides.payload ?? null) as Prisma.JsonValue,
    point: {
      id: 'point-1',
      name: 'Kyoto Tower',
      nameZh: '京都タワー',
      lat: overrides.lat === undefined ? 34.9875 : overrides.lat,
      lng: overrides.lng === undefined ? 135.7594 : overrides.lng,
      image: overrides.image === undefined ? 'https://image.anitabi.cn/points/58949/tower.jpg' : overrides.image,
    },
  }
}

function makeTransitItem(transport: Record<string, unknown>): TripPlanItemView {
  return {
    id: 'transit-1',
    sortOrder: 0,
    type: 'transit',
    pointId: null,
    timeHint: null,
    title: ' Kyoto Tower → 清水寺',
    note: null,
    reason: null,
    payload: { transport } as unknown as Prisma.JsonValue,
    point: null,
  }
}

function makeDay(items: TripPlanItemView[], dayIndex = 1): TripPlanDayView {
  return {
    id: 'day-1',
    dayIndex,
    date: null,
    citySlug: 'kyoto',
    summary: '京吹京都一日：从京都塔出发',
    items,
  }
}

describe('parseHomeHeroDemo（§0 形状校验）', () => {
  const valid = {
    planTitle: '吹响吧！上低音号 京都巡礼 3 日',
    day: {
      dayIndex: 1,
      summary: '京吹京都一日',
      items: [
        { id: 'a', title: '京都塔', time: '09:00', imageUrl: '/images/showcase/a.jpg' },
        { id: 'b', title: '清水寺', time: '10:30', imageUrl: '/images/showcase/b.jpg' },
        { id: 'c', title: '安元橋', time: '13:00', imageUrl: '/images/showcase/c.jpg' },
      ],
      transit: { mode: 'walk', label: '步行 12 分钟' },
    },
  }

  it('parses a valid payload and passes the fields through', () => {
    expect(parseHomeHeroDemo(valid)).toEqual(valid)
  })

  it('rejects non-objects and missing required strings', () => {
    expect(parseHomeHeroDemo(null)).toBeNull()
    expect(parseHomeHeroDemo('nope')).toBeNull()
    expect(parseHomeHeroDemo({ ...valid, planTitle: ' ' })).toBeNull()
    expect(parseHomeHeroDemo({ ...valid, day: { ...valid.day, items: 'nope' } })).toBeNull()
    expect(parseHomeHeroDemo({ ...valid, day: { ...valid.day, items: [] } })).toBeNull()
    expect(
      parseHomeHeroDemo({ ...valid, day: { ...valid.day, items: [{ ...valid.day.items[0]!, imageUrl: '' }] } })
    ).toBeNull()
    expect(parseHomeHeroDemo({ ...valid, day: { ...valid.day, transit: { mode: 'walk' } } })).toBeNull()
    expect(parseHomeHeroDemo({ ...valid, day: { ...valid.day, dayIndex: 'one' } })).toBeNull()
  })
})

describe('pickHeroDemo（选取规则，A2）', () => {
  it('uses day 1 and picks the first 3 routable point items with images in order', async () => {
    const day1 = makeDay([
      makePointItem({ id: 'a', title: '京都塔', payload: { schedule: { start: '09:00' } } }),
      makeTransitItem({ mode: 'walk', durationMin: 12 }),
      makePointItem({ id: 'b', title: '清水寺', payload: { schedule: { start: '10:30' } } }),
      makePointItem({ id: 'c', title: '安元橋', payload: { schedule: { start: '13:00' } } }),
      makePointItem({ id: 'd', title: '第四个', payload: { schedule: { start: '15:00' } } }),
    ])
    const days = [makeDay([makePointItem({ id: 'z' })], 0), day1]

    const picked = await pickHeroDemo(days, async () => `/images/showcase/x.jpg`)

    expect(picked!.dayIndex).toBe(1)
    expect(picked!.summary).toBe('京吹京都一日：从京都塔出发')
    expect(picked!.items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(picked!.items.map((item) => item.time)).toEqual(['09:00', '10:30', '13:00'])
  })

  it('skips non-point items and point items without coords or images', async () => {
    const day = makeDay([
      makePointItem({ id: 'meal', type: 'meal' }),
      makeTransitItem({ mode: 'walk', durationMin: 5 }),
      makePointItem({ id: 'no-coords', lat: null, lng: null }),
      makePointItem({ id: 'no-image', image: null }),
      makePointItem({ id: 'ok', payload: { schedule: { start: '11:00' } } }),
    ])

    const picked = await pickHeroDemo([day], async () => '/images/showcase/ok.jpg')

    expect(picked!.items.map((item) => item.id)).toEqual(['ok'])
  })

  it('prefers an existing static media displayUrl without calling the resolver', async () => {
    const day = makeDay([
      makePointItem({
        id: 'has-media',
        payload: { media: { source: 'google', displayUrl: '/images/showcase/g.jpg' } },
      }),
    ])

    const picked = await pickHeroDemo([day], async () => {
      throw new Error('should not be called')
    })

    expect(picked!.items[0]!.imageUrl).toBe('/images/showcase/g.jpg')
  })

  it('ignores login-walled google proxy media and falls back to the point proxy', async () => {
    const day = makeDay([
      makePointItem({
        id: 'google-media',
        payload: { media: { source: 'google', displayUrl: '/api/google/place-photo?placeId=abc' } },
      }),
    ])
    const urls: string[] = []

    const picked = await pickHeroDemo([day], async (url) => {
      urls.push(url)
      return '/images/showcase/p.jpg'
    })

    expect(urls).toHaveLength(1)
    expect(new URL(urls[0]!).origin).toBe('https://seichigo.com')
    expect(picked!.items[0]!.imageUrl).toBe('/images/showcase/p.jpg')
  })

  it('downloads point images through the public render proxy with the h160 variant', async () => {
    const day = makeDay([makePointItem({ id: 'a' })])
    const urls: string[] = []

    await pickHeroDemo([day], async (url) => {
      urls.push(url)
      return '/images/showcase/h.jpg'
    })

    expect(urls).toHaveLength(1)
    expect(urls[0]!.startsWith('https://seichigo.com/api/anitabi/image-render?url=')).toBe(true)
    expect(decodeURIComponent(new URL(urls[0]!).searchParams.get('url') || '')).toBe(
      'https://image.anitabi.cn/points/58949/tower.jpg?plan=h160'
    )
  })

  it('skips an item whose proxy download fails and takes the next eligible one', async () => {
    const day = makeDay([
      makePointItem({ id: 'fails', image: 'https://image.anitabi.cn/points/58949/broken.jpg' }),
      makePointItem({ id: 'next', payload: { schedule: { start: '14:00' } } }),
    ])

    const picked = await pickHeroDemo([day], async (url) => {
      if (url.includes('broken')) throw new Error('proxy 502')
      return '/images/showcase/next.jpg'
    })

    expect(picked!.items.map((item) => item.id)).toEqual(['next'])
  })

  it('reads time from schedule.start, falling back to timeHint', async () => {
    const day = makeDay([
      makePointItem({ id: 'sched', payload: { schedule: { start: '09:15' } } }),
      makePointItem({ id: 'hint', timeHint: '10:45' }),
    ])

    const picked = await pickHeroDemo([day], async () => '/images/showcase/t.jpg')

    expect(picked!.items.map((item) => item.time)).toEqual(['09:15', '10:45'])
  })

  it('builds the transit label from the transit item between the first two picks', async () => {
    const day = makeDay([
      makePointItem({ id: 'a' }),
      makeTransitItem({ mode: 'walk', durationMin: 12 }),
      makePointItem({ id: 'b' }),
      makeTransitItem({ mode: 'transit', durationMin: 25 }),
      makePointItem({ id: 'c' }),
    ])

    const picked = await pickHeroDemo([day], async () => '/images/showcase/t.jpg')

    expect(picked!.transit).toEqual({ mode: 'walk', label: '步行 12 分钟' })
  })

  it('maps transit modes to chinese labels for non-walk segments', async () => {
    const day = makeDay([
      makePointItem({ id: 'a' }),
      makeTransitItem({ mode: 'transit', durationMin: 25 }),
      makePointItem({ id: 'b' }),
    ])

    const picked = await pickHeroDemo([day], async () => '/images/showcase/t.jpg')

    expect(picked!.transit).toEqual({ mode: 'transit', label: '公交 25 分钟' })
  })

  it('falls back to the default walk transit when no usable segment exists', async () => {
    const withoutTransit = makeDay([makePointItem({ id: 'a' }), makePointItem({ id: 'b' })])
    const withoutDuration = makeDay([
      makePointItem({ id: 'a' }),
      makeTransitItem({ mode: 'transit' }),
      makePointItem({ id: 'b' }),
    ])

    expect((await pickHeroDemo([withoutTransit], async () => '/x.jpg'))!.transit).toEqual(HERO_DEMO_DEFAULT_TRANSIT)
    expect((await pickHeroDemo([withoutDuration], async () => '/x.jpg'))!.transit).toEqual(HERO_DEMO_DEFAULT_TRANSIT)
  })

  it('returns null for empty days or days without eligible items', async () => {
    expect(await pickHeroDemo([], async () => '/x.jpg')).toBeNull()
    expect(await pickHeroDemo([makeDay([makePointItem({ image: null })])], async () => '/x.jpg')).toBeNull()
  })
})
