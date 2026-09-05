import { describe, expect, it, vi } from 'vitest'
import {
  MAX_CELLS,
  isInvalidCityName,
  median,
  normalizeCityName,
  streamPointCoordinates,
  trimCellsToByteBudget,
} from '../../scripts/homeMapClustersScript'

type Row = { id: string; lat: number | null; lng: number | null; bangumiId?: number | null }

describe('map clusters script constants', () => {
  it('raises MAX_CELLS to 2000 while keeping the ≤50KB file budget meaningful', () => {
    expect(MAX_CELLS).toBe(2000)
  })
})

describe('trimCellsToByteBudget', () => {
  const cells = [1, 2, 3, 4, 5].map((count) => ({ lng: 139, lat: 35, count }))
  const measure = (list: typeof cells) => list.length * 10

  it('returns all cells when they already fit the budget', () => {
    expect(trimCellsToByteBudget(cells, 50, measure)).toHaveLength(5)
    expect(trimCellsToByteBudget([], 50, measure)).toEqual([])
  })

  it('keeps the hottest prefix that fits exactly (off-by-one boundaries)', () => {
    expect(trimCellsToByteBudget(cells, 35, measure)).toHaveLength(3)
    expect(trimCellsToByteBudget(cells, 34, measure)).toHaveLength(3)
    expect(trimCellsToByteBudget(cells, 30, measure)).toHaveLength(3)
    expect(trimCellsToByteBudget(cells, 29, measure)).toHaveLength(2)
    expect(trimCellsToByteBudget(cells, 10, measure)).toHaveLength(1)
  })

  it('falls back to a single cell when even one exceeds the budget', () => {
    expect(trimCellsToByteBudget(cells, 5, measure)).toHaveLength(1)
  })
})

describe('city name helpers（A3 城市标签口径）', () => {
  it('normalizes administrative suffixes and special prefecture names', () => {
    expect(normalizeCityName('东京都')).toBe('东京')
    expect(normalizeCityName('東京都')).toBe('东京')
    expect(normalizeCityName('京都市')).toBe('京都')
    expect(normalizeCityName('镰仓市')).toBe('镰仓')
    expect(normalizeCityName('涩谷区')).toBe('涩谷')
    expect(normalizeCityName('名古屋市')).toBe('名古屋')
    expect(normalizeCityName('神奈川县')).toBe('神奈川')
    // 专名不动：北海道的"道"不在后缀表，"京都"不会二次剥掉"都"
    expect(normalizeCityName('北海道')).toBe('北海道')
    expect(normalizeCityName('京都')).toBe('京都')
    expect(normalizeCityName('东京')).toBe('东京')
  })

  it('flags placeholder / country-level / numeric city strings as invalid', () => {
    for (const bad of ['0', '1', '233', '日本', '海外', '欧洲', '中国', '全世界', '其他', ' ', '']) {
      expect(isInvalidCityName(bad), bad).toBe(true)
    }
    expect(isInvalidCityName(null)).toBe(true)
    expect(isInvalidCityName(undefined)).toBe(true)
    expect(isInvalidCityName('东京都')).toBe(false)
    expect(isInvalidCityName('镰仓市')).toBe(false)
  })
})

describe('median（城市质心）', () => {
  it('returns the middle element for odd lengths and the mean of the middle pair for even', () => {
    expect(median([3])).toBe(3)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it('does not mutate the input and returns NaN for empty input', () => {
    const input = [9, 2, 7]
    median(input)
    expect(input).toEqual([9, 2, 7])
    expect(median([])).toBeNaN()
  })
})

describe('streamPointCoordinates（游标分页）', () => {
  it('walks pages by the last row id and stops on the first empty page', async () => {
    const pages = new Map<string | null, Row[]>([
      [null, [
        { id: 'a', lat: 35.1, lng: 139.1 },
        { id: 'b', lat: 35.2, lng: 139.2 },
      ]],
      ['b', [
        { id: 'c', lat: 35.3, lng: 139.3 },
        { id: 'd', lat: null, lng: 139.4 },
      ]],
      ['d', []],
    ])
    const cursors: Array<string | null> = []
    const fetchPage = vi.fn(async (cursor: string | null) => {
      cursors.push(cursor)
      return pages.get(cursor) ?? []
    })

    const points: Array<{ lat: number; lng: number }> = []
    for await (const point of streamPointCoordinates(fetchPage)) {
      points.push(point)
    }

    expect(cursors).toEqual([null, 'b', 'd'])
    expect(points).toEqual([
      { lat: 35.1, lng: 139.1 },
      { lat: 35.2, lng: 139.2 },
      { lat: 35.3, lng: 139.3 },
    ])
  })

  it('uses the last row of each page as the next cursor even when it lacks coordinates', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce([
        { id: 'a', lat: 1, lng: 2 },
        { id: 'z', lat: null, lng: null },
      ])
      .mockResolvedValueOnce([{ id: 'b', lat: 3, lng: 4 }])
      .mockResolvedValueOnce([])

    const points: Array<{ lat: number; lng: number }> = []
    for await (const point of streamPointCoordinates(fetchPage)) {
      points.push(point)
    }

    expect(fetchPage).toHaveBeenNthCalledWith(2, 'z')
    expect(points).toEqual([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }])
  })

  it('terminates immediately when the first page is empty', async () => {
    const fetchPage = vi.fn(async () => [] as Row[])

    const points: Array<{ lat: number; lng: number }> = []
    for await (const point of streamPointCoordinates(fetchPage)) {
      points.push(point)
    }

    expect(points).toEqual([])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('carries bangumiId through for the A3 city-label grouping', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce([
        { id: 'a', lat: 35.1, lng: 139.1, bangumiId: 42 },
        { id: 'b', lat: 35.2, lng: 139.2, bangumiId: null },
        { id: 'c', lat: 35.3, lng: 139.3 },
      ])
      .mockResolvedValueOnce([])

    const points: Array<{ lat: number; lng: number; bangumiId?: number }> = []
    for await (const point of streamPointCoordinates(fetchPage)) {
      points.push(point)
    }

    expect(points).toEqual([
      { lat: 35.1, lng: 139.1, bangumiId: 42 },
      { lat: 35.2, lng: 139.2 },
      { lat: 35.3, lng: 139.3 },
    ])
  })
})
