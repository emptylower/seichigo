import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// 地图/图片组件是重依赖（MapLibre / 图片请求调度），测试里替换为轻量桩
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/components/route/RoutePreviewMap', () => ({
  RoutePreviewMap: (props: { points: Array<{ lat: number; lng: number; label: string }>; routeGeometry: unknown }) => (
    <div data-testid="route-map" data-points={JSON.stringify(props.points)} data-has-geometry={props.routeGeometry ? '1' : '0'} />
  ),
}))
vi.mock('@/components/map/ResilientMapImage', () => ({
  default: (props: { src: string | null; alt: string }) => (
    <div data-testid="resilient-image" data-src={props.src ?? ''}>
      {props.alt}
    </div>
  ),
}))

import { DayCards } from '@/app/(authed)/plan/[id]/components/DayCards'
import type { TripPlanItemView, TripPlanView } from '@/lib/tripPlan/view'

function planItem(overrides: Partial<TripPlanItemView>): TripPlanItemView {
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

function makePlan(): TripPlanView {
  return {
    id: 'plan-1',
    title: '测试计划',
    status: 'draft',
    startDate: '2026-09-15T00:00:00.000Z',
    dayCount: 1,
    bangumiIds: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
    days: [
      {
        id: 'day-1',
        dayIndex: 1,
        date: '2026-09-15T00:00:00.000Z',
        citySlug: null,
        summary: null,
        items: [
          planItem({
            id: 'item-late',
            type: 'point',
            pointId: '115908:uji',
            title: '宇治桥',
            timeHint: '午后',
            point: { id: '115908:uji', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, image: null },
            payload: { schedule: { start: '13:00', end: '14:00', confidence: 'reference' } },
          }),
          planItem({
            id: 'item-transit',
            type: 'transit',
            title: 'JR 去京都',
            payload: {
              schedule: { start: '14:00', end: '14:35', confidence: 'estimated' },
              transport: {
                mode: 'transit',
                durationMin: 35,
                distanceKm: 18.5,
                legs: [
                  { mode: 'walk', durationMin: 3, distanceKm: 0.2 },
                  { mode: 'transit', line: 'JR奈良线', fromStop: '宇治駅', toStop: '京都駅', numStops: 4 },
                ],
              },
            },
          }),
          planItem({
            id: 'item-disney',
            type: 'point',
            pointId: null,
            title: '東京ディズニーランド',
            timeHint: '傍晚',
            payload: {
              schedule: { start: '15:00', end: '18:00', confidence: 'estimated' },
              place: { provider: 'google', placeId: 'ChIJ1', name: '東京ディズニーランド', lat: 35.6329, lng: 139.8804 },
              media: { source: 'google_places', displayUrl: '/api/google/place-photo?ref=Aref1234567890' },
            },
          }),
        ],
      },
    ],
  }
}

function renderDayCards(plan = makePlan()) {
  return render(
    <DayCards planId="plan-1" days={plan.days} scope="current" />,
  )
}

describe('DayCards（M3 行程卡渲染）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('每个点位卡显示具体时钟时间；参考/预估时间带标注', () => {
    renderDayCards()
    expect(screen.getByText('13:00–14:00')).toBeInTheDocument()
    expect(screen.getByText('15:00–18:00')).toBeInTheDocument()
    // "午后"换算的参考时间有标注（两个 reference/预估标记）
    expect(screen.getAllByTitle('由宽泛时段换算的参考/预估时间').length).toBeGreaterThan(0)
    expect(screen.getAllByText('参考').length).toBeGreaterThan(0)
    // 原"午后"标签不再作为唯一时间（具体时间在场）
    expect(screen.queryByText('午后')).not.toBeInTheDocument()
  })

  it('外部 Google 地点与站内点位一起编号参与时间轴', () => {
    renderDayCards()
    // 两个 point 各得一个序号徽标 1 / 2
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Google 地点')).toBeInTheDocument()
  })

  it('transit 行渲染分段详情（步行 → 线路/站数/上下车站）与主文案', () => {
    renderDayCards()
    expect(screen.getByText(/JR奈良线 4 站（从宇治駅到京都駅）/)).toBeInTheDocument()
    expect(screen.getByText('乘车 35 分钟 · 18.5km')).toBeInTheDocument()
  })

  it('地图 tab：外部+站内点位都进地图；provider 折线优先（不请求通用路网）', async () => {
    const plan = makePlan()
    const transitPayload = plan.days[0].items[1].payload as Record<string, unknown>
    transitPayload.transport = {
      ...(transitPayload.transport as Record<string, unknown>),
      polyline: [
        [34.89, 135.8],
        [34.98, 135.76],
      ],
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    renderDayCards(plan)
    fireEvent.click(screen.getByText('地图', { selector: 'button' }))

    const map = await screen.findByTestId('route-map')
    const points = JSON.parse(map.getAttribute('data-points') ?? '[]') as Array<{ label: string }>
    expect(points.map((p) => p.label)).toEqual(['1', '2'])
    expect(map.getAttribute('data-has-geometry')).toBe('1')
    // provider 几何在场 → 不回退请求通用路网 API
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('M3 修订：历史数据（payload 无 schedule，timeHint 只有"午后"）也显示具体时钟时间，不退化成宽泛词', () => {
    const legacyPlan: TripPlanView = {
      ...makePlan(),
      days: [
        {
          id: 'day-legacy',
          dayIndex: 1,
          date: null,
          citySlug: null,
          summary: null,
          items: [
            planItem({
              id: 'legacy-1',
              type: 'point',
              pointId: '115908:uji',
              title: '宇治桥',
              timeHint: '午后',
              payload: null,
              point: { id: '115908:uji', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, image: null },
            }),
            planItem({
              id: 'legacy-t',
              type: 'transit',
              title: 'JR 去京都',
              payload: { mode: 'transit', durationMin: 30, distanceKm: 18 },
            }),
            planItem({
              id: 'legacy-2',
              type: 'point',
              pointId: '115908:kyoto',
              title: '京都站',
              timeHint: null,
              payload: null,
              point: { id: '115908:kyoto', name: '京都駅', nameZh: '京都站', lat: 34.9858, lng: 135.7585, image: null },
            }),
          ],
        },
      ],
    }
    renderDayCards(legacyPlan)
    // "午后"换算参考时刻 13:00–14:00；交通 30 分钟后顺延的京都站得到推导区间
    expect(screen.getByText('13:00–14:00')).toBeInTheDocument()
    expect(screen.getByText('14:30–15:30')).toBeInTheDocument()
    // 推导/参考时间带标注，而不是只剩宽泛词
    expect(screen.getAllByText(/预估|参考/).length).toBeGreaterThan(0)
    // 宽泛词不再作为唯一时间来源：没有裸"午后" chip
    const chip = screen.queryByText('午后')
    expect(chip).not.toBeInTheDocument()
  })

  it('M3 修订：attraction 挂外部地点是完整行程点——计序号、显示媒体图、进地图', async () => {
    const attractionPlan: TripPlanView = {
      ...makePlan(),
      days: [
        {
          id: 'day-attraction',
          dayIndex: 1,
          date: null,
          citySlug: null,
          summary: null,
          items: [
            planItem({
              id: 'pt-1',
              type: 'point',
              pointId: '115908:uji',
              title: '宇治桥',
              payload: { schedule: { start: '09:00', end: '10:00', confidence: 'explicit' } },
              point: { id: '115908:uji', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, image: null },
            }),
            planItem({
              id: 'attr-1',
              type: 'attraction',
              pointId: null,
              title: '東京ディズニーランド',
              payload: {
                schedule: { start: '13:00', end: '18:00', confidence: 'explicit' },
                place: { provider: 'google', placeId: 'ChIJ1', name: '東京ディズニーランド', lat: 35.6329, lng: 139.8804 },
                media: { source: 'google_places', displayUrl: '/api/google/place-photo?ref=Aref1234567890' },
              },
            }),
          ],
        },
      ],
    }
    const { container } = renderDayCards(attractionPlan)

    // 计序号：attraction 外部地点与站内点位一样编号（1、2 徽标都在）
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    // 媒体图：attraction 用 payload.media 的 keyless 代理 URL
    const image = container.querySelector('[data-testid="resilient-image"][data-src="/api/google/place-photo?ref=Aref1234567890"]')
    expect(image).not.toBeNull()
    // 具体时间 + Google 地点标记
    expect(screen.getByText('13:00–18:00')).toBeInTheDocument()
    expect(screen.getByText('Google 地点')).toBeInTheDocument()

    // 进地图：切到地图 tab，外部地点带编号标签参与路线
    fireEvent.click(screen.getByText('地图', { selector: 'button' }))
    const map = await screen.findByTestId('route-map')
    const points = JSON.parse(map.getAttribute('data-points') ?? '[]') as Array<{ label: string; lat: number }>
    expect(points.map((p) => p.label)).toEqual(['1', '2'])
    expect(points[1]?.lat).toBeCloseTo(35.6329, 4)
  })

  it('无 provider 几何时退回通用路网并明确标注"参考路线（示意）"', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, geometry: { type: 'LineString', coordinates: [[139, 35], [139.1, 35.1]] } })))
    renderDayCards()
    fireEvent.click(screen.getByText('地图', { selector: 'button' }))

    const map = await screen.findByTestId('route-map')
    expect(map.getAttribute('data-has-geometry')).toBe('1')
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '')
    expect(calledUrl).toContain('/route-geometry')
    expect(calledUrl).toContain('mode=walking')
    expect(await screen.findByText('参考路线（示意）')).toBeInTheDocument()
    fetchSpy.mockRestore()
  })
})
