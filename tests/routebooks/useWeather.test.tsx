import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  CACHE_TTL_MS,
  EMPTY_CACHE_TTL_MS,
  clearWeatherCache,
  useWeather,
  weatherAnchor,
  weatherForDay,
} from '@/app/(authed)/me/routebooks/[id]/hooks/useWeather'
import type { DayRecord, ItemRecord, PlaceRecord, RouteBookDetail } from '@/app/(authed)/me/routebooks/[id]/types'

function isoDay(offset: number): string {
  const base = new Date()
  const utc = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate())
  return new Date(utc + offset * 86_400_000).toISOString()
}

function makeDay(id: string, dayIndex: number, date: string | null): DayRecord {
  return { id, routeBookId: 'rb1', dayIndex, date, title: null, defaultTravelMode: 'transit' }
}

function makeItem(overrides: Partial<ItemRecord>): ItemRecord {
  return {
    id: 'i1',
    routeBookId: 'rb1',
    dayId: 'd1',
    sortOrder: 0,
    kind: 'point',
    pointId: 'p1',
    placeId: null,
    title: null,
    note: null,
    timeStart: null,
    timeEnd: null,
    locked: false,
    icon: null,
    color: null,
    legMode: null,
    payload: null,
    createdAt: '2026-09-23T00:00:00.000Z',
    ...overrides,
  }
}

const HOTEL: PlaceRecord = {
  id: 'hotel',
  routeBookId: 'rb1',
  kind: 'lodging',
  title: 'Hotel',
  address: null,
  lat: 34.98,
  lng: 135.75,
  note: null,
  createdAt: '2026-09-23T00:00:00.000Z',
}

type Source = Pick<RouteBookDetail, 'id' | 'days' | 'items' | 'places' | 'lodgings'>

function makeSource(days: DayRecord[], overrides: Partial<Source> = {}): Source {
  return { id: 'rb1', days, items: [makeItem({})], places: [], lodgings: [], ...overrides }
}

const getPointPreview = (pointId: string) => ({ geo: pointId === 'p1' ? ([35.68, 139.76] as [number, number]) : null })

const fetchMock = vi.fn()

