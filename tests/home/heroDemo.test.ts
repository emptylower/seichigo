import { describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import {
  HERO_DEMO_DEFAULT_TIMES,
  parseHomeHeroDemo,
  pickHeroDemo,
} from '@/lib/home/heroDemo'
import type { HomeHeroDemo, HomeHeroDemoTransit } from '@/lib/home/heroDemo'
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
  pointName?: string
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
      name: overrides.pointName ?? '京都タワー',
      nameZh: '京都塔',
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
    title: ' 京都塔 → 清水寺',
    note: null,
    reason: null,
    payload: { transport } as unknown as Prisma.JsonValue,
    point: null,
  }
}

function makeDay(items: TripPlanItemView[], dayIndex = 1, summary = '京吹京都一日：从京都塔出发'): TripPlanDayView {
  return {
    id: `day-${dayIndex}`,
    dayIndex,
    date: null,
    citySlug: 'kyoto',
    summary,
    items,
  }
}

describe('parseHomeHeroDemo（§0 形状校验，第十四轮）', () => {
  const validItem = (id: string, title: string) => ({
    id,
    title,
    titles: { zh: title, en: `${title} (EN)`, ja: `${title} (JA)` },
    time: '09:30',
    imageUrl: `/images/showcase/${id}.jpg`,
    lat: 35.7013,
    lng: 139.7966,
  })
  const valid: HomeHeroDemo = {
    planTitle: '你的名字 东京巡礼 8 日计划',
    day: {
      dayIndex: 2,
      summary: '新宿一带：《你的名字》圣地一日',
      items: [validItem('a', '须贺神社男坂'), validItem('b', '信浓町步道桥'), validItem('c', '四谷见附桥')],
      transit: [
        { fromId: 'a', toId: 'b', mode: 'walk', label: '步行 12 分钟' },
        { fromId: 'b', toId: 'c', mode: 'train', label: '电车 5 分钟' },
      ],
    },
    map: {
      src: '/images/home/hero-phone-map.webp',
      width: 320,
      height: 240,
      markers: [
        { itemId: 'a', x: 48.5, y: 120 },
        { itemId: 'b', x: 160, y: 88.5 },
      ],
      attribution: '© MapTiler © OpenStreetMap contributors',
    },
  }

  it('parses a valid new-shape payload and passes the fields through', () => {
    expect(parseHomeHeroDemo(valid)).toEqual(valid)
  })

  it('accepts a payload without map (degrades to undefined) and normalizes missing transit to []', () => {
    const raw = { planTitle: valid.planTitle, day: { ...valid.day, transit: undefined } }
    expect(parseHomeHeroDemo(raw)).toEqual({ planTitle: valid.planTitle, day: { ...valid.day, transit: [] } })
  })

  it('accepts the legacy shape: items without lat/lng/titles and old object-form transit', () => {
    const legacy = {
      planTitle: '京吹京都巡礼 3 日',
      day: {
        dayIndex: 1,
        summary: '京吹京都一日',
        items: [
          { id: 'a', title: '京都音乐厅', time: '上午', imageUrl: '/images/showcase/a.jpg' },
          { id: 'b', title: '出町桥', time: '上午', imageUrl: '/images/showcase/b.jpg' },
        ],
        transit: { mode: 'walk', label: '步行 · 约 10 分钟' },
      },
    }
    expect(parseHomeHeroDemo(legacy)).toEqual({
      planTitle: '京吹京都巡礼 3 日',
      day: {
        dayIndex: 1,
        summary: '京吹京都一日',
        items: [
          {
            id: 'a',
            title: '京都音乐厅',
            titles: { zh: '京都音乐厅', en: '京都音乐厅', ja: '京都音乐厅' },
            time: '上午',
            imageUrl: '/images/showcase/a.jpg',
            lat: 0,
            lng: 0,
          },
          {
            id: 'b',
            title: '出町桥',
            titles: { zh: '出町桥', en: '出町桥', ja: '出町桥' },
            time: '上午',
            imageUrl: '/images/showcase/b.jpg',
            lat: 0,
            lng: 0,
          },
        ],
        transit: [],
      },
      map: undefined,
    })
  })

  it('keeps localized titles and falls back per-language to title for partial or malformed titles', () => {
    const base = {
      planTitle: valid.planTitle,
      day: {
        ...valid.day,
        items: [
          // 缺整个 titles：三语都回退 title
          { id: 'no-titles', title: '须贺神社男坂', time: '09:30', imageUrl: '/images/showcase/x.jpg', lat: 0, lng: 0 },
          // 部分缺省 / 非字符串：缺失语言回退 title
          {
            id: 'partial',
            title: '信浓町步道桥',
            titles: { zh: '信浓町步道桥', en: 42 },
            time: '10:20',
            imageUrl: '/images/showcase/y.jpg',
            lat: 0,
            lng: 0,
          },
          // titles 不是对象：整体回退
          {
            id: 'bad-shape',
            title: '四谷见附桥',
            titles: '四谷见附桥',
            time: '11:10',
            imageUrl: '/images/showcase/z.jpg',
            lat: 0,
            lng: 0,
          },
        ],
      },
    }
    expect(parseHomeHeroDemo(base)!.day.items.map((item) => item.titles)).toEqual([
      { zh: '须贺神社男坂', en: '须贺神社男坂', ja: '须贺神社男坂' },
      { zh: '信浓町步道桥', en: '信浓町步道桥', ja: '信浓町步道桥' },
      { zh: '四谷见附桥', en: '四谷见附桥', ja: '四谷见附桥' },
    ])
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
    expect(parseHomeHeroDemo({ ...valid, day: { ...valid.day, dayIndex: 'one' } })).toBeNull()
  })

  it('rejects malformed transit entries', () => {
    expect(
      parseHomeHeroDemo({ ...valid, day: { ...valid.day, transit: [{ fromId: 'a', mode: 'walk', label: 'x' }] } })
    ).toBeNull()
    expect(
      parseHomeHeroDemo({ ...valid, day: { ...valid.day, transit: [{ fromId: 'a', toId: 'b', mode: ' ', label: 'x' }] } })
    ).toBeNull()
  })

  it('rejects malformed map blocks instead of silently degrading', () => {
    expect(parseHomeHeroDemo({ ...valid, map: { ...valid.map, src: ' ' } })).toBeNull()
    expect(parseHomeHeroDemo({ ...valid, map: { ...valid.map, width: Number.NaN } })).toBeNull()
    expect(parseHomeHeroDemo({ ...valid, map: { ...valid.map, markers: [{ itemId: 'a', x: 1 }] } })).toBeNull()
    expect(parseHomeHeroDemo({ ...valid, map: { ...valid.map, attribution: 42 } })).toBeNull()
  })
})

