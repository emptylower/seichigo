import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// 地图/图片组件是重依赖（MapLibre / 图片请求调度），测试里替换为轻量桩
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
const routeMapState = vi.hoisted(() => ({
  latestProps: null as null | {
    points: Array<{ id?: string; lat: number; lng: number; label: string }>
    routeGeometry: unknown
    activePointId?: string | null
    onPointSelect?: (id: string) => void
    renderPopup?: (id: string) => HTMLElement | null
    interactive?: boolean
  },
  /** 置 true 时 mock 组件渲染即抛错（错误边界用例：模拟 WebGL 初始化失败冒泡） */
  shouldThrow: false,
}))
vi.mock('@/components/route/RoutePreviewMap', () => ({
  RoutePreviewMap: (props: NonNullable<typeof routeMapState.latestProps>) => {
    if (routeMapState.shouldThrow) {
      throw new Error('webglcontextcreationerror: Failed to initialize WebGL')
    }
    routeMapState.latestProps = props
    return (
      <div
        data-testid="route-map"
        data-points={JSON.stringify(props.points)}
        data-has-geometry={props.routeGeometry ? '1' : '0'}
        data-active-point-id={props.activePointId ?? ''}
        data-interactive={String(props.interactive ?? true)}
      />
    )
  },
}))
vi.mock('@/components/map/ResilientMapImage', async () => {
  const { getMapDisplayImageCandidates } = await import('@/lib/anitabi/imageProxy')
  // 渲染真实 img 节点：卡片挂载稳定性用例需要比较 DOM 引用。
  // src 按真实组件口径取候选梯首档（kind 透传），data-src 保留原始 src 供既有断言
  return {
    default: (props: {
      src: string | null
      alt: string
      kind?: 'cover' | 'point' | 'point-preview' | 'point-thumbnail' | 'default'
      fallbackSrc?: string | null
    }) => {
      const candidates = props.src ? getMapDisplayImageCandidates(props.src, { kind: props.kind }) : []
      return (
        <img
          data-testid="resilient-image"
          data-src={props.src ?? ''}
          src={candidates[0] ?? props.src ?? ''}
          alt={props.alt}
        />
      )
    },
  }
})

