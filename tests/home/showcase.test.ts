import { describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { getSchedule } from '@/app/(authed)/plan/[id]/components/itemPayload'
import { parseHomeShowcase, projectShowcaseDaysForHome } from '@/lib/home/showcase'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

function makeItem(payload: unknown, overrides: Partial<TripPlanItemView> = {}): TripPlanItemView {
  return {
    id: 'item-1',
    sortOrder: 3,
    type: 'point',
    pointId: 'point-1',
    timeHint: 'morning',
    title: '须贺神社',
    note: '备注',
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
    ...overrides,
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

describe('projectShowcaseDaysForHome', () => {
  it('keeps only mode/durationMin/distanceKm in transport and drops place entirely', () => {
    const day = makeDay([makeItem({
      place: { placeId: 'ChIJabc', name: '須賀神社', lat: 35.7, lng: 139.79, mapsUri: 'https://maps.google.com/?q=suga' },
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
        legs: [{ mode: 'walk', durationMin: 5, instruction: '向北前行' }],
        polyline: [[139.79, 35.7], [139.8, 35.71]],
      },
    })])

    const [projected] = projectShowcaseDaysForHome([day])
    const payload = projected.items[0]!.payload as Record<string, unknown>

    expect(payload.transport).toEqual({ mode: 'transit', durationMin: 45, distanceKm: 12.3 })
    expect(payload.place).toBeUndefined()
  })

  it('drops transport entirely when none of the three keys remain', () => {
    const day = makeDay([makeItem({
      schedule: { start: '09:00', end: '10:30' },
      transport: { note: '只有备注', legs: [{ instruction: '向北前行' }], polyline: [[139.79, 35.7]] },
    })])

    const [projected] = projectShowcaseDaysForHome([day])
    expect((projected.items[0]!.payload as Record<string, unknown>).transport).toBeUndefined()
    expect((projected.items[0]!.payload as Record<string, unknown>).schedule).toEqual({ start: '09:00', end: '10:30' })
  })

  it('keeps only displayUrl/source/attribution in media and drops media without displayUrl', () => {
    const withUrl = makeItem({
      media: { displayUrl: '/images/showcase/a.jpg', source: 'google', attribution: 'Photo by Google user', photoReference: 'ref-secret' },
    }, { id: 'item-with-url' })
    const withoutUrl = makeItem({
      media: { source: 'google', attribution: 'Photo by Google user', photoReference: 'ref-secret' },
    }, { id: 'item-without-url' })

    const [projected] = projectShowcaseDaysForHome([makeDay([withUrl, withoutUrl])])

    expect(projected.items[0]!.payload).toEqual({
      media: { displayUrl: '/images/showcase/a.jpg', source: 'google', attribution: 'Photo by Google user' },
    })
    expect(projected.items[1]!.payload).toBeNull()
  })

  it('drops schedule.confidence while getSchedule still resolves start/end (falls back to estimated)', () => {
    const day = makeDay([makeItem({
      schedule: { start: '09:00', end: '10:30', confidence: 'explicit', note: 'extra' },
    })])

    const [projected] = projectShowcaseDaysForHome([day])
    const item = projected.items[0]!

    expect((item.payload as Record<string, unknown>).schedule).toEqual({ start: '09:00', end: '10:30' })
    expect(getSchedule(item)).toEqual({ start: '09:00', end: '10:30', confidence: 'estimated' })
  })

  it('preserves item-level fields and unlisted payload keys untouched', () => {
    const day = makeDay([makeItem({ mealSlot: 'lunch', fetchedAt: '2026-09-01T00:00:00.000Z' })])
    const original = day.items[0]!

    const [projected] = projectShowcaseDaysForHome([day])
    const item = projected.items[0]!

    expect(item.id).toBe(original.id)
    expect(item.title).toBe(original.title)
    expect(item.note).toBe(original.note)
    expect(item.reason).toBe(original.reason)
    expect(item.type).toBe(original.type)
    expect(item.pointId).toBe(original.pointId)
    expect(item.timeHint).toBe(original.timeHint)
    expect(item.sortOrder).toBe(original.sortOrder)
    expect(item.point).toEqual(original.point)
    expect(item.payload).toEqual({ mealSlot: 'lunch', fetchedAt: '2026-09-01T00:00:00.000Z' })
  })

  it('keeps flat M1 transport payloads at the payload root readable by getTransport', () => {
    const day = makeDay([makeItem({ mode: 'walk', durationMin: 8, distanceKm: 0.65 })])

    const [projected] = projectShowcaseDaysForHome([day])
    expect(projected.items[0]!.payload).toEqual({ mode: 'walk', durationMin: 8, distanceKm: 0.65 })
  })

  it('leaves null payloads alone and nulls payloads that project to nothing', () => {
    const nullItem = makeItem(null)
    const placeOnly = makeItem({ place: { placeId: 'ChIJabc', name: '須賀神社', lat: 35.7, lng: 139.79 } })

    const [projected] = projectShowcaseDaysForHome([makeDay([nullItem, placeOnly])])

    expect(projected.items[0]!.payload).toBeNull()
    expect(projected.items[1]!.payload).toBeNull()
  })

  it('does not mutate the input days', () => {
    const day = makeDay([makeItem({
      place: { placeId: 'ChIJabc', name: '須賀神社', lat: 35.7, lng: 139.79 },
      transport: { mode: 'walk', durationMin: 12, polyline: [[139.79, 35.7]] },
      media: { displayUrl: '/images/showcase/a.jpg' },
      schedule: { start: '09:00', end: '10:30', confidence: 'explicit' },
    })])
    const snapshot = JSON.stringify(day)

    projectShowcaseDaysForHome([day])

    expect(JSON.stringify(day)).toBe(snapshot)
  })
})

describe('parseHomeShowcase (home projection wiring)', () => {
  it('projects days before returning while keeping the envelope fields', () => {
    const parsed = parseHomeShowcase({
      revisionId: 'rev-1',
      savedAt: '2026-09-05T00:00:00.000Z',
      title: '东京 8 日巡礼',
      summary: '一段摘要',
      days: [{
        id: 'day-1',
        dayIndex: 1,
        date: null,
        citySlug: 'tokyo',
        summary: null,
        items: [makeItem({
          place: { placeId: 'ChIJabc', name: '須賀神社', lat: 35.7, lng: 139.79 },
          transport: { mode: 'walk', durationMin: 12, polyline: [[139.79, 35.7]] },
        })],
      }],
    })

    expect(parsed).not.toBeNull()
    expect(parsed!.revisionId).toBe('rev-1')
    expect(parsed!.days[0]!.items[0]!.payload).toEqual({ transport: { mode: 'walk', durationMin: 12 } })
  })

  it('still rejects structurally invalid payloads', () => {
    expect(parseHomeShowcase({ revisionId: 'rev-1', savedAt: 'x', title: 't', days: 'not-an-array' })).toBeNull()
    expect(parseHomeShowcase(null)).toBeNull()
  })
})
