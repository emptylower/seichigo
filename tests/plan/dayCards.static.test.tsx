import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
// DayMap 走 next/dynamic 懒加载；这里只关心地图 tab 的行为，换成同步实现
vi.mock('next/dynamic', async () => (await import('./helpers/nextDynamicSync')).syncDynamicMock())

const routeMapState = vi.hoisted(() => ({
  latestProps: null as null | { routeGeometry: unknown; points: Array<{ id?: string }> },
}))
vi.mock('@/components/route/RoutePreviewMap', () => ({
  RoutePreviewMap: (props: NonNullable<typeof routeMapState.latestProps>) => {
    routeMapState.latestProps = props
    return <div data-testid="route-map" />
  },
}))
vi.mock('@/components/map/ResilientMapImage', () => ({
  default: (props: { src: string | null; alt: string; fallbackSrc?: string | null }) => (
    <div
      data-testid="resilient-image"
      data-src={props.src ?? ''}
      data-fallback={props.fallbackSrc ?? ''}
      aria-label={props.alt}
    />
  ),
}))

import { DayCards } from '@/app/(authed)/plan/[id]/components/DayCards'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

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
    payload: { schedule: { start, end: start, confidence: 'explicit' } },
    point: { id, name: title, nameZh: title, lat: at.lat, lng: at.lng, image: null },
  } as TripPlanItemView
}

function days(): TripPlanDayView[] {
  return [
    {
      id: 'd1',
      dayIndex: 1,
      date: null,
      citySlug: null,
      summary: null,
      items: [
        pointItem('p1', '须贺神社', { lat: 35.6866, lng: 139.7288 }, '09:00'),
        pointItem('p2', '代代木会馆', { lat: 35.6905, lng: 139.7005 }, '11:00'),
      ],
    },
  ]
}

/** 每条都带媒体图的一天：用来断言静态模式的原生 img 与 eager/lazy 分档 */
function mediaDays(count: number): TripPlanDayView[] {
  return [
    {
      id: 'd1',
      dayIndex: 1,
      date: null,
      citySlug: null,
      summary: null,
      items: Array.from({ length: count }, (_, i) => ({
        ...pointItem(`m${i}`, `点位 ${i}`, { lat: 35 + i * 0.01, lng: 139 + i * 0.01 }, `0${i}:00`),
        payload: {
          schedule: { start: `0${i}:00`, end: `0${i}:00`, confidence: 'explicit' },
          media: { source: 'google_places', displayUrl: `/images/showcase/${i}.jpg` },
        },
      })) as TripPlanItemView[],
    },
  ]
}

describe('DayCards static（首页展示计划的只读渲染）', () => {
  beforeEach(() => {
    routeMapState.latestProps = null
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  })

  it('不显示保存/调整入口，也不显示快照标签', () => {
    render(<DayCards planId="home-showcase" days={days()} scope="snapshot" static />)

    expect(screen.queryByRole('button', { name: '保存到我的地图' })).toBeNull()
    expect(screen.queryByText('历史快照 · 只读')).toBeNull()
    expect(screen.queryByText(/交给规划师调整/)).toBeNull()
  })

  it('不预取路网；切到地图 tab 也不请求路线（直接画直线）', () => {
    render(<DayCards planId="home-showcase" days={days()} static />)
    expect(globalThis.fetch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '地图' }))

    expect(screen.getByTestId('route-map')).toBeInTheDocument()
    expect(routeMapState.latestProps?.routeGeometry).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('高-3：静态与常规模式都渲染 media.attribution（Google 照片要求可见署名）', () => {
    const withAttribution: TripPlanDayView[] = [
      {
        ...days()[0]!,
        items: [
          {
            ...days()[0]!.items[0]!,
            payload: {
              schedule: { start: '09:00', end: '09:00', confidence: 'explicit' },
              media: { source: 'google_places', displayUrl: '/api/google/place-photo?ref=X', attribution: '照片：Hanako' },
            },
          } as TripPlanItemView,
        ],
      },
    ]
    const staticView = render(<DayCards planId="home-showcase" days={withAttribution} static />)
    expect(screen.getByText('照片：Hanako')).toBeInTheDocument()
    staticView.unmount()

    render(<DayCards planId="plan-1" days={withAttribution} />)
    expect(screen.getByText('照片：Hanako')).toBeInTheDocument()
  })

  it('不使用需要登录的 /api/google/point-photo 兜底', () => {
    render(<DayCards planId="home-showcase" days={days()} static />)

    const images = screen.queryAllByTestId('resilient-image')
    for (const img of images) {
      expect(img.getAttribute('data-src') ?? '').not.toContain('/api/google/point-photo')
      expect(img.getAttribute('data-fallback') ?? '').not.toContain('/api/google/point-photo')
    }
    expect(document.body.innerHTML).not.toContain('/api/google/point-photo')
  })

  it('保留导航外链', () => {
    render(<DayCards planId="home-showcase" days={days()} static />)

    const navLinks = screen.getAllByRole('link', { name: /导航/ })
    expect(navLinks.length).toBeGreaterThan(0)
    for (const link of navLinks) {
      expect(link.getAttribute('href') ?? '').toContain('google.com/maps')
    }
  })

  it('静态模式用原生 img（固定宽高、decoding=async），不走 ResilientMapImage', () => {
    render(<DayCards planId="home-showcase" days={mediaDays(3)} static />)

    expect(screen.queryAllByTestId('resilient-image')).toHaveLength(0)
    const imgs = [...document.querySelectorAll('img')]
    expect(imgs).toHaveLength(3)
    for (const img of imgs) {
      expect(img.getAttribute('width')).toBe('96')
      expect(img.getAttribute('height')).toBe('96')
      expect(img.getAttribute('decoding')).toBe('async')
    }
  })

  it('静态模式下无 media 的点位图走公开代理，绝不直连 image.anitabi.cn（403）', () => {
    const anitabiDays: TripPlanDayView[] = [
      {
        ...days()[0]!,
        items: [
          {
            ...days()[0]!.items[0]!,
            point: {
              id: 'p1',
              name: '须贺神社',
              nameZh: '须贺神社',
              lat: 35.6866,
              lng: 139.7288,
              image: 'https://image.anitabi.cn/points/1234/abc.jpg?plan=h160',
            },
          } as TripPlanItemView,
        ],
      },
    ]
    render(<DayCards planId="home-showcase" days={anitabiDays} static />)

    const img = document.querySelector('img')
    const src = img?.getAttribute('src') ?? ''
    expect(src).toContain('/api/anitabi/image-render')
    expect(src.startsWith('https://image.anitabi.cn')).toBe(false)
  })

  it('当前 Day 前 6 张 eager，其余 lazy（第二屏首帧直接出图）', () => {
    render(<DayCards planId="home-showcase" days={mediaDays(8)} static />)

    const loading = [...document.querySelectorAll('img')].map((img) => img.getAttribute('loading'))
    expect(loading).toEqual(['eager', 'eager', 'eager', 'eager', 'eager', 'eager', 'lazy', 'lazy'])
  })

  it('非 static 的缩略图仍走 ResilientMapImage（既有行为不变）', () => {
    render(<DayCards planId="plan-1" days={mediaDays(2)} />)

    expect(screen.getAllByTestId('resilient-image')).toHaveLength(2)
  })

  it('非 static 仍保留 point-photo 兜底与保存入口（既有行为不变）', () => {
    render(<DayCards planId="plan-1" days={days()} />)

    expect(screen.getByRole('button', { name: '保存到我的地图' })).toBeInTheDocument()
    expect(document.body.innerHTML).toContain('/api/google/point-photo')
  })
})
