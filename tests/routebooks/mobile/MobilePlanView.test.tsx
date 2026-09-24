import { afterEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MobilePlanView } from '@/app/(authed)/me/routebooks/[id]/components/mobile/MobilePlanView'
import type { DayRecord, ItemRecord, RouteBookDetail } from '@/app/(authed)/me/routebooks/[id]/types'

const DAYS: DayRecord[] = [
  { id: 'day1', routeBookId: 'rb1', dayIndex: 1, date: null, title: null, defaultTravelMode: 'transit' },
  { id: 'day2', routeBookId: 'rb1', dayIndex: 2, date: null, title: null, defaultTravelMode: 'transit' },
]

function makeItem(overrides: Partial<ItemRecord>): ItemRecord {
  return {
    id: 'item-1',
    routeBookId: 'rb1',
    dayId: 'day1',
    sortOrder: 0,
    kind: 'point',
    pointId: '115908:uji-bridge',
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

const DETAIL: RouteBookDetail = {
  id: 'rb1',
  title: 'Test Trip',
  status: 'in_progress',
  metadata: null,
  startDate: null,
  dayCount: 2,
  createdAt: '2026-09-23T00:00:00.000Z',
  updatedAt: '2026-09-23T00:00:00.000Z',
  days: DAYS,
  items: [makeItem({ id: 'item-1', sortOrder: 0 }), makeItem({ id: 'item-2', sortOrder: 1, pointId: '115908:uji-shrine' })],
  places: [],
  lodgings: [],
}

function getPointPreview(pointId: string) {
  return {
    title: pointId === '115908:uji-shrine' ? 'Uji Shrine' : 'Uji Bridge',
    subtitle: 'Haruhi Suzumiya',
    image: null,
    geo: [34.8892, 135.8075] as [number, number],
  }
}

function renderView(overrides: Partial<Parameters<typeof MobilePlanView>[0]> = {}) {
  const props = {
    mode: 'day' as const,
    detail: DETAIL,
    days: DAYS,
    day: DAYS[0]!,
    items: DETAIL.items.filter((row) => row.dayId === 'day1'),
    getPointPreview,
    onUpdateItem: vi.fn(),
    onDeleteItem: vi.fn(),
    onMoveItem: vi.fn(),
    locale: 'zh' as const,
    ...overrides,
  }
  const view = render(<MobilePlanView {...props} />)
  return { props, ...view }
}

/** jsdom 无 PointerEvent 构造器，fireEvent.pointer* 会丢坐标/类型字段，手工构造再派发 */
function pointerEvent(type: string, init: Record<string, unknown>) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, init)
  return event
}

/** 在指定条目卡上模拟一次左滑（touch pointer，dx=-140px） */
function swipeLeft(cardText: string) {
  const card = screen.getByText(cardText)
  const base = { pointerType: 'touch', pointerId: 1, isPrimary: true }
  fireEvent(card, pointerEvent('pointerdown', { ...base, clientX: 300, clientY: 100 }))
  fireEvent(card, pointerEvent('pointermove', { ...base, clientX: 220, clientY: 102 }))
  fireEvent(card, pointerEvent('pointermove', { ...base, clientX: 160, clientY: 103 }))
  fireEvent(card, pointerEvent('pointerup', { ...base, clientX: 160, clientY: 103 }))
}

