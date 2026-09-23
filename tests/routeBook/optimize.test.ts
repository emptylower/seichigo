import { describe, expect, it } from 'vitest'
import { haversineM, optimizeDay, routeDistanceM, type OptimizePoint } from '@/lib/routeBook/optimize'
import { resolveDayAnchors } from '@/lib/routeBook/anchors'

function p(id: string, lat: number, lng: number, fixed = false): OptimizePoint {
  return { id, lat, lng, fixed }
}

const ll = (point: OptimizePoint) => ({ lat: point.lat, lng: point.lng })

describe('haversineM / routeDistanceM', () => {
  it('直线距离量级正确，路线总长含首尾锚点', () => {
    expect(Math.round(haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) / 1000)).toBe(111)
    const route = [p('a', 0, 0), p('b', 0, 1)]
    const withAnchors = routeDistanceM(route.map(ll), { start: { lat: 0, lng: -1 }, end: { lat: 0, lng: 2 } })
    const without = routeDistanceM(route.map(ll), {})
    expect(withAnchors).toBeGreaterThan(without * 2.99)
    expect(withAnchors).toBeLessThan(without * 3.01)
  })
})

describe('optimizeDay', () => {
  it('free 不足 2 个（单点 / 全固定）原样返回', () => {
    expect(optimizeDay([p('a', 0, 0)], {})).toEqual(['a'])
    expect(optimizeDay([], {})).toEqual([])
    expect(optimizeDay([p('a', 0, 0, true), p('b', 1, 1, true)], {})).toEqual(['a', 'b'])
  })

  it('fixed 项保持原下标，free 填入空位', () => {
    const points = [p('f1', 0, 0, true), p('x', 5, 5), p('f2', 1, 1, true), p('y', 5, 6)]
    const result = optimizeDay(points, {})
    expect(result[0]).toBe('f1')
    expect(result[2]).toBe('f2')
    expect(result.slice().sort()).toEqual(['f1', 'f2', 'x', 'y'])
  })

  it('有 start=end 锚时结果首元素是离锚最近的自由点', () => {
    const hotel = { lat: 0, lng: 0 }
    const points = [p('far', 5, 0), p('near', 1, 0), p('mid', 2, 0)]
    const result = optimizeDay(points, { start: hotel, end: hotel })
    expect(result[0]).toBe('near')
  })

  it('方形交叉（蝴蝶结）被 2-opt 修正为无交叉环游', () => {
    // 输入顺序 A,B,C,D：A(0,0)→B(1,1) 与 C(0,1)→D(1,0) 交叉；最优为 A,C,B,D（或其逆 A,D,B,C）
    const points = [p('A', 0, 0), p('B', 1, 1), p('C', 0, 1), p('D', 1, 0)]
    const result = optimizeDay(points, {})
    expect(result[0]).toBe('A')
    expect(['A,C,B,D', 'A,D,B,C']).toContain(result.join())

    const byId = new Map(points.map((point) => [point.id, point]))
    const distance = routeDistanceM(
      result.map((id) => ll(byId.get(id)!)),
      {}
    )
    // 方形边长约 111km：最优 = 3 条边，且明显小于交叉序（≈ 3.83 条边）
    expect(distance).toBeLessThan(334_000)
    expect(distance).toBeGreaterThan(332_000)
  })

  it('2-opt 后总长不劣于最近邻结果', () => {
    const points = [
      p('a', 35.0101, 135.7681),
      p('b', 35.0202, 135.7512),
      p('c', 34.9987, 135.7768),
      p('d', 35.0111, 135.7801),
      p('e', 35.0066, 135.7599),
      p('f', 34.9969, 135.7701),
      p('g', 35.0168, 135.7600),
    ]
    const anchors = { start: { lat: 35.0, lng: 135.77 }, end: { lat: 35.017, lng: 135.77 } }
    const result = optimizeDay(points, anchors)
    const byId = new Map(points.map((point) => [point.id, point]))
    const optimized = routeDistanceM(result.map((id) => ll(byId.get(id)!)), anchors)
    const naive = routeDistanceM(points.map(ll), anchors)
    expect(optimized).toBeLessThanOrEqual(naive)
    expect(new Set(result).size).toBe(points.length)
  })
})

describe('resolveDayAnchors', () => {
  const lodgings = [
    { placeId: 'pl-a', fromDayIndex: 1, toDayIndex: 3 },
    { placeId: 'pl-b', fromDayIndex: 3, toDayIndex: 5 },
  ]
  const places = [
    { id: 'pl-a', lat: 35.1, lng: 135.1 },
    { id: 'pl-b', lat: 35.2, lng: 135.2 },
  ]

  it('入住日只有 end，退房日只有 start', () => {
    expect(resolveDayAnchors(1, lodgings, places)).toEqual({ end: { lat: 35.1, lng: 135.1 } })
    expect(resolveDayAnchors(3, lodgings, places)).toEqual({ start: { lat: 35.1, lng: 135.1 }, end: { lat: 35.2, lng: 135.2 } })
    expect(resolveDayAnchors(5, lodgings, places)).toEqual({ start: { lat: 35.2, lng: 135.2 } })
  })

  it('住中 start=end 同一酒店；换酒店日 start/end 来自不同 lodging', () => {
    expect(resolveDayAnchors(2, lodgings, places)).toEqual({ start: { lat: 35.1, lng: 135.1 }, end: { lat: 35.1, lng: 135.1 } })
    // day 3：a 退房（start）、b 入住（end）
    const day3 = resolveDayAnchors(3, lodgings, places)
    expect(day3.start).toEqual({ lat: 35.1, lng: 135.1 })
    expect(day3.end).toEqual({ lat: 35.2, lng: 135.2 })
    // day 4：住中 b
    expect(resolveDayAnchors(4, lodgings, places)).toEqual({ start: { lat: 35.2, lng: 135.2 }, end: { lat: 35.2, lng: 135.2 } })
  })

  it('from == to 的当天锚点同时作为 start 与 end；无住宿为空对象', () => {
    const anchorLodging = [{ placeId: 'pl-a', fromDayIndex: 2, toDayIndex: 2 }]
    expect(resolveDayAnchors(2, anchorLodging, places)).toEqual({ start: { lat: 35.1, lng: 135.1 }, end: { lat: 35.1, lng: 135.1 } })
    expect(resolveDayAnchors(1, anchorLodging, places)).toEqual({})
  })

  it('place 缺失时该锚忽略', () => {
    expect(resolveDayAnchors(2, [{ placeId: 'ghost', fromDayIndex: 1, toDayIndex: 3 }], places)).toEqual({})
  })
})