import { DayCards } from '@/app/(authed)/plan/[id]/components/DayCards'
import type { TripPlanItemView, TripPlanView } from '@/lib/tripPlan/view'
import { act } from '@testing-library/react'

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
    routeMapState.latestProps = null
    routeMapState.shouldThrow = false
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

  it('transit 行默认折叠为归并摘要，展开显示逐步导航、总计与 Google 地图链接', () => {
    renderDayCards()
    // 折叠摘要：walk + transit 两段归并（transit 段无时长则不显示分钟数）
    expect(screen.getByText('先步行 3 分钟，再乘车')).toBeInTheDocument()
    // 展开前不渲染逐步详情
    expect(screen.queryByText(/宇治駅 → 京都駅/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /先步行 3 分钟/ }))
    expect(screen.getByText('步行 3 分钟（200 m）')).toBeInTheDocument()
    expect(screen.getByText('乘 JR奈良线 · 宇治駅 → 京都駅 · 4 站')).toBeInTheDocument()
    expect(screen.getByText('总计 35 分钟 · 18.5 km')).toBeInTheDocument()
    // 无 mapsUrl：用前后条目坐标拼 Google 导航链接（宇治桥 → 迪士尼）
    const link = screen.getByRole('link', { name: '在 Google 地图打开' })
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=34.8892,135.8075&destination=35.6329,139.8804&travelmode=transit',
    )
  })

  it('estimated 兜底 transit 段：折叠显示"约 45 分钟 · 参考估算"，展开显示提示与 Google 地图外链', () => {
    const plan = makePlan()
    plan.days[0]!.items[1] = planItem({
      id: 'item-estimated-transit',
      type: 'transit',
      title: '新宿 → 河口湖',
      payload: {
        schedule: { start: '14:00', end: '14:45', confidence: 'estimated' },
        transport: {
          mode: 'transit',
          durationMin: 45,
          distanceKm: 20,
          estimated: true,
          provider: 'estimate',
          mapsUrl: 'https://www.google.com/maps/dir/?api=1&origin=35.69,139.7&destination=35.5,138.76&travelmode=transit',
        },
      },
    })
    renderDayCards(plan)
    expect(screen.getByText('约 45 分钟 · 参考估算')).toBeInTheDocument()
    // 链接收在展开态里
    expect(screen.queryByRole('link', { name: '在 Google 地图打开' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /约 45 分钟/ }))
    const link = screen.getByRole('link', { name: '在 Google 地图打开' })
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=35.69,139.7&destination=35.5,138.76&travelmode=transit',
    )
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    // 估算展开态给出当地实时查询提示；全页仅这一条 transit → 仅一个链接
    expect(screen.getByText('到达当地后可用 Google 地图 / Yahoo!乗換案内 查询实时路线')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '在 Google 地图打开' })).toHaveLength(1)
  })

  it('地图 tab：外部+站内点位都进地图；provider 折线优先（不请求通用路网）', async () => {
    const plan = makePlan()
    const transitPayload = plan.days[0].items[1].payload as Record<string, unknown>
    transitPayload.transport = {
      ...(transitPayload.transport as Record<string, unknown>),
      // polyline 是 [lat, lng]；首尾必须落在两端点上，否则不算这段的路线
      polyline: [
        [34.8892, 135.8075],
        [34.98, 135.76],
        [35.6329, 139.8804],
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
    const schematicLabel = await screen.findByText('参考路线（示意）')
    expect(schematicLabel).toBeInTheDocument()
    // M5：示意标注挪到左上第二行，避开右上缩放控件
    expect(schematicLabel.className).toContain('left-3')
    expect(schematicLabel.className).toContain('top-9')
    fetchSpy.mockRestore()
  })

  it('B1：非计序条目（free 等参考类条目）带媒体图时也渲染图片、无序号徽标；neighbor 来源显示极小"参考"角标', () => {
    const refPlan: TripPlanView = {
      ...makePlan(),
      days: [
        {
          id: 'day-ref',
          dayIndex: 1,
          date: null,
          citySlug: null,
          summary: null,
          items: [
            planItem({
              id: 'ref-1',
              type: 'free',
              title: '心斋桥一带',
              payload: {
                media: { source: 'google_places', displayUrl: '/api/google/place-photo?ref=freeABC' },
              },
            }),
            planItem({
              id: 'ref-2',
              type: 'free',
              title: '自由安排',
              payload: {
                media: { source: 'neighbor', displayUrl: '/api/anitabi/image-render/1', attribution: '宇治桥' },
              },
            }),
          ],
        },
      ],
    }
    const { container } = renderDayCards(refPlan)
    expect(container).toBeTruthy()
    // 非计序条目（free 类型）也渲染媒体图，不再被 isVisit 门槛挡住
    const srcs = screen.getAllByTestId('resilient-image').map((el) => el.getAttribute('data-src'))
    expect(srcs).toContain('/api/google/place-photo?ref=freeABC')
    expect(srcs).toContain('/api/anitabi/image-render/1')
    // free 条目不计序：无序号徽标
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    // neighbor 来源图带极小"参考"角标；google_places 来源不带（全页仅 1 个角标）
    const badges = screen.getAllByTitle('借用邻近条目的图片')
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveTextContent('参考')
  })

  it('R4：条目 id 全换（轮询拿到新计划）后同内容卡片不重挂载，img 节点引用不变', () => {
    const makeDays = (idPrefix: string): TripPlanView['days'] => [
      {
        id: `${idPrefix}-day-1`,
        dayIndex: 1,
        date: null,
        citySlug: null,
        summary: null,
        items: [
          planItem({
            id: `${idPrefix}-item-1`,
            type: 'point',
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
    ]
    const { container, rerender } = renderDayCards({ ...makePlan(), days: makeDays('a') })
    const before = container.querySelector('img')
    expect(before).not.toBeNull()

    // 模拟轮询：内容相同但 day/item 的 id 全换
    rerender(<DayCards planId="plan-1" days={makeDays('b')} scope="current" />)
    const after = container.querySelector('img')
    expect(after).toBe(before)
  })

  it('R4：站内点位无 image 时 src 直接用 /api/google/point-photo 兜底 URL', () => {
    // makePlan 的「宇治桥」：pointId=115908:uji、point.image=null
    renderDayCards()
    const srcs = screen.getAllByTestId('resilient-image').map((el) => el.getAttribute('data-src'))
    expect(srcs).toContain(`/api/google/point-photo?pointId=${encodeURIComponent('115908:uji')}&maxwidth=400`)
  })

  it('第六轮 B1：站内点位时间轴卡用缩略图变体——img src 解码后含 plan=h160（不含 h320）', () => {
    const plan = makePlan()
    plan.days[0]!.items[0] = planItem({
      id: 'item-thumb',
      type: 'point',
      pointId: '899:thumb',
      title: '缩略图点位',
      point: {
        id: '899:thumb',
        name: 'サムネ地点',
        nameZh: '缩略图点位',
        lat: 34.8892,
        lng: 135.8075,
        image: 'https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg',
      },
    })
    renderDayCards(plan)

    const img = screen.getByAltText('缩略图点位') as HTMLImageElement
    // E2 双重编码：解两层后断言变体参数
    const decoded = decodeURIComponent(decodeURIComponent(img.src))
    expect(decoded).toContain('/api/anitabi/image-render?url=')
    expect(decoded).toContain('plan=h160')
    expect(decoded).not.toContain('plan=h320')

    // Google 地点图（同源相对路径）不受影响：不进 anitabi 代理、不加 plan 参数
    const googleImg = screen.getByAltText('東京ディズニーランド') as HTMLImageElement
    const googleDecoded = decodeURIComponent(googleImg.src)
    expect(googleDecoded).toContain('/api/google/place-photo')
    expect(googleDecoded).not.toContain('plan=')
  })
})

describe('DayCards ↔ 地图联动（第十轮 B3）', () => {
  const UJI_KEY = 'point|115908:uji|宇治桥'

  it('列表条目带 data-point-id；点击条目 → data-active=true，切到地图 tab 后 RoutePreviewMap 收到 activePointId', async () => {
    const { container } = renderDayCards()
    const row = container.querySelector(`[data-point-id="${UJI_KEY}"]`)
    expect(row).not.toBeNull()

    fireEvent.click(row!)
    expect(row!.getAttribute('data-active')).toBe('true')

    fireEvent.click(screen.getByText('地图', { selector: 'button' }))
    await screen.findByTestId('route-map')
    expect(routeMapState.latestProps?.activePointId).toBe(UJI_KEY)
    // 地图点带与列表条目一致的 id
    const mapPoints = routeMapState.latestProps?.points ?? []
    expect(mapPoints.map((p) => p.id)).toContain(UJI_KEY)
  })

  it('M3 新语义：地图触发 onPointSelect(id) → 不切 tab（仍在地图），activePointId 传给 RoutePreviewMap', async () => {
    renderDayCards()
    fireEvent.click(screen.getByText('地图', { selector: 'button' }))
    await screen.findByTestId('route-map')
    expect(typeof routeMapState.latestProps?.onPointSelect).toBe('function')

    act(() => {
      routeMapState.latestProps?.onPointSelect?.(UJI_KEY)
    })
    // marker 点选不再把地图卸载：仍在地图 tab，高亮 id 已传下去
    expect(screen.getByTestId('route-map')).toBeInTheDocument()
    expect(routeMapState.latestProps?.activePointId).toBe(UJI_KEY)
  })

  it('L16：可点选条目键盘可达——role=button、tabIndex=0，Enter/Space 触发同 onClick', () => {
    const { container } = renderDayCards()
    const row = container.querySelector(`[data-point-id="${UJI_KEY}"]`)!
    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('tabindex')).toBe('0')

    fireEvent.keyDown(row, { key: 'Enter' })
    expect(row.getAttribute('data-active')).toBe('true')

    // Space 同样触发（另一条目验证）
    const disneyRow = container.querySelector('[data-point-id="point||東京ディズニーランド"]')!
    fireEvent.keyDown(disneyRow, { key: ' ' })
    expect(disneyRow.getAttribute('data-active')).toBe('true')
    // 其它键不触发
    fireEvent.keyDown(disneyRow, { key: 'ArrowDown' })
  })

  it('M3 新语义：条目行尾「在地图上看」→ 切到地图 tab 且 activePointId 为该条目', async () => {
    renderDayCards()
    fireEvent.click(screen.getByRole('button', { name: '在地图上看：宇治桥' }))

    await screen.findByTestId('route-map')
    expect(routeMapState.latestProps?.activePointId).toBe(UJI_KEY)
  })

  it('L17：高亮环 1.5 秒后自动清除；闪烁中卸载不残留定时器', async () => {
    vi.useFakeTimers()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, geometry: { type: 'LineString', coordinates: [[135.8, 34.89], [139.88, 35.63]] } })))
    try {
      const { container, unmount } = renderDayCards()
      fireEvent.click(screen.getByText('地图', { selector: 'button' }))
      // mock 的 RoutePreviewMap 同步渲染，直接可取 renderPopup
      const renderPopup = routeMapState.latestProps?.renderPopup
      expect(typeof renderPopup).toBe('function')
      // Popup 内容由 React portal 渲染，需在 act 内触发才会同步落到容器
      let popupEl!: HTMLElement
      act(() => {
        popupEl = renderPopup!(UJI_KEY)!
      })
      const button = Array.from(popupEl.querySelectorAll('button')).find((el) => el.textContent === '查看条目')!
      act(() => {
        button.click()
      })
      const row = container.querySelector(`[data-point-id="${UJI_KEY}"]`)!
      expect(row.className).toContain('ring-rose-400')

      // 1.5 秒定时器到点后高亮环清除
      act(() => {
        vi.advanceTimersByTime(1600)
      })
      expect(row.className).not.toContain('ring-rose-400')

      // 再次触发后闪烁中卸载：清定时器，不抛错。
      // 第一次「查看条目」已切回列表 → 地图与 Popup 卡片随之卸载，需重新开一次
      fireEvent.click(screen.getByText('地图', { selector: 'button' }))
      let popupAgain!: HTMLElement
      act(() => {
        popupAgain = routeMapState.latestProps!.renderPopup!(UJI_KEY)!
      })
      act(() => {
        Array.from(popupAgain.querySelectorAll('button')).find((el) => el.textContent === '查看条目')!.click()
      })
      expect(container.querySelector(`[data-point-id="${UJI_KEY}"]`)!.className).toContain('ring-rose-400')
      unmount()
      act(() => {
        vi.advanceTimersByTime(2000)
      })
    } finally {
      fetchSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('M3 新语义：Popup「查看条目」回调 → 切回列表，对应条目 data-active=true 且带高亮环 class', async () => {
    const { container } = renderDayCards()
    fireEvent.click(screen.getByText('地图', { selector: 'button' }))
    await screen.findByTestId('route-map')
    const renderPopup = routeMapState.latestProps?.renderPopup
    expect(typeof renderPopup).toBe('function')

    let popupEl!: HTMLElement | null
    act(() => {
      popupEl = renderPopup!(UJI_KEY)
    })
    expect(popupEl).not.toBeNull()
    expect(popupEl!.textContent).toContain('宇治桥')
    const button = Array.from(popupEl!.querySelectorAll('button')).find((el) => el.textContent === '查看条目')
    expect(button).toBeTruthy()
    act(() => {
      button!.click()
    })

    // 切回列表：地图卸载，对应条目高亮并带 1.5 秒高亮环
    expect(screen.queryByTestId('route-map')).toBeNull()
    const row = container.querySelector(`[data-point-id="${UJI_KEY}"]`)
    expect(row).not.toBeNull()
    expect(row!.getAttribute('data-active')).toBe('true')
    expect(row!.className).toContain('ring-rose-400')
  })

  it('B3：renderPopup 返回的容器里是点位卡——封面图、标题、时间 chip 与三个动作', async () => {
    renderDayCards()
    fireEvent.click(screen.getByText('地图', { selector: 'button' }))
    await screen.findByTestId('route-map')
    const renderPopup = routeMapState.latestProps?.renderPopup
    let popupEl!: HTMLElement | null
    act(() => {
      popupEl = renderPopup!(UJI_KEY)
    })
    expect(popupEl).not.toBeNull()
    // 标题 + 与列表同源的时间 chip（reference 档也照常展示区间）
    expect(popupEl!.textContent).toContain('宇治桥')
    expect(popupEl!.textContent).toContain('13:00–14:00')
    // 站内点位无 point.image → /api/google/point-photo 兜底作为候选梯首档
    const img = popupEl!.querySelector('[data-testid="resilient-image"]')
    expect(img?.getAttribute('data-src')).toContain('/api/google/point-photo?pointId=115908%3Auji')
    // 三个动作齐备
    expect(Array.from(popupEl!.querySelectorAll('button')).some((el) => el.textContent === '查看条目')).toBe(true)
    const hrefs = Array.from(popupEl!.querySelectorAll('a')).map((el) => el.getAttribute('href') ?? '')
    expect(hrefs.some((href) => href.includes('google.com/maps/dir/'))).toBe(true)
    expect(hrefs.some((href) => href.includes('map_action=pano&viewpoint=34.889200,135.807500'))).toBe(true)
  })

  it('地图"展开"按钮 → 全屏 role=dialog（内部地图全交互），Esc 关闭', async () => {
    renderDayCards()
    fireEvent.click(screen.getByText('地图', { selector: 'button' }))
    await screen.findByTestId('route-map')

    const expandButton = screen.getByRole('button', { name: '展开' })
    // M5：「展开」移到右下，避开右上角的 ± 缩放控件
    expect(expandButton.className).toContain('right-3')
    expect(expandButton.className).toContain('bottom-3')
    expect(expandButton.className).not.toContain('top-3')
    fireEvent.click(expandButton)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    // 展开态内部地图是全交互（interactive=true 的 RoutePreviewMap）
    expect(routeMapState.latestProps?.interactive).toBe(true)

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('L13：打开展开态焦点移到关闭按钮，关闭后还原到「展开」按钮；dialog 带 aria-modal 与 aria-label', async () => {
    renderDayCards()
    fireEvent.click(screen.getByText('地图', { selector: 'button' }))
    await screen.findByTestId('route-map')

    const expandButton = screen.getByRole('button', { name: '展开' })
    expandButton.focus()
    fireEvent.click(expandButton)

    const dialog = await screen.findByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('第 1 天 · 路线')
    // 打开后焦点在关闭按钮上
    const closeButton = screen.getByRole('button', { name: '关闭' })
    expect(document.activeElement).toBe(closeButton)

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    // 关闭后焦点还原到触发元素
    expect(document.activeElement).toBe(expandButton)
  })

  it('第十轮：RoutePreviewMap 渲染抛错时错误边界只丢地图——DayCards 之外的兄弟内容与 tab 切换不受影响', async () => {
    routeMapState.shouldThrow = true
    // React 捕获边界错误时会向 console.error 打日志，用例里静音避免噪音
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <div>
          <div data-testid="chat-sibling">聊天时间线其它消息</div>
          <DayCards planId="plan-1" days={makePlan().days} scope="current" />
        </div>,
      )

      fireEvent.click(screen.getByText('地图', { selector: 'button' }))

      // 地图区域降级为占位（与 WebGL 占位同款文案）
      expect(await screen.findByText('地图暂不可用（浏览器不支持 WebGL）')).toBeInTheDocument()
      // DayCards 之外的兄弟内容不受影响（不再整树卸载）
      expect(screen.getByTestId('chat-sibling')).toBeInTheDocument()
      // DayCards 自身未卸载：切回列表 tab 后时间线条目照常渲染
      fireEvent.click(screen.getByText('列表', { selector: 'button' }))
      expect(await screen.findByText('宇治桥')).toBeInTheDocument()
      expect(screen.getByText('13:00–14:00')).toBeInTheDocument()
    } finally {
      routeMapState.shouldThrow = false
      consoleErrorSpy.mockRestore()
    }
  })
})
