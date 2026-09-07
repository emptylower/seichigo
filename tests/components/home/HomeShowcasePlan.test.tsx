import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import HomeShowcasePlan from '@/components/home/HomeShowcasePlan'
import type { HomeShowcase } from '@/lib/home/types'
import type { TripPlanItemView, TripPlanDayView } from '@/lib/tripPlan/view'

/** 3 天 fixture：point/transit/meal/lodging 都有；有的条目有 schedule.start，有的没有；date 全为 null */
function item(overrides: Partial<TripPlanItemView> & { id: string }): TripPlanItemView {
  return {
    sortOrder: 0,
    type: 'point',
    pointId: null,
    timeHint: null,
    title: '',
    note: null,
    reason: null,
    payload: null,
    point: null,
    ...overrides,
  } as TripPlanItemView
}

function point(id: string, title: string, sortOrder: number, start?: string): TripPlanItemView {
  return item({
    id,
    title,
    sortOrder,
    type: 'point',
    pointId: id,
    point: { id, name: title, nameZh: title, lat: 35.7, lng: 139.7, image: null },
    ...(start ? { payload: { schedule: { start, end: start, confidence: 'explicit' } } } : {}),
  })
}

function transit(id: string, sortOrder: number, transport: { mode: string; durationMin: number; distanceKm?: number } | null): TripPlanItemView {
  return item({
    id,
    sortOrder,
    type: 'transit',
    title: `TRANSIT隐藏标题-${id}`,
    ...(transport ? { payload: { transport } } : {}),
  })
}

function showcaseFixture(): HomeShowcase {
  const day1: TripPlanDayView = {
    id: 'd1',
    dayIndex: 1,
    date: null,
    citySlug: 'tokyo',
    summary: '新宿御苑与须贺神社',
    items: [
      point('p1', '你的名字・须贺神社男坂', 0, '09:00'),
      transit('t1', 1, { mode: 'walk', durationMin: 8, distanceKm: 0.6 }),
      point('p2', '你的名字・四谷见附桥', 2),
      transit('t2', 3, null),
      point('p3', '言叶之庭・新宿御苑 新宿门', 4, '11:30'),
      item({
        id: 'm1',
        sortOrder: 5,
        type: 'meal',
        title: '午餐：CRUZ BURGERS',
        note: '手工汉堡',
        payload: { media: { displayUrl: '/images/showcase/m1.jpg', attribution: '照片：Kenji' } },
      }),
      point('p4', '天气之子・歌舞伎町一番街入口', 6),
      point('p5', '天气之子・麦当劳西武新宿站前店4F', 7),
      // 第 7 张卡片：折叠进「还有 n 项」
      point('p6', '言叶之庭・旧御凉亭', 8),
    ],
  }
  const day2: TripPlanDayView = {
    id: 'd2',
    dayIndex: 2,
    date: null,
    citySlug: 'kyoto',
    summary: '京都一日',
    items: [
      point('p7', '孤独摇滚・下北泽站', 0, '10:00'),
      item({ id: 'l1', sortOrder: 1, type: 'lodging', title: '住宿：京都站前酒店' }),
    ],
  }
  const day3: TripPlanDayView = {
    id: 'd3',
    dayIndex: 3,
    date: null,
    citySlug: 'osaka',
    summary: '大阪一日',
    items: [point('p8', '言叶之庭・大阪城公园', 0)],
  }
  return {
    revisionId: 'rev-1',
    savedAt: '2026-09-01T08:30:00Z',
    title: '东京 8 日巡礼｜天气之子×你的名字×言叶之庭×孤独摇滚 巡礼',
    summary: '',
    days: [day1, day2, day3],
  }
}

