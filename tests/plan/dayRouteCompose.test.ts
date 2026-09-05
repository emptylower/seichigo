import { describe, it, expect } from 'vitest'
import { composeDayRoute } from '@/app/(authed)/plan/[id]/components/dayRouteCompose'
import { dayRoutePoints } from '@/app/(authed)/plan/[id]/components/dayRouteGeometry'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

function item(overrides: Partial<TripPlanItemView>): TripPlanItemView {
  return {
    id: Math.random().toString(36).slice(2),
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

/** 站内点位条目（带坐标） */
function point(title: string, lat: number, lng: number, start: string): TripPlanItemView {
  return item({
    id: `p-${title}`,
    type: 'point',
    pointId: `pid-${title}`,
    title,
    payload: { schedule: { start, end: start, confidence: 'estimated' } },
    point: { id: `pid-${title}`, name: title, nameZh: title, lat, lng, image: null },
  })
}

/** transit 条目；polyline 为 [lat, lng] 序列（与 estimate_travel 落库格式一致） */
function transit(title: string, start: string, polyline?: Array<[number, number]>): TripPlanItemView {
  return item({
    id: `t-${title}`,
    type: 'transit',
    title,
    payload: {
      schedule: { start, end: start, confidence: 'estimated' },
      transport: { mode: 'transit', durationMin: 20, ...(polyline ? { polyline } : {}) },
    },
  })
}

function day(items: TripPlanItemView[]): TripPlanDayView {
  return { id: 'day-1', dayIndex: 1, date: null, citySlug: null, summary: null, items }
}

const A = { lat: 34.9, lng: 135.8 }
const B = { lat: 35.0, lng: 135.9 }
const C = { lat: 35.1, lng: 136.0 }

function compose(items: TripPlanItemView[]) {
  const d = day(items)
  return composeDayRoute(dayRoutePoints(d), d.items)
}

describe('composeDayRoute（R2：真实 polyline 与直线兜底拼成整天一条线）', () => {
  it('只有中间一段有 polyline → 直线段 + polyline 段首尾相接，coverage=mixed', () => {
    const result = compose([
      point('A', A.lat, A.lng, '09:00'),
      transit('A→B', '10:00'),
      point('B', B.lat, B.lng, '11:00'),
      transit('B→C', '12:00', [
        [B.lat, B.lng],
        [35.05, 135.95],
        [C.lat, C.lng],
      ]),
      point('C', C.lat, C.lng, '13:00'),
    ])
    expect(result.coverage).toBe('mixed')
    expect(result.coordinates).toEqual([
      [A.lng, A.lat],
      [B.lng, B.lat],
      [135.95, 35.05],
      [C.lng, C.lat],
    ])
  })

  it('每段都有 polyline → coverage=provider，所有点位都落在线上', () => {
    const result = compose([
      point('A', A.lat, A.lng, '09:00'),
      transit('A→B', '10:00', [
        [A.lat, A.lng],
        [34.95, 135.85],
        [B.lat, B.lng],
      ]),
      point('B', B.lat, B.lng, '11:00'),
      transit('B→C', '12:00', [
        [B.lat, B.lng],
        [35.05, 135.95],
        [C.lat, C.lng],
      ]),
      point('C', C.lat, C.lng, '13:00'),
    ])
    expect(result.coverage).toBe('provider')
    expect(result.coordinates).toEqual([
      [A.lng, A.lat],
      [135.85, 34.95],
      [B.lng, B.lat],
      [135.95, 35.05],
      [C.lng, C.lat],
    ])
  })

  it('一段 polyline 都没有 → coverage=none（调用方退回路网兜底）', () => {
    const result = compose([
      point('A', A.lat, A.lng, '09:00'),
      transit('A→B', '10:00'),
      point('B', B.lat, B.lng, '11:00'),
      point('C', C.lat, C.lng, '13:00'),
    ])
    expect(result.coverage).toBe('none')
  })

  it('polyline 首尾离端点 > 300 m → 视为该段无 polyline', () => {
    const result = compose([
      point('A', A.lat, A.lng, '09:00'),
      // 起点偏移 ~1.1 km（0.01°纬度 ≈ 1.11 km）
      transit('A→B', '10:00', [
        [A.lat + 0.01, A.lng],
        [B.lat, B.lng],
      ]),
      point('B', B.lat, B.lng, '11:00'),
    ])
    expect(result.coverage).toBe('none')
    expect(result.coordinates).toEqual([
      [A.lng, A.lat],
      [B.lng, B.lat],
    ])
  })

  it('polyline 只有 1 个点 → 视为无 polyline', () => {
    const result = compose([
      point('A', A.lat, A.lng, '09:00'),
      transit('A→B', '10:00', [[A.lat, A.lng]]),
      point('B', B.lat, B.lng, '11:00'),
    ])
    expect(result.coverage).toBe('none')
  })

  it('相邻重复坐标去重（polyline 首尾与端点重合、段间接缝都不重复）', () => {
    const result = compose([
      point('A', A.lat, A.lng, '09:00'),
      transit('A→B', '10:00', [
        [A.lat, A.lng],
        [A.lat, A.lng],
        [B.lat, B.lng],
        [B.lat, B.lng],
      ]),
      point('B', B.lat, B.lng, '11:00'),
    ])
    expect(result.coverage).toBe('provider')
    expect(result.coordinates).toEqual([
      [A.lng, A.lat],
      [B.lng, B.lat],
    ])
  })

  it('点位不足 2 个 → 空几何 + coverage=none', () => {
    const result = compose([point('A', A.lat, A.lng, '09:00')])
    expect(result.coordinates).toEqual([])
    expect(result.coverage).toBe('none')
  })
})