describe('pickHeroDemo（选取规则，第十四轮 §0）', () => {
  it('picks the day with the most point items whose title contains the anime keyword', async () => {
    const day1 = makeDay(
      [
        makePointItem({ id: 'k1', title: '京都塔' }),
        makeTransitItem({ mode: 'walk', durationMin: 10 }),
        makePointItem({ id: 'k2', title: '《你的名字》须贺神社' }),
      ],
      1
    )
    const day2 = makeDay(
      [
        makePointItem({ id: 'a', title: '你的名字｜须贺神社男坂' }),
        makeTransitItem({ mode: 'walk', durationMin: 12 }),
        makePointItem({ id: 'b', title: '你的名字｜信浓町步道桥' }),
        makePointItem({ id: 'c', title: '你的名字｜四谷见附桥' }),
      ],
      2
    )

    const picked = await pickHeroDemo([day1, day2], async () => '/images/showcase/x.jpg', { anime: '你的名字' })

    expect(picked!.dayIndex).toBe(2)
    expect(picked!.items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('breaks anime-count ties by keeping the earliest day', async () => {
    const day1 = makeDay([makePointItem({ id: 'a', title: '你的名字｜A' }), makePointItem({ id: 'b', title: '别的作品' })], 1)
    const day2 = makeDay([makePointItem({ id: 'c', title: '你的名字｜C' }), makePointItem({ id: 'd', title: '无冠' })], 2)

    const picked = await pickHeroDemo([day1, day2], async () => '/images/showcase/x.jpg', { anime: '你的名字' })

    expect(picked!.dayIndex).toBe(1)
  })

  it('falls back to day 1 when no day matches the anime keyword (or no keyword given)', async () => {
    const day1 = makeDay([makePointItem({ id: 'a', title: '京都塔' })], 1)
    const day2 = makeDay([makePointItem({ id: 'b', title: '清水寺' })], 2)

    const byKeyword = await pickHeroDemo([day1, day2], async () => '/x.jpg', { anime: '你的名字' })
    const withoutKeyword = await pickHeroDemo([day2, day1], async () => '/x.jpg')

    expect(byKeyword!.dayIndex).toBe(1)
    expect(withoutKeyword!.dayIndex).toBe(1)
  })

  it('only counts point items (not transit items) for the anime keyword', async () => {
    const day1 = makeDay(
      [
        makePointItem({ id: 'a', title: '京都塔' }),
        makeTransitItem({ mode: 'walk', durationMin: 5 }),
        makePointItem({ id: 'b', title: '鸭川' }),
      ],
      1
    )
    const day2 = makeDay(
      [
        makePointItem({ id: 'c', title: '晴空塔' }),
        { ...makeTransitItem({ mode: 'train', durationMin: 20 }), title: '前往你的名字圣地' },
        makePointItem({ id: 'd', title: '浅草寺' }),
      ],
      2
    )

    const picked = await pickHeroDemo([day1, day2], async () => '/x.jpg', { anime: '你的名字' })

    expect(picked!.dayIndex).toBe(1)
  })

  it('keeps dayIndex from the source day (front end renders a fixed "Day 1" badge)', async () => {
    const day2 = makeDay([makePointItem({ id: 'a', title: '你的名字｜A' })], 2)
    const picked = await pickHeroDemo([makeDay([makePointItem({ id: 'z' })], 1), day2], async () => '/x.jpg', {
      anime: '你的名字',
    })
    expect(picked!.dayIndex).toBe(2)
  })

  it('prefers anime-keyword items over earlier non-keyword items for the 3 slots', async () => {
    const day = makeDay([
      makePointItem({ id: 'garden-1', title: '言叶之庭・新宿御苑 新宿门' }),
      makePointItem({ id: 'kimi-1', title: '你的名字・须贺神社男坂' }),
      makePointItem({ id: 'garden-2', title: '言叶之庭・东屋' }),
      makePointItem({ id: 'kimi-2', title: '你的名字・信浓町步道桥' }),
      makePointItem({ id: 'kimi-3', title: '你的名字・四谷见附桥' }),
    ])

    const picked = await pickHeroDemo([day], async () => '/x.jpg', { anime: '你的名字' })

    expect(picked!.items.map((item) => item.id)).toEqual(['kimi-1', 'kimi-2', 'kimi-3'])
  })

  it('fills the remaining slots with earlier non-keyword items when fewer than 3 match the anime keyword', async () => {
    const day = makeDay([
      makePointItem({ id: 'early-1', title: '言叶之庭・新宿御苑 新宿门' }),
      makePointItem({ id: 'early-2', title: '言叶之庭・东屋' }),
      makePointItem({ id: 'early-3', title: '天气之子・歌舞伎町一番街入口' }),
      makePointItem({ id: 'kimi-late', title: '你的名字・须贺神社男坂' }),
    ])

    const picked = await pickHeroDemo([day], async () => '/x.jpg', { anime: '你的名字' })

    expect(picked!.items.map((item) => item.id)).toEqual(['early-1', 'early-2', 'kimi-late'])
  })

  it('orders the picked entries by their original order in the day even when fills follow an anime match', async () => {
    const day = makeDay([
      makePointItem({ id: 'early-1', title: '言叶之庭・新宿御苑 新宿门' }),
      makePointItem({ id: 'early-2', title: '言叶之庭・东屋' }),
      makePointItem({ id: 'kimi-1', title: '你的名字・须贺神社男坂' }),
      makePointItem({ id: 'late-4', title: '天气之子・歌舞伎町一番街入口' }),
    ])

    const picked = await pickHeroDemo([day], async () => '/x.jpg', { anime: '你的名字' })

    expect(picked!.items.map((item) => item.id)).toEqual(['early-1', 'early-2', 'kimi-1'])
  })

  it('sums intermediate walk minutes when the picked pair is not adjacent in the day', async () => {
    const day = makeDay([
      makePointItem({ id: 'a', title: '你的名字・须贺神社男坂', payload: { schedule: { start: '11:38' } } }),
      makeTransitItem({ mode: 'walk', durationMin: 13 }),
      makePointItem({ id: 'lunch', type: 'meal' }),
      makeTransitItem({ mode: 'transit', durationMin: 33 }),
      makePointItem({ id: 'detour', title: '言叶之庭・旧御凉亭' }),
      makeTransitItem({ mode: 'walk', durationMin: 21 }),
      makePointItem({ id: 'b', title: '你的名字・信浓町步道桥', payload: { schedule: { start: '15:58' } } }),
      makeTransitItem({ mode: 'walk', durationMin: 13 }),
      makePointItem({ id: 'c', title: '你的名字・四谷见附桥', payload: { schedule: { start: '17:11' } } }),
    ])

    const picked = await pickHeroDemo([day], async () => '/x.jpg', { anime: '你的名字' })

    expect(picked!.items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(picked!.transit).toEqual([
      { fromId: 'a', toId: 'b', mode: 'walk', label: '步行 34 分钟' },
      { fromId: 'b', toId: 'c', mode: 'walk', label: '步行 13 分钟' },
    ] satisfies HomeHeroDemoTransit[])
  })

  it('falls back to the distance estimate when a non-adjacent pair has no walk minutes between', async () => {
    const day = makeDay([
      makePointItem({ id: 'a', title: '你的名字・A', lat: 35.7, lng: 139.79 }),
      makeTransitItem({ mode: 'train', durationMin: 20 }),
      makePointItem({ id: 'mid', title: '别的作品・中间点', lat: 35.74, lng: 139.79, image: null }),
      makeTransitItem({ mode: 'train', durationMin: 20 }),
      makePointItem({ id: 'b', title: '你的名字・B', lat: 35.78, lng: 139.79 }),
    ])

    const picked = await pickHeroDemo([day], async () => '/x.jpg', { anime: '你的名字' })

    expect(picked!.transit).toEqual([{ fromId: 'a', toId: 'b', mode: 'walk', label: '步行 · 约 111 分钟' }])
  })

  it('passes item coordinates through and limits picks to 3 routable items with images', async () => {
    const day = makeDay([
      makePointItem({ id: 'a', title: 'A', lat: 35.7013, lng: 139.7966, payload: { schedule: { start: '09:00' } } }),
      makePointItem({ id: 'b', title: 'B', lat: 35.6985, lng: 139.7982 }),
      makePointItem({ id: 'c', title: 'C', lat: 35.6961, lng: 139.7995 }),
      makePointItem({ id: 'd', title: 'D' }),
    ])

    const picked = await pickHeroDemo([day], async () => '/images/showcase/x.jpg')

    expect(picked!.items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(picked!.items[0]).toMatchObject({ lat: 35.7013, lng: 139.7966 })
    expect(picked!.items[1]).toMatchObject({ lat: 35.6985, lng: 139.7982 })
    expect(picked!.items[2]).toMatchObject({ lat: 35.6961, lng: 139.7995 })
  })

  it('builds localized titles: zh from the item title, ja/en from the point original name', async () => {
    const day = makeDay([
      makePointItem({ id: 'a', title: '你的名字・须贺神社男坂', pointName: '須賀神社男坂上' }),
      makePointItem({ id: 'b', title: '你的名字・信浓町步道桥', pointName: '信濃町歩道橋' }),
    ])

    const picked = await pickHeroDemo([day], async () => '/x.jpg', { anime: '你的名字' })

    expect(picked!.items.map((item) => item.titles)).toEqual([
      { zh: '你的名字・须贺神社男坂', en: '須賀神社男坂上', ja: '須賀神社男坂上' },
      { zh: '你的名字・信浓町步道桥', en: '信濃町歩道橋', ja: '信濃町歩道橋' },
    ])
    // title 保留为 zh 值
    expect(picked!.items.map((item) => item.title)).toEqual(['你的名字・须贺神社男坂', '你的名字・信浓町步道桥'])
    expect(picked!.items.every((item) => item.titles.zh === item.title)).toBe(true)
  })

  it('falls back ja/en titles to the item title when the point name is blank', async () => {
    const day = makeDay([makePointItem({ id: 'a', title: '你的名字・须贺神社男坂', pointName: '  ' })])

    const picked = await pickHeroDemo([day], async () => '/x.jpg', { anime: '你的名字' })

    expect(picked!.items[0]!.titles).toEqual({ zh: '你的名字・须贺神社男坂', en: '你的名字・须贺神社男坂', ja: '你的名字・须贺神社男坂' })
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

  it('reads time from schedule.start and otherwise falls back to the fixed demo sequence', async () => {
    const day = makeDay([
      makePointItem({ id: 'sched', payload: { schedule: { start: '09:15' } } }),
      makePointItem({ id: 'no-sched', timeHint: '10:45' }),
      makePointItem({ id: 'also-none' }),
    ])

    const picked = await pickHeroDemo([day], async () => '/images/showcase/t.jpg')

    expect(picked!.items.map((item) => item.time)).toEqual(['09:15', ...HERO_DEMO_DEFAULT_TIMES.slice(1)])
  })

  it('builds one transit entry per adjacent picked pair from the transit items between them', async () => {
    const day = makeDay([
      makePointItem({ id: 'a', payload: { schedule: { start: '09:30' } } }),
      makeTransitItem({ mode: 'walk', durationMin: 12 }),
      makePointItem({ id: 'b', payload: { schedule: { start: '10:20' } } }),
      makeTransitItem({ mode: 'transit', durationMin: 25 }),
      makePointItem({ id: 'c', payload: { schedule: { start: '11:10' } } }),
    ])

    const picked = await pickHeroDemo([day], async () => '/images/showcase/t.jpg')

    expect(picked!.transit).toEqual([
      { fromId: 'a', toId: 'b', mode: 'walk', label: '步行 12 分钟' },
      { fromId: 'b', toId: 'c', mode: 'transit', label: '公交 25 分钟' },
    ] satisfies HomeHeroDemoTransit[])
  })

  it('computes walk minutes from straight-line distance when a pair has no usable transit segment', async () => {
    // 纯纬度差 0.08° ≈ 8896 m；8896 / 80 ≈ 111.2 → 约 111 分钟
    const day = makeDay([
      makePointItem({ id: 'a', lat: 35.70, lng: 139.79 }),
      makePointItem({ id: 'b', lat: 35.78, lng: 139.79 }),
    ])
    const adjacent = makeDay([
      makePointItem({ id: 'a', lat: 35.70, lng: 139.79 }),
      makeTransitItem({ mode: 'train' }),
      makePointItem({ id: 'b', lat: 35.78, lng: 139.79 }),
    ])

    const picked = await pickHeroDemo([day], async () => '/x.jpg')
    const withoutDuration = await pickHeroDemo([adjacent], async () => '/x.jpg')

    expect(picked!.transit).toEqual([{ fromId: 'a', toId: 'b', mode: 'walk', label: '步行 · 约 111 分钟' }])
    expect(withoutDuration!.transit).toEqual(picked!.transit)
  })

  it('clamps the distance fallback to at least one minute for near-identical points', async () => {
    const day = makeDay([
      makePointItem({ id: 'a', lat: 35.70, lng: 139.79 }),
      makePointItem({ id: 'b', lat: 35.70, lng: 139.79 }),
    ])

    const picked = await pickHeroDemo([day], async () => '/x.jpg')

    expect(picked!.transit).toEqual([{ fromId: 'a', toId: 'b', mode: 'walk', label: '步行 · 约 1 分钟' }])
  })

  it('returns null for empty days or days without eligible items', async () => {
    expect(await pickHeroDemo([], async () => '/x.jpg')).toBeNull()
    expect(await pickHeroDemo([makeDay([makePointItem({ image: null })])], async () => '/x.jpg')).toBeNull()
  })
})