beforeEach(() => {
  clearWeatherCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useWeather', () => {
  it('无日期行程不请求', async () => {
    const { result } = renderHook(() => useWeather(makeSource([makeDay('d1', 1, null)]), getPointPreview))
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current).toEqual({})
  })

  it('没有任何坐标（条目无坐标、无住宿）不请求', async () => {
    const source = makeSource([makeDay('d1', 1, isoDay(1))], { items: [makeItem({ pointId: 'nogeo' })] })
    renderHook(() => useWeather(source, getPointPreview))
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('日期整段在预报窗口外不请求', async () => {
    renderHook(() => useWeather(makeSource([makeDay('d1', 1, isoDay(40))]), getPointPreview))
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('有日期：按首个有坐标条目与日期范围请求，结果按日期索引，并按行程本缓存', async () => {
    const d1 = isoDay(1).slice(0, 10)
    const d2 = isoDay(2).slice(0, 10)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, days: [{ date: d1, tMax: 22, tMin: 15, code: 2 }] }),
    })
    const source = makeSource([makeDay('d1', 1, isoDay(1)), makeDay('d2', 2, isoDay(2))])
    const { result, unmount } = renderHook(() => useWeather(source, getPointPreview))
    await waitFor(() => expect(result.current[d1]).toBeTruthy())
    const url = new URL(String(fetchMock.mock.calls[0]![0]), 'http://localhost')
    expect(url.pathname).toBe('/api/weather')
    expect(url.searchParams.get('lat')).toBe('35.68')
    expect(url.searchParams.get('lng')).toBe('139.76')
    expect(url.searchParams.get('from')).toBe(d1)
    expect(url.searchParams.get('to')).toBe(d2)
    expect(weatherForDay(result.current, source.days[0]!)?.code).toBe(2)
    expect(weatherForDay(result.current, source.days[1]!)).toBeNull()
    unmount()

    const second = renderHook(() => useWeather(source, getPointPreview))
    await waitFor(() => expect(second.result.current[d1]).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('useWeather 缓存 TTL / 重取（G10）', () => {
  const d1 = isoDay(1).slice(0, 10)
  const okWith = (days: unknown[]) => ({ ok: true, json: async () => ({ ok: true, days }) })

  it('非空结果缓存 1 小时：未过期不重取，过期后重取', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    fetchMock.mockResolvedValue(okWith([{ date: d1, tMax: 22, tMin: 15, code: 2 }]))
    const source = makeSource([makeDay('d1', 1, isoDay(1))])
    const first = renderHook(() => useWeather(source, getPointPreview))
    await waitFor(() => expect(first.result.current[d1]).toBeTruthy())
    first.unmount()

    now.mockReturnValue(1_000_000 + CACHE_TTL_MS - 1)
    const second = renderHook(() => useWeather(source, getPointPreview))
    await waitFor(() => expect(second.result.current[d1]).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    second.unmount()

    now.mockReturnValue(1_000_000 + CACHE_TTL_MS + 1)
    renderHook(() => useWeather(source, getPointPreview))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('空结果只缓存 5 分钟', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    fetchMock.mockResolvedValue(okWith([]))
    const source = makeSource([makeDay('d1', 1, isoDay(1))])
    const first = renderHook(() => useWeather(source, getPointPreview))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    first.unmount()

    now.mockReturnValue(1_000_000 + EMPTY_CACHE_TTL_MS - 1)
    const second = renderHook(() => useWeather(source, getPointPreview))
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    second.unmount()

    now.mockReturnValue(1_000_000 + EMPTY_CACHE_TTL_MS + 1)
    renderHook(() => useWeather(source, getPointPreview))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('锚点坐标变化时重取（缓存按参数失效）', async () => {
    fetchMock.mockResolvedValue(okWith([{ date: d1, tMax: 22, tMin: 15, code: 2 }]))
    const tokyo = makeSource([makeDay('d1', 1, isoDay(1))])
    const kyoto = makeSource([makeDay('d1', 1, isoDay(1))], {
      items: [makeItem({ kind: 'place', pointId: null, placeId: 'hotel' })],
      places: [HOTEL],
    })
    const { result, rerender } = renderHook(({ source }) => useWeather(source, getPointPreview), {
      initialProps: { source: tokyo },
    })
    await waitFor(() => expect(result.current[d1]).toBeTruthy())
    rerender({ source: kyoto })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const url = new URL(String(fetchMock.mock.calls[1]![0]), 'http://localhost')
    expect(url.searchParams.get('lat')).toBe('34.98')
    expect(url.searchParams.get('lng')).toBe('135.75')
  })

  it('请求失败（!res.ok）清掉旧天气', async () => {
    fetchMock.mockResolvedValueOnce(okWith([{ date: d1, tMax: 22, tMin: 15, code: 2 }]))
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const tokyo = makeSource([makeDay('d1', 1, isoDay(1))])
    const kyoto = makeSource([makeDay('d1', 1, isoDay(1))], {
      items: [makeItem({ kind: 'place', pointId: null, placeId: 'hotel' })],
      places: [HOTEL],
    })
    const { result, rerender } = renderHook(({ source }) => useWeather(source, getPointPreview), {
      initialProps: { source: tokyo },
    })
    await waitFor(() => expect(result.current[d1]).toBeTruthy())
    rerender({ source: kyoto })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current).toEqual({}))
  })
})

describe('weatherAnchor', () => {
  it('条目都没有坐标时退到住宿自定义点', () => {
    const source = makeSource([makeDay('d1', 1, isoDay(1))], {
      items: [makeItem({ pointId: 'nogeo' })],
      places: [HOTEL],
      lodgings: [
        { id: 'l1', routeBookId: 'rb1', placeId: 'hotel', fromDayIndex: 1, toDayIndex: 2, checkIn: null, checkOut: null, note: null },
      ],
    })
    expect(weatherAnchor(source, getPointPreview)).toEqual({ lat: 34.98, lng: 135.75 })
  })

  it('按天序取第一个有坐标条目（未安排条目不算）', () => {
    const source = makeSource([makeDay('d1', 1, null), makeDay('d2', 2, null)], {
      items: [
        makeItem({ id: 'u', dayId: null, kind: 'place', pointId: null, placeId: 'hotel' }),
        makeItem({ id: 'b', dayId: 'd2', pointId: 'p1' }),
        makeItem({ id: 'a', dayId: 'd1', pointId: 'nogeo' }),
      ],
      places: [HOTEL],
    })
    expect(weatherAnchor(source, getPointPreview)).toEqual({ lat: 35.68, lng: 139.76 })
  })
})
