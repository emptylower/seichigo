import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDayMutations } from '@/app/(authed)/me/routebooks/[id]/hooks/useDayMutations'
import type { SetDetail } from '@/app/(authed)/me/routebooks/[id]/hooks/useMutationBase'
import type { DayRecord, LodgingRecord, RouteBookDetail } from '@/app/(authed)/me/routebooks/[id]/types'

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => data } as Response
}

function makeDay(id: string, dayIndex: number, date: string | null): DayRecord {
  return { id, routeBookId: 'rb1', dayIndex, date, title: null, defaultTravelMode: 'transit' }
}

function makeLodging(id: string, fromDayIndex: number, toDayIndex: number): LodgingRecord {
  return {
    id,
    routeBookId: 'rb1',
    placeId: 'place-1',
    fromDayIndex,
    toDayIndex,
    checkIn: null,
    checkOut: null,
    note: null,
  }
}

/** startDate 2026-10-01：day1=10-01, day2=10-02, day3=10-03 */
function makeDetail(): RouteBookDetail {
  return {
    id: 'rb1',
    title: '测试行程',
    status: 'draft',
    metadata: null,
    startDate: '2026-10-01T00:00:00.000Z',
    dayCount: 3,
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
    days: [
      makeDay('day1', 1, '2026-10-01T00:00:00.000Z'),
      makeDay('day2', 2, '2026-10-02T00:00:00.000Z'),
      makeDay('day3', 3, '2026-10-03T00:00:00.000Z'),
    ],
    items: [],
    places: [],
    lodgings: [makeLodging('lod1', 2, 2), makeLodging('lod2', 3, 3)],
  }
}

function setup(detail: RouteBookDetail) {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  let current: RouteBookDetail | null = detail
  const detailRef = { current }
  const setDetail: SetDetail = (value) => {
    current = typeof value === 'function' ? value(current) : value
  }
  const handleFailure = vi.fn()
  const load = vi.fn(async () => {})
  const { result } = renderHook(() =>
    useDayMutations({
      id: 'rb1',
      detailRef,
      setDetail,
      handleFailure,
      pushUndo: vi.fn(),
      refreshPointPool: vi.fn(async () => {}),
      showToast: vi.fn(),
      load,
      locale: 'zh',
    })
  )
  return { fetchMock, handleFailure, load, result, getDetail: () => current }
}

describe('useDayMutations.insertDay', () => {
  beforeEach(() => vi.useRealTimers())
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('用响应本地插入并重编（不整页 load），返回新天 id', async () => {
    const { fetchMock, handleFailure, load, result, getDetail } = setup(makeDetail())
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        day: { ...makeDay('dayNew', 2, '2026-10-02T00:00:00.000Z'), bookUpdatedAt: '2026-09-23T01:00:00.000Z' },
        bookUpdatedAt: '2026-09-23T01:00:00.000Z',
      })
    )

    const newId = await result.current.insertDay(1)

    expect(newId).toBe('dayNew')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/me/routebooks/rb1/days')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ afterDayIndex: 1 })

    expect(load).not.toHaveBeenCalled()
    expect(handleFailure).not.toHaveBeenCalled()

    const detail = getDetail()!
    expect(detail.dayCount).toBe(4)
    expect(detail.updatedAt).toBe('2026-09-23T01:00:00.000Z')
    const byId = new Map(detail.days.map((day) => [day.id, day]))
    expect(byId.get('day1')?.dayIndex).toBe(1)
    expect(byId.get('dayNew')?.dayIndex).toBe(2)
    expect(byId.get('day2')?.dayIndex).toBe(3)
    expect(byId.get('day3')?.dayIndex).toBe(4)
    // 日期随 startDate 重算
    expect(byId.get('day2')?.date).toBe('2026-10-03T00:00:00.000Z')
    expect(byId.get('day3')?.date).toBe('2026-10-04T00:00:00.000Z')
    // 住宿顺移：lod1(2,2)→(3,3)，lod2(3,3)→(4,4)
    expect(detail.lodgings.find((row) => row.id === 'lod1')).toMatchObject({ fromDayIndex: 3, toDayIndex: 3 })
    expect(detail.lodgings.find((row) => row.id === 'lod2')).toMatchObject({ fromDayIndex: 4, toDayIndex: 4 })
  })

  it('失败时不动本地状态并走 handleFailure', async () => {
    const { fetchMock, handleFailure, load, result, getDetail } = setup(makeDetail())
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '天数最多 30' }, false, 400))

    const newId = await result.current.insertDay(3)

    expect(newId).toBeNull()
    expect(handleFailure).toHaveBeenCalledTimes(1)
    expect(load).not.toHaveBeenCalled()
    expect(getDetail()!.dayCount).toBe(3)
    expect(getDetail()!.days).toHaveLength(3)
  })
})

describe('useDayMutations.deleteDay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('用响应本地删除并重编（不整页 load）', async () => {
    const { fetchMock, handleFailure, load, result, getDetail } = setup(makeDetail())
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, bookUpdatedAt: '2026-09-23T02:00:00.000Z' }))

    const ok = await result.current.deleteDay('day2')

    expect(ok).toBe(true)
    expect(load).not.toHaveBeenCalled()
    expect(handleFailure).not.toHaveBeenCalled()

    const detail = getDetail()!
    expect(detail.dayCount).toBe(2)
    expect(detail.updatedAt).toBe('2026-09-23T02:00:00.000Z')
    expect(detail.days.map((day) => day.id)).toEqual(['day1', 'day3'])
    const day3 = detail.days.find((day) => day.id === 'day3')!
    expect(day3.dayIndex).toBe(2)
    expect(day3.date).toBe('2026-10-02T00:00:00.000Z')
    // 住宿：lod1(2,2) 覆盖被删的 Day 2 → 整段删除；lod2(3,3)→(2,2)
    expect(detail.lodgings.find((row) => row.id === 'lod1')).toBeUndefined()
    expect(detail.lodgings.find((row) => row.id === 'lod2')).toMatchObject({ fromDayIndex: 2, toDayIndex: 2 })
  })

  it('失败时不删本地天', async () => {
    const { fetchMock, handleFailure, result, getDetail } = setup(makeDetail())
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '先清空这一天再删除' }, false, 409))

    const ok = await result.current.deleteDay('day2')

    expect(ok).toBe(false)
    expect(handleFailure).toHaveBeenCalledTimes(1)
    expect(getDetail()!.days).toHaveLength(3)
  })
})
