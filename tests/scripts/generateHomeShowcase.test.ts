import { describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import {
  extractShowcaseSummary,
  isGoogleProxyImageUrl,
  rewriteShowcaseDays,
  slimShowcaseDays,
  withMaxWidth,
} from '@/lib/home/showcase'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

function makeItem(payload: unknown): TripPlanItemView {
  return {
    id: 'item-1',
    sortOrder: 0,
    type: 'point',
    pointId: 'point-1',
    timeHint: null,
    title: '须贺神社',
    note: null,
    reason: '《你的名字》结尾阶梯',
    payload: payload as Prisma.JsonValue,
    point: {
      id: 'point-1',
      name: 'Suga Shrine',
      nameZh: '须贺神社',
      lat: 35.7013,
      lng: 139.7966,
      image: 'https://anitabi.cn/pictures/suga.jpg',
    },
  }
}

function makeDay(items: TripPlanItemView[]): TripPlanDayView {
  return {
    id: 'day-1',
    dayIndex: 1,
    date: null,
    citySlug: 'tokyo',
    summary: null,
    items,
  }
}

describe('isGoogleProxyImageUrl / withMaxWidth', () => {
  it('detects both google proxy paths and rejects everything else', () => {
    expect(isGoogleProxyImageUrl('/api/google/place-photo?placeId=abc&maxwidth=1600')).toBe(true)
    expect(isGoogleProxyImageUrl('/api/google/point-photo?pointId=xyz&maxwidth=400')).toBe(true)
    expect(isGoogleProxyImageUrl('/api/anitabi/image-render?src=https://x.jpg')).toBe(false)
    expect(isGoogleProxyImageUrl('https://lh3.googleusercontent.com/x')).toBe(false)
    expect(isGoogleProxyImageUrl(null)).toBe(false)
  })

  it('forces maxwidth=800 and replaces an existing value', () => {
    expect(withMaxWidth('/api/google/place-photo?placeId=abc&maxwidth=1600'))
      .toBe('/api/google/place-photo?placeId=abc&maxwidth=800')
    expect(withMaxWidth('/api/google/place-photo?ref=r%20ef'))
      .toBe('/api/google/place-photo?ref=r+ef&maxwidth=800')
  })
})

describe('rewriteShowcaseDays', () => {
  it('rewrites google place-photo media to the downloader-provided static path', async () => {
    const day = makeDay([makeItem({
      media: { source: 'google', displayUrl: '/api/google/place-photo?placeId=abc&maxwidth=1600' },
    })])
    const downloads: string[] = []

    const days = await rewriteShowcaseDays([day], async (url) => {
      downloads.push(url)
      return '/images/showcase/deadbeef.jpg'
    })

    expect(downloads).toEqual(['/api/google/place-photo?placeId=abc&maxwidth=800'])
    const media = (days[0]!.items[0]!.payload as { media: { displayUrl: string } }).media
    expect(media.displayUrl).toBe('/images/showcase/deadbeef.jpg')
  })

  it('rewrites point-photo media as well', async () => {
    const day = makeDay([makeItem({
      media: { displayUrl: '/api/google/point-photo?pointId=xyz&maxwidth=400' },
    })])

    const days = await rewriteShowcaseDays([day], async () => '/images/showcase/hash.jpg')

    expect((days[0]!.items[0]!.payload as { media: { displayUrl: string } }).media.displayUrl)
      .toBe('/images/showcase/hash.jpg')
  })

  it('leaves non-google urls untouched and never calls the downloader', async () => {
    const day = makeDay([makeItem({
      media: { displayUrl: '/api/anitabi/image-render?src=https%3A%2F%2Fanitabi.cn%2Fa.jpg&w=600' },
    })])
    const downloader = async () => {
      throw new Error('should not be called')
    }

    const days = await rewriteShowcaseDays([day], downloader)

    expect(days[0]!.items[0]!.payload).toEqual(day.items[0]!.payload)
    expect(days[0]!.items[0]!.point?.image).toBe('https://anitabi.cn/pictures/suga.jpg')
  })

  it('supports a narrower maxWidth option for 320px showcase images', async () => {
    const day = makeDay([makeItem({
      media: { source: 'google', displayUrl: '/api/google/place-photo?placeId=abc&maxwidth=1600' },
    })])
    const downloads: string[] = []

    await rewriteShowcaseDays([day], async (url) => {
      downloads.push(url)
      return '/images/showcase/small.jpg'
    }, { maxWidth: 320 })

    expect(downloads).toEqual(['/api/google/place-photo?placeId=abc&maxwidth=320'])
  })

  it('drops media when the download fails so the card falls back to point.image', async () => {
    const day = makeDay([makeItem({
      note: 'keep me',
      media: { source: 'google', displayUrl: '/api/google/place-photo?placeId=abc' },
    })])

    const days = await rewriteShowcaseDays([day], async () => {
      throw new Error('download failed')
    })

    const payload = days[0]!.items[0]!.payload as { media?: unknown; note?: string }
    expect(payload.media).toBeUndefined()
    expect(payload.note).toBe('keep me')
  })

  it('does not mutate the input days', async () => {
    const day = makeDay([makeItem({
      media: { displayUrl: '/api/google/place-photo?placeId=abc&maxwidth=1600' },
    })])
    const snapshot = JSON.stringify(day)

    await rewriteShowcaseDays([day], async () => '/images/showcase/x.jpg')

    expect(JSON.stringify(day)).toBe(snapshot)
  })

  it('rewrites nested place.photo.displayUrl and drops only the photo on failure', async () => {
    const okDay = makeDay([makeItem({
      place: {
        name: '東京駅',
        lat: 35.6812,
        lng: 139.7671,
        photo: { displayUrl: '/api/google/place-photo?placeId=abc&maxwidth=1600' },
      },
    })])
    const failDay = makeDay([makeItem({
      place: {
        name: '浅草寺',
        lat: 35.7148,
        lng: 139.7967,
        photo: { displayUrl: '/api/google/place-photo?placeId=def&maxwidth=1600' },
      },
    })])

    const days = await rewriteShowcaseDays([okDay, failDay], async (url) => {
      if (url.includes('placeId=abc')) return '/images/showcase/ok.jpg'
      throw new Error('download failed')
    })

    const okPlace = days[0]!.items[0]!.payload as unknown as {
      place: { name: string; photo: { displayUrl: string } }
    }
    expect(okPlace.place.photo.displayUrl).toBe('/images/showcase/ok.jpg')
    expect(okPlace.place.name).toBe('東京駅')

    const failPlace = days[1]!.items[0]!.payload as unknown as {
      place: { name: string; photo?: unknown }
    }
    expect(failPlace.place.photo).toBeUndefined()
    expect(failPlace.place.name).toBe('浅草寺')
  })

  it('leaves malformed payloads untouched by the google branch', async () => {
    const day = makeDay([
      makeItem({ media: 'not-an-object' }),
      makeItem({ media: { displayUrl: 42 } }),
    ])
    // 去掉 point，隔离 A1 点位图分支（那是新契约的职责，见下方 describe）
    for (const item of day.items) item.point = null

    const days = await rewriteShowcaseDays([day], async () => {
      throw new Error('should not be called')
    })

    expect(days[0]!.items.map((item) => item.payload)).toEqual(day.items.map((item) => item.payload))
  })
})

/** 公开代理 URL 是双重编码：searchParams 解一层，decodeURIComponent 再解一层 */
function decodeProxyTarget(proxyUrl: string): string {
  return decodeURIComponent(new URL(proxyUrl).searchParams.get('url') || '')
}

describe('rewriteShowcaseDays point-image staticization（A1，§0）', () => {
  it('downloads the point image via the public render proxy and writes an anitabi media block', async () => {
    const day = makeDay([makeItem({ schedule: { start: '09:30' } })])
    const downloads: string[] = []

    const days = await rewriteShowcaseDays([day], async (url) => {
      downloads.push(url)
      return '/images/showcase/point-hash.jpg'
    })

    expect(downloads).toHaveLength(1)
    expect(downloads[0]!.startsWith('https://seichigo.com/api/anitabi/image-render?url=')).toBe(true)
    // 候选 URL 来自 getMapDisplayImageCandidates(point.image, { kind: 'point-thumbnail' })[0]：
    // 归一到 image.anitabi.cn 且 plan=h160
    expect(decodeProxyTarget(downloads[0]!)).toBe('https://image.anitabi.cn/pictures/suga.jpg?plan=h160')
    expect((days[0]!.items[0]!.payload as { media: unknown }).media).toEqual({
      source: 'anitabi',
      displayUrl: '/images/showcase/point-hash.jpg',
      attribution: 'Anitabi',
    })
    // point.image 保留原值供非静态场景
    expect(days[0]!.items[0]!.point?.image).toBe('https://anitabi.cn/pictures/suga.jpg')
  })

  it('does not overwrite an existing media block', async () => {
    const day = makeDay([makeItem({
      media: { source: 'google', displayUrl: '/images/showcase/already.jpg' },
    })])

    const days = await rewriteShowcaseDays([day], async () => {
      throw new Error('should not be called')
    })

    expect((days[0]!.items[0]!.payload as { media: unknown }).media).toEqual({
      source: 'google',
      displayUrl: '/images/showcase/already.jpg',
    })
  })

  it('keeps the item media-less when the proxy download fails', async () => {
    const day = makeDay([makeItem({ note: 'keep me' })])

    const days = await rewriteShowcaseDays([day], async () => {
      throw new Error('proxy 502')
    })

    const payload = days[0]!.items[0]!.payload as { media?: unknown; note?: string }
    expect(payload.media).toBeUndefined()
    expect(payload.note).toBe('keep me')
    expect(days[0]!.items[0]!.point?.image).toBe('https://anitabi.cn/pictures/suga.jpg')
  })

  it('creates a media block even when the payload was null', async () => {
    const day = makeDay([makeItem(null)])

    const days = await rewriteShowcaseDays([day], async () => '/images/showcase/created.jpg')

    expect((days[0]!.items[0]!.payload as { media: unknown }).media).toEqual({
      source: 'anitabi',
      displayUrl: '/images/showcase/created.jpg',
      attribution: 'Anitabi',
    })
  })

  it('replaces a malformed media value with a valid static block', async () => {
    const day = makeDay([makeItem({ media: 'not-an-object' })])

    const days = await rewriteShowcaseDays([day], async () => '/images/showcase/fixed.jpg')

    expect((days[0]!.items[0]!.payload as { media: unknown }).media).toEqual({
      source: 'anitabi',
      displayUrl: '/images/showcase/fixed.jpg',
      attribution: 'Anitabi',
    })
  })

  it('never calls the downloader for items without a point image', async () => {
    const day = makeDay([makeItem({ schedule: { start: '09:00' } })])
    day.items[0]!.point = { ...day.items[0]!.point!, image: null }

    const days = await rewriteShowcaseDays([day], async () => {
      throw new Error('should not be called')
    })

    expect(days[0]!.items[0]!.payload).toEqual({ schedule: { start: '09:00' } })
  })

  it('does not mutate the input days when staticizing point images', async () => {
    const day = makeDay([makeItem(null)])
    const snapshot = JSON.stringify(day)

    await rewriteShowcaseDays([day], async () => '/images/showcase/x.jpg')

    expect(JSON.stringify(day)).toBe(snapshot)
  })
})

describe('slimShowcaseDays', () => {
  function makeRichPayload(): Record<string, unknown> {
    return {
      placeQuery: '须贺神社 東京',
      place: {
        placeId: 'ChIJabc',
        name: '須賀神社',
        lat: 35.70131234,
        lng: 139.79665678,
        mapsUri: 'https://maps.google.com/?q=suga',
        address: '新宿区須賀町5',
        provider: 'google',
        fetchedAt: '2026-09-01T00:00:00.000Z',
        photo: { displayUrl: '/api/google/place-photo?placeId=ChIJabc', photoReference: 'ref-secret' },
        photos: [{ photoReference: 'ref-secret', attribution: 'Google' }],
        photoMirrorKey: 'mirror-key',
        photoMirrorStatus: 'ok',
      },
      media: {
        source: 'google',
        displayUrl: '/images/showcase/deadbeef.jpg',
        attribution: 'Photo by Google user',
        photoReference: 'ref-secret',
        photoIndex: 2,
      },
      schedule: { start: '09:00', end: '10:30', confidence: 'explicit', note: 'extra' },
      transport: {
        mode: 'transit',
        durationMin: 45,
        distanceKm: 12.3,
        transfers: 1,
        walkMin: 8,
        provider: 'google',
        estimated: true,
        mapsUrl: 'https://www.google.com/maps',
        note: '路线备注',
        source: 'google',
        fetchedAt: '2026-09-01T00:00:00.000Z',
        legs: [
          { mode: 'walk', durationMin: 5, distanceKm: 0.3, instruction: '步行至车站', line: 'JR中央线', fromStop: '四ツ谷', toStop: '御茶ノ水', numStops: 2, headsign: '東京', departureTime: '09:05', arrivalTime: '09:10', secretField: 'x' },
        ],
        polyline: [
          [139.79665678, 35.70131234],
          [139.79671234, 35.70145678],
          ...Array.from({ length: 98 }, (_, i) => [139.79 + i * 0.0001, 35.70 + i * 0.0001] as [number, number]),
          ['bad', 'entry'],
          [139.8, 35.71],
        ],
      },
      mealSlot: 'lunch',
    }
  }

  it('keeps only the whitelisted payload fields per §0 and drops every google reference field', () => {
    const day = makeDay([makeItem(makeRichPayload())])

    const [slimmed] = slimShowcaseDays([day])
    const payload = slimmed.items[0]!.payload as Record<string, unknown>

    expect(Object.keys(payload).sort()).toEqual(['media', 'place', 'schedule', 'transport'])

    expect(payload.place).toEqual({
      placeId: 'ChIJabc',
      name: '須賀神社',
      lat: 35.70131234,
      lng: 139.79665678,
      mapsUri: 'https://maps.google.com/?q=suga',
    })
    expect(payload.media).toEqual({
      source: 'google',
      displayUrl: '/images/showcase/deadbeef.jpg',
      attribution: 'Photo by Google user',
    })
    expect(payload.schedule).toEqual({ start: '09:00', end: '10:30', confidence: 'explicit' })
    expect(payload.transport).toEqual({
      mode: 'transit',
      durationMin: 45,
      distanceKm: 12.3,
      transfers: 1,
      walkMin: 8,
      provider: 'google',
      estimated: true,
      mapsUrl: 'https://www.google.com/maps',
      note: '路线备注',
      source: 'google',
      legs: [
        { mode: 'walk', durationMin: 5, distanceKm: 0.3, line: 'JR中央线', fromStop: '四ツ谷', toStop: '御茶ノ水', numStops: 2, headsign: '東京', departureTime: '09:05', arrivalTime: '09:10' },
      ],
      polyline: expect.any(Array),
    })

    const serialized = JSON.stringify(slimmed)
    expect(serialized).not.toContain('photoReference')
    expect(serialized).not.toContain('photos')
    expect(serialized).not.toContain('placeQuery')
    expect(serialized).not.toContain('fetchedAt')
  })

  it('thins polylines to at most 80 points with 5-decimal coordinates and preserved endpoints', () => {
    const polyline: Array<[number, number]> = Array.from(
      { length: 100 },
      (_, i) => [139.7 + i * 0.00112345, 35.7 + i * 0.00112345] as [number, number],
    )
    const day = makeDay([makeItem({ transport: { polyline } })])

    const [slimmed] = slimShowcaseDays([day])
    const out = (slimmed.items[0]!.payload as { transport: { polyline: Array<[number, number]> } }).transport.polyline

    expect(out.length).toBeLessThanOrEqual(80)
    expect(out.length).toBe(80)
    expect(out[0]).toEqual([139.7, 35.7])
    expect(out[out.length - 1]).toEqual([139.81122, 35.81122])
    for (const [lng, lat] of out) {
      expect(Number(lng.toFixed(5))).toBe(lng)
      expect(Number(lat.toFixed(5))).toBe(lat)
    }
  })

  it('keeps short polylines intact, drops invalid entries, and preserves non-payload item fields', () => {
    const day = makeDay([makeItem({
      schedule: { start: '09:00', end: '10:00' },
      transport: { polyline: [[139.1, 35.1], ['x', 'y'], [139.2, 35.2]] },
    })])

    const [slimmed] = slimShowcaseDays([day])
    const item = slimmed.items[0]!

    expect(item.id).toBe(day.items[0]!.id)
    expect(item.title).toBe(day.items[0]!.title)
    expect(item.reason).toBe(day.items[0]!.reason)
    expect(item.point).toEqual(day.items[0]!.point)
    expect((item.payload as { transport: { polyline: unknown } }).transport.polyline).toEqual([[139.1, 35.1], [139.2, 35.2]])
    expect((item.payload as Record<string, unknown>).schedule).toEqual({ start: '09:00', end: '10:00' })
  })

  it('keeps flat M1 transport payloads readable by getTransport and drops everything else', () => {
    const day = makeDay([makeItem({ mode: 'walk', durationMin: 8, distanceKm: 0.65, fetchedAt: 'x', placeQuery: 'q' })])

    const [slimmed] = slimShowcaseDays([day])
    expect(slimmed.items[0]!.payload).toEqual({ mode: 'walk', durationMin: 8, distanceKm: 0.65 })
  })

  it('drops turn-by-turn instructions from walk legs (no showcase value, biggest UTF-8 bulk)', () => {
    const day = makeDay([makeItem({
      transport: {
        legs: [
          { mode: 'walk', durationMin: 1, instruction: '向北前行，走到南通り' },
          { mode: 'transit', instruction: '乘中央线', line: 'JR中央线' },
        ],
      },
    })])

    const [slimmed] = slimShowcaseDays([day])
    const legs = (slimmed.items[0]!.payload as { transport: { legs: Array<Record<string, unknown>> } }).transport.legs

    expect(legs[0]).toEqual({ mode: 'walk', durationMin: 1 })
    expect(legs[1]).toEqual({ mode: 'transit', instruction: '乘中央线', line: 'JR中央线' })
  })

  it('does not mutate the input days and leaves null payloads alone', () => {
    const day = makeDay([makeItem(makeRichPayload()), makeItem(null)])
    const snapshot = JSON.stringify(day)

    slimShowcaseDays([day])

    expect(JSON.stringify(day)).toBe(snapshot)
    const again = makeDay([makeItem(null)])
    expect(slimShowcaseDays([again])[0]!.items[0]!.payload).toBeNull()
  })
})
describe('extractShowcaseSummary', () => {
  it('takes the first complete sentence of the first non-empty assistant text', () => {
    const summary = extractShowcaseSummary([
      { kind: 'human', content: { content: '帮我排一个东京八天的行程' } },
      { kind: 'assistant', content: { content: '' } },
      { kind: 'daymap', content: { type: 'daymap' } },
      { kind: 'assistant', content: { content: '圣诞周去东京一周加迪士尼，这组合很棒！后面还有更多安排。' } },
    ])

    expect(summary).toBe('圣诞周去东京一周加迪士尼，这组合很棒！')
  })

  it('keeps an over-80-char sentence whole and appends an ellipsis', () => {
    const longSentence = 'あ'.repeat(120) + '。然后是第二句。'
    const summary = extractShowcaseSummary([
      { kind: 'assistant', content: { content: longSentence } },
    ])

    expect(summary).toBe('あ'.repeat(120) + '。…')
  })

  it('truncates terminator-free text at 80 chars with an ellipsis', () => {
    const longText = 'あ'.repeat(120)
    const summary = extractShowcaseSummary([
      { kind: 'assistant', content: { content: longText } },
    ])

    expect(summary).toBe('あ'.repeat(80) + '…')
    expect(extractShowcaseSummary([{ kind: 'assistant', content: { content: '短文本没有句号' } }]))
      .toBe('短文本没有句号')
  })

  it('falls back to the plan title without its date segment for procedural openings', () => {
    const planTitle = '2026东京圣诞周8日｜天气之子×你的名字 巡礼 + 迪士尼'
    const procedural = [
      '我先帮你在点位库里找找东京周边有巡礼点位的候选作品。',
      '让我先查一下几部以东……',
      '我来排一版行程给你。好的。',
    ]

    for (const content of procedural) {
      expect(extractShowcaseSummary([
        { kind: 'assistant', content: { content } },
      ], planTitle)).toBe('天气之子×你的名字 巡礼 + 迪士尼')
    }
  })

  it('uses the whole plan title as the fallback when it has no date separator', () => {
    expect(extractShowcaseSummary([
      { kind: 'assistant', content: { content: '我先查一下。' } },
    ], '东京八日巡礼计划')).toBe('东京八日巡礼计划')
  })

  it('keeps the sentence when it is procedural but no plan title is available', () => {
    expect(extractShowcaseSummary([
      { kind: 'assistant', content: { content: '我先查一下点位库。' } },
    ])).toBe('我先查一下点位库。')
  })

  it('returns an empty string when no assistant text exists', () => {
    expect(extractShowcaseSummary([
      { kind: 'human', content: { content: 'hi' } },
      { kind: 'tool', content: {} },
    ])).toBe('')
    expect(extractShowcaseSummary([])).toBe('')
  })
})
