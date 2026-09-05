import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/** RoutePreviewMap 是 MapLibre 重依赖，这里只取它收到的 routeGeometry */
const mapState = vi.hoisted(() => ({
  routeGeometry: null as null | { coordinates: Array<[number, number]> },
}))
vi.mock('@/components/route/RoutePreviewMap', () => ({
  RoutePreviewMap: (props: { routeGeometry: null | { coordinates: Array<[number, number]> } }) => {
    mapState.routeGeometry = props.routeGeometry
    return <div data-testid="route-map" />
  },
}))
vi.mock('@/components/map/ResilientMapImage', () => ({
  default: (props: { src: string | null; alt: string }) => <img data-src={props.src ?? ''} alt={props.alt} />,
}))

import { DayMap } from '@/app/(authed)/plan/[id]/components/DayMap'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

const UJI = { lat: 34.8892, lng: 135.8075 }
const KYOTO = { lat: 34.9858, lng: 135.7588 }
const OSAKA = { lat: 34.7025, lng: 135.4959 }

function pointItem(id: string, title: string, at: { lat: number; lng: number }, start: string): TripPlanItemView {
  return {
    id,
    sortOrder: 0,
    type: 'point',
    pointId: id,
    timeHint: null,
    title,
    note: null,
    reason: null,
    payload: { schedule: { start, end: start, confidence: 'estimated' } },
    point: { id, name: title, nameZh: title, lat: at.lat, lng: at.lng, image: null },
  } as TripPlanItemView
}

function transitItem(id: string, start: string, polyline?: Array<[number, number]>): TripPlanItemView {
  return {
    id,
    sortOrder: 0,
    type: 'transit',
    pointId: null,
    timeHint: null,
    title: '交通',
    note: null,
    reason: null,
    payload: {
      schedule: { start, end: start, confidence: 'estimated' },
      transport: { mode: 'transit', durationMin: 30, ...(polyline ? { polyline } : {}) },
    },
    point: null,
  } as TripPlanItemView
}

function day(items: TripPlanItemView[]): TripPlanDayView {
  return { id: 'day-1', dayIndex: 1, date: null, citySlug: null, summary: null, items }
}

describe('DayMap 路线覆盖（R2：部分真实 polyline 时不再断段）', () => {
  beforeEach(() => {
    mapState.routeGeometry = null
    vi.restoreAllMocks()
  })

  it('宇治→（真实折线）→京都→（无折线）→大阪：一条线覆盖全部点位，标注"部分示意"且不请求通用路网', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    render(
      <DayMap
        planId="plan-1"
        day={day([
          pointItem('p-uji', '宇治桥', UJI, '09:00'),
          transitItem('t-real', '10:00', [
            [UJI.lat, UJI.lng],
            [34.94, 135.78],
            [KYOTO.lat, KYOTO.lng],
          ]),
          pointItem('p-kyoto', '京都站', KYOTO, '11:00'),
          transitItem('t-plain', '12:00'),
          pointItem('p-osaka', '大阪城', OSAKA, '13:00'),
        ])}
      />,
    )

    const coordinates = mapState.routeGeometry?.coordinates ?? []
    for (const point of [UJI, KYOTO, OSAKA]) {
      expect(coordinates.some(([lng, lat]) => lng === point.lng && lat === point.lat)).toBe(true)
    }
    // 缺折线的段用直线补齐：京都站与大阪城在同一条线上前后相邻
    const kyotoIndex = coordinates.findIndex(([lng, lat]) => lng === KYOTO.lng && lat === KYOTO.lat)
    expect(coordinates[kyotoIndex + 1]).toEqual([OSAKA.lng, OSAKA.lat])
    expect(screen.getByText('部分示意')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('一段真实折线都没有：仍走通用路网兜底（发请求），不标"部分示意"', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    render(
      <DayMap
        planId="plan-1"
        day={day([
          pointItem('p-uji', '宇治桥', UJI, '09:00'),
          transitItem('t-plain', '10:00'),
          pointItem('p-kyoto', '京都站', KYOTO, '11:00'),
        ])}
      />,
    )

    expect(screen.queryByText('部分示意')).not.toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalled()
  })
})
