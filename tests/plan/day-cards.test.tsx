import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TripPlanItemView, TripPlanView } from '@/lib/tripPlan/view'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// RoutePreviewMap 内部会实例化 maplibre-gl（需要 WebGL），jsdom 下替换为空组件
vi.mock('@/components/route/RoutePreviewMap', () => ({
  RoutePreviewMap: (props: { interactive?: boolean }) => (
    <div data-testid="route-preview-map" data-interactive={String(props.interactive ?? true)} />
  ),
}))

import { DayCards } from '@/app/(authed)/plan/[id]/components/DayCards'

function makeItem(partial: Partial<TripPlanItemView>): TripPlanItemView {
  return {
    id: partial.id ?? `item-${Math.random().toString(36).slice(2)}`,
    sortOrder: partial.sortOrder ?? 0,
    type: partial.type ?? 'point',
    pointId: partial.pointId ?? null,
    timeHint: partial.timeHint ?? null,
    title: partial.title ?? '点位',
    note: partial.note ?? null,
    reason: partial.reason ?? null,
    payload: partial.payload ?? null,
    point: partial.point ?? null,
  }
}

const plan: TripPlanView = {
  id: 'plan-1',
  title: '京都京吹圣地巡礼',
  status: 'draft',
  startDate: null,
  dayCount: 2,
  bangumiIds: [115908],
  updatedAt: new Date().toISOString(),
  days: [
    {
      id: 'day-1',
      dayIndex: 1,
      date: null,
      citySlug: 'kyoto',
      summary: '宇治巡礼日',
      items: [
        {
          id: 'item-1',
          sortOrder: 0,
          type: 'point',
          pointId: 'p1',
          timeHint: '上午',
          title: '宇治桥',
          note: null,
          reason: '第 1 集开场取景地',
          payload: null,
          point: { id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, image: null },
        },
        {
          id: 'item-2',
          sortOrder: 1,
          type: 'transit',
          pointId: null,
          timeHint: null,
          title: 'JR 奈良线',
          note: '约 20 分钟',
          reason: null,
          payload: null,
          point: null,
        },
      ],
    },
    { id: 'day-2', dayIndex: 2, date: null, citySlug: null, summary: null, items: [] },
  ],
}

function renderDayCards(overrides?: { days?: TripPlanView['days'] }) {
  return render(
    <DayCards planId="plan-1" days={overrides?.days ?? plan.days} scope="current" />,
  )
}

describe('DayCards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).fetch = vi.fn()
  })

  it('renders day tabs and items with reason', () => {
    renderDayCards()
    expect(screen.getByText('Day 1')).toBeTruthy()
    expect(screen.getByText('Day 2')).toBeTruthy()
    expect(screen.getByText('宇治桥')).toBeTruthy()
    expect(screen.getByText('第 1 集开场取景地')).toBeTruthy()
    // transit 无 payload 时兜底渲染 title/note
    expect(screen.getByText(/JR 奈良线/)).toBeTruthy()
  })

  it('shows empty state when plan has no days', () => {
    renderDayCards({ days: [] })
    expect(screen.getByText(/还没有行程/)).toBeTruthy()
  })

  it('点位卡片渲染图片、序号徽标、时间 chip 与简介', async () => {
    const items: TripPlanItemView[] = [
      makeItem({
        id: 'i1',
        type: 'point',
        title: '清水寺',
        timeHint: '上午',
        reason: '经典取景地',
        point: { id: 'p-a', name: 'Point A', nameZh: null, lat: 35.0, lng: 135.7, image: 'https://example.com/a.jpg' },
      }),
      makeItem({ id: 'i2', type: 'point', title: '宇治桥', note: '桥头场景' }),
    ]
    const { container } = renderDayCards({ days: [{ ...plan.days[0]!, items }] })

    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    // 点位图走 ResilientMapImage（kind=point → 强制站内 image-render 代理候选）；
    // img 在调度器异步分配请求槽后才出现，用 findBy 等待
    const img = await screen.findByAltText('清水寺')
    expect(img.getAttribute('src')).toContain('/api/anitabi/image-render')
    expect(img.getAttribute('src')).toContain(encodeURIComponent('https://example.com/a.jpg'))
    // M3 修订：历史数据（无 schedule）也不再只显示宽泛词"上午"，
    // 而是推导出具体时钟区间（上午 → 09:00 参考时刻）+ 参考标注
    expect(screen.getByText('09:00–10:00')).toBeTruthy()
    expect(screen.queryByText('上午')).toBeNull()
    expect(screen.getByText('经典取景地')).toBeTruthy()
    // 无 reason 时回退 note
    expect(screen.getByText('桥头场景')).toBeTruthy()
  })

  it('无图点位渲染渐变占位（无 img 元素）', () => {
    const items = [makeItem({ id: 'i1', type: 'point', title: '无图点位' })]
    const { container } = renderDayCards({ days: [{ ...plan.days[0]!, items }] })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.bg-gradient-to-br')).toBeTruthy()
  })

  it('transit 条目用结构化 payload 渲染连接段，且不占用序号', () => {
    const items: TripPlanItemView[] = [
      makeItem({ id: 'i1', type: 'point', title: 'A 点' }),
      makeItem({
        id: 't1',
        type: 'transit',
        title: '不应展示的标题',
        payload: { mode: 'walk', durationMin: 8, distanceKm: 0.65 },
      }),
      makeItem({ id: 'i2', type: 'point', title: 'B 点' }),
    ]
    renderDayCards({ days: [{ ...plan.days[0]!, items }] })

    expect(screen.getByText('步行 8 分钟 · 650m')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.queryByText('3')).toBeNull()
  })

  it('>1km 的距离以 km 保留 1 位小数展示', () => {
    const items: TripPlanItemView[] = [
      makeItem({ id: 'i1', type: 'point', title: 'A 点' }),
      makeItem({
        id: 't1',
        type: 'transit',
        title: 'x',
        payload: { mode: 'transit', durationMin: 25, distanceKm: 3.26 },
      }),
      makeItem({ id: 'i2', type: 'point', title: 'B 点' }),
    ]
    renderDayCards({ days: [{ ...plan.days[0]!, items }] })
    expect(screen.getByText('乘车 25 分钟 · 3.3km')).toBeTruthy()
  })
})