describe('HomeShowcasePlan（第三屏重做）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('顶部：粉色小字 + 带 accent 的两行大标题 + 副标题', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    expect(screen.getByText('定制专属巡礼行程')).toBeInTheDocument()
    // <br> 在无障碍名称里是 \n
    expect(screen.getByRole('heading', { name: /从出发到回程，\s*每一天都是/ })).toBeInTheDocument()
    expect(screen.getByText('精心规划')).toHaveClass('text-brand-600')
    expect(screen.getByText('说出作品和假期，规划师排好每天的点位、交通与餐厅。')).toBeInTheDocument()
  })

  it('行程概览卡：标题截「｜」之前、天数与城市来自真实数据、作品名从点位标题提取、住宿去前缀', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    // 「｜」之后的部分不出现
    expect(screen.queryByText(/天气之子×你的名字×言叶之庭×孤独摇滚 巡礼/)).toBeNull()
    // 概览标题 + 大图压字两处都是「东京 8 日巡礼」
    expect(screen.getAllByText('东京 8 日巡礼').length).toBe(2)
    expect(screen.getByText('3 天 · 东京 · 京都 · 大阪')).toBeInTheDocument()
    // 作品胶囊（点位标题「・」之前，最多 4 个）
    expect(screen.getByText('你的名字')).toBeInTheDocument()
    expect(screen.getByText('孤独摇滚')).toBeInTheDocument()
    // 概览四行小项目
    expect(screen.getByText('巡礼点位')).toBeInTheDocument()
    expect(screen.getByText('8 处')).toBeInTheDocument()
    expect(screen.getByText('你的名字、言叶之庭、天气之子、孤独摇滚')).toBeInTheDocument()
    expect(screen.getByText('京都站前酒店')).toBeInTheDocument()
    expect(screen.getByText('3 天 · 规划师生成')).toBeInTheDocument()
  })

  it('Day 标签数量 = 天数；date 为 null 时胶囊没有第二行（不编日期）', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    expect(screen.getByRole('button', { name: 'Day 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Day 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Day 3' })).toBeInTheDocument()
    expect(screen.queryByText(/\d{2}-\d{2}/)).toBeNull()
  })

  it('时间轴：有 schedule.start 显示时间、没有就不显示；transit 是极小灰字行而不是卡片', () => {
    const { container } = render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    expect(screen.getByText('09:00')).toBeInTheDocument()
    expect(screen.getByText('11:30')).toBeInTheDocument()
    // transit 只出一行交通小字，条目标题绝不渲染成卡片
    expect(screen.getByText('步行 8 分钟 · 0.6 km')).toBeInTheDocument()
    expect(screen.getByText('→')).toBeInTheDocument()
    expect(container.textContent).not.toContain('TRANSIT隐藏标题')
    // 没有「已预订」「已确认」这类暗示站内下单的字样，也没有天气
    expect(container.textContent).not.toContain('已预订')
    expect(container.textContent).not.toContain('已确认')
  })

  it('每天最多 6 张卡片，第 7 项起折叠成「还有 1 项 · 查看完整行程」', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    expect(screen.getByText('天气之子・麦当劳西武新宿站前店4F')).toBeInTheDocument()
    expect(screen.queryByText('言叶之庭・旧御凉亭')).toBeNull()
    expect(screen.getByRole('link', { name: /还有 1 项 · 查看完整行程/ })).toHaveAttribute('href', '/plan/start')
  })

  it('条目卡：缩略图 + 标题 + note + 类型胶囊（meal→美食推荐），Google 照片署名保留', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    expect(screen.getByText('午餐：CRUZ BURGERS')).toBeInTheDocument()
    expect(screen.getByText('手工汉堡')).toBeInTheDocument()
    expect(screen.getByText('美食推荐')).toBeInTheDocument()
    expect(screen.getByText('照片：Kenji')).toBeInTheDocument()
    // point 卡片右侧胶囊是「圣地」
    expect(screen.getAllByText('圣地').length).toBeGreaterThan(0)
  })

  it('CTA：概览卡「用规划师做一份我的」与「查看完整行程」都指向规划师起始页', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    expect(screen.getByRole('link', { name: /用规划师做一份我的/ })).toHaveAttribute('href', '/plan/start')
    expect(screen.getAllByRole('link', { name: '查看完整行程' })[0]).toHaveAttribute('href', '/plan/start')
  })

  it('Day 标签每 5 秒自动轮播，用户点过后停止', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    expect(screen.getByText('新宿御苑与须贺神社')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('京都一日')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Day 3' }))
    expect(screen.getByText('大阪一日')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(20000)
    })
    expect(screen.getByText('大阪一日')).toBeInTheDocument()
  })

  it('en：标题 accent、CTA 带 ?locale=en，交通小行英文化', () => {
    render(<HomeShowcasePlan locale="en" showcase={showcaseFixture()} />)

    expect(screen.getByText('carefully planned')).toHaveClass('text-brand-600')
    expect(screen.getByRole('link', { name: /Plan mine with the planner/ })).toHaveAttribute(
      'href',
      '/plan/start?locale=en',
    )
    expect(screen.getByText('Walk 8 min · 0.6 km')).toBeInTheDocument()
    expect(screen.getByText('3 days · Tokyo · Kyoto · Osaka')).toBeInTheDocument()
  })
})