describe('MobilePlanView 左滑操作', () => {
  it('左滑 ≥80px 露出「移到… / 移除」，短滑不露出', () => {
    const { container } = renderView()
    const wrappers = container.querySelectorAll('[data-testid="swipeable-item"]')
    expect(wrappers.length).toBe(2)

    // 短滑（-40px）：操作区保持 aria-hidden
    const shortCard = screen.getByText('Uji Shrine')
    const base = { pointerType: 'touch', pointerId: 2, isPrimary: true }
    fireEvent(shortCard, pointerEvent('pointerdown', { ...base, clientX: 300, clientY: 300 }))
    fireEvent(shortCard, pointerEvent('pointermove', { ...base, clientX: 260, clientY: 301 }))
    fireEvent(shortCard, pointerEvent('pointerup', { ...base, clientX: 260, clientY: 301 }))
    expect(wrappers[1]!.querySelector('[aria-hidden="true"]')).toBeTruthy()

    // 长滑（-140px > 80px 阈值）：露出操作
    swipeLeft('Uji Bridge')
    const actions = wrappers[0]!.querySelector('[aria-hidden="false"]')
    expect(actions).toBeTruthy()
    expect(within(wrappers[0] as HTMLElement).getByRole('button', { name: /移到…/ })).toBeTruthy()
    expect(within(wrappers[0] as HTMLElement).getByRole('button', { name: '移除' })).toBeTruthy()
  })

  it('「移到…」菜单选目标天调 onMoveItem(itemId, targetDayId)；当前天禁用', () => {
    const { props } = renderView()
    swipeLeft('Uji Bridge')

    // 打开移到…底部 sheet
    const wrapper = screen.getByText('Uji Bridge').closest('[data-testid="swipeable-item"]') as HTMLElement
    fireEvent.click(within(wrapper).getByRole('button', { name: /移到…/ }))

    // 底部 sheet：Day 1 是当前天（禁用），Day 2 可移
    expect(screen.getByRole('button', { name: 'Day 1' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Day 2' }))
    expect(props.onMoveItem).toHaveBeenCalledWith('item-1', 'day2')
  })

  it('「移除」调 onDeleteItem', () => {
    const { props } = renderView()
    swipeLeft('Uji Bridge')
    const wrapper = screen.getByText('Uji Bridge').closest('[data-testid="swipeable-item"]') as HTMLElement
    fireEvent.click(within(wrapper).getByRole('button', { name: '移除' }))
    expect(props.onDeleteItem).toHaveBeenCalledWith('item-1')
  })
})

describe('MobilePlanView 「全部」模式', () => {
  it('显示各天摘要，点击进入该天', () => {
    const onEnterDay = vi.fn()
    render(
      <MobilePlanView
        mode="all"
        detail={DETAIL}
        days={DAYS}
        items={[]}
        getPointPreview={getPointPreview}
        onUpdateItem={() => {}}
        onDeleteItem={() => {}}
        onMoveItem={() => {}}
        onEnterDay={onEnterDay}
        locale="zh"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Day 2/ }))
    expect(onEnterDay).toHaveBeenCalledWith('day2')
  })
})

describe('MobilePlanView 未安排模式', () => {
  it('渲染未安排条目并可左滑移到某天', () => {
    const unassigned = [makeItem({ id: 'item-9', dayId: null, sortOrder: 0 })]
    const { props, container } = renderView({
      mode: 'unassigned',
      day: null,
      items: unassigned,
    })
    expect(container.textContent).toContain('未安排')
    swipeLeft('Uji Bridge')
    const wrapper = screen.getByText('Uji Bridge').closest('[data-testid="swipeable-item"]') as HTMLElement
    fireEvent.click(within(wrapper).getByRole('button', { name: /移到…/ }))
    // 「未安排」选项对未安排条目禁用
    expect(screen.getByRole('button', { name: '未安排' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Day 1' }))
    expect(props.onMoveItem).toHaveBeenCalledWith('item-9', 'day1')
  })
})

describe('MobilePlanView 长按与左滑（B3 修复）', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('按住超过 200ms 再横移：视为长按拖拽，不展开左滑操作', () => {
    vi.useFakeTimers()
    const { container } = renderView()
    const card = screen.getByText('Uji Bridge')
    const base = { pointerType: 'touch', pointerId: 5, isPrimary: true }
    fireEvent(card, pointerEvent('pointerdown', { ...base, clientX: 300, clientY: 100 }))
    vi.advanceTimersByTime(250)
    fireEvent(card, pointerEvent('pointermove', { ...base, clientX: 200, clientY: 101 }))
    fireEvent(card, pointerEvent('pointermove', { ...base, clientX: 140, clientY: 101 }))
    fireEvent(card, pointerEvent('pointerup', { ...base, clientX: 140, clientY: 101 }))
    const wrapper = container.querySelectorAll('[data-testid="swipeable-item"]')[0] as HTMLElement
    expect(wrapper.getAttribute('data-open')).toBe('false')
  })

  it('200ms 内横移：判定为左滑并展开', () => {
    vi.useFakeTimers()
    const { container } = renderView()
    const card = screen.getByText('Uji Bridge')
    const base = { pointerType: 'touch', pointerId: 6, isPrimary: true }
    fireEvent(card, pointerEvent('pointerdown', { ...base, clientX: 300, clientY: 100 }))
    vi.advanceTimersByTime(50)
    fireEvent(card, pointerEvent('pointermove', { ...base, clientX: 220, clientY: 101 }))
    fireEvent(card, pointerEvent('pointermove', { ...base, clientX: 150, clientY: 101 }))
    fireEvent(card, pointerEvent('pointerup', { ...base, clientX: 150, clientY: 101 }))
    const wrapper = container.querySelectorAll('[data-testid="swipeable-item"]')[0] as HTMLElement
    expect(wrapper.getAttribute('data-open')).toBe('true')
  })

  it('内容层声明 touch-action: pan-y；拖动中关闭过渡动画', () => {
    const { container } = renderView()
    const content = container.querySelector('[data-testid="swipeable-content"]') as HTMLElement
    expect(content.style.touchAction).toBe('pan-y')
    expect(content.className).toContain('transition-transform')
    const base = { pointerType: 'touch', pointerId: 7, isPrimary: true }
    fireEvent(content, pointerEvent('pointerdown', { ...base, clientX: 300, clientY: 100 }))
    fireEvent(content, pointerEvent('pointermove', { ...base, clientX: 250, clientY: 100 }))
    expect(content.className).not.toContain('transition-transform')
  })

  it('同一时间只允许一行展开；展开后可反向滑回收起', () => {
    const { container } = renderView()
    const wrappers = container.querySelectorAll('[data-testid="swipeable-item"]')
    swipeLeft('Uji Bridge')
    expect(wrappers[0]!.getAttribute('data-open')).toBe('true')
    swipeLeft('Uji Shrine')
    expect(wrappers[0]!.getAttribute('data-open')).toBe('false')
    expect(wrappers[1]!.getAttribute('data-open')).toBe('true')

    // 反向滑回（+140px）：展开行收起（没有遮罩拦截 pointer 事件）
    const card = screen.getByText('Uji Shrine')
    const base = { pointerType: 'touch', pointerId: 8, isPrimary: true }
    fireEvent(card, pointerEvent('pointerdown', { ...base, clientX: 100, clientY: 100 }))
    fireEvent(card, pointerEvent('pointermove', { ...base, clientX: 180, clientY: 101 }))
    fireEvent(card, pointerEvent('pointermove', { ...base, clientX: 240, clientY: 101 }))
    fireEvent(card, pointerEvent('pointerup', { ...base, clientX: 240, clientY: 101 }))
    expect(wrappers[1]!.getAttribute('data-open')).toBe('false')
  })

  it('移动端条目不渲染悬停操作条', () => {
    renderView()
    expect(screen.queryByRole('button', { name: '设时间' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: '移到…' })).toBeNull()
  })
})
