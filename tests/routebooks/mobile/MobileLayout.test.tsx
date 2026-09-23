import { beforeAll, describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MobileLayout } from '@/app/(authed)/me/routebooks/[id]/components/MobileLayout'
import { useTripDnd } from '@/app/(authed)/me/routebooks/[id]/hooks/useTripDnd'
import type { useTripData } from '@/app/(authed)/me/routebooks/[id]/hooks/useTripData'
import type { DialogsHostApi } from '@/app/(authed)/me/routebooks/[id]/components/DialogsHost'
import type {
  DayRecord,
  ItemRecord,
  PlaceRecord,
  PointPoolItem,
  RouteBookDetail,
} from '@/app/(authed)/me/routebooks/[id]/types'

beforeAll(() => {
  // jsdom 没有 scrollIntoView（选中胶囊自动滚入视野会调用）
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
})

const DAYS: DayRecord[] = [
  { id: 'day1', routeBookId: 'rb1', dayIndex: 1, date: null, title: null, defaultTravelMode: 'transit' },
  { id: 'day2', routeBookId: 'rb1', dayIndex: 2, date: null, title: null, defaultTravelMode: 'transit' },
]

const PLACE: PlaceRecord = {
  id: 'place-1',
  routeBookId: 'rb1',
  kind: 'restaurant',
  title: 'Uji Tea House',
  address: null,
  lat: 34.88,
  lng: 135.8,
  note: null,
  createdAt: '2026-09-23T00:00:00.000Z',
}

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
  items: [makeItem({ id: 'item-1' }), makeItem({ id: 'item-u', dayId: null, pointId: '115908:uji-shrine' })],
  places: [PLACE],
  lodgings: [],
}

const POOL: PointPoolItem[] = [
  { id: 'pool-1', pointId: '115908:pool-spot', createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z' },
]

function getPointPreview(pointId: string) {
  return {
    title: pointId === '115908:pool-spot' ? 'Pool Spot' : pointId === '115908:uji-shrine' ? 'Uji Shrine' : 'Uji Bridge',
    subtitle: 'Haruhi Suzumiya',
    image: null,
    geo: [34.8892, 135.8075] as [number, number],
  }
}

function makeTrip() {
  return {
    getPointPreview,
    addItem: vi.fn(async () => 'new-id'),
    updateItem: vi.fn(async () => true),
    deleteItem: vi.fn(async () => true),
    optimizeDay: vi.fn(async () => true),
    updateDay: vi.fn(async () => true),
    removeFromPool: vi.fn(async () => true),
    deletePlace: vi.fn(async () => true),
  }
}

function makeDialogs() {
  return {
    openPlaceEditor: vi.fn(),
    openLodgingEditor: vi.fn(),
    openNoteEditor: vi.fn(),
    openDayOrder: vi.fn(),
    host: null,
  }
}

function Harness({
  trip,
  dialogs,
  initialDayId = 'day1',
  detailCard = null,
}: {
  trip: ReturnType<typeof makeTrip>
  dialogs: ReturnType<typeof makeDialogs>
  initialDayId?: string | null
  detailCard?: React.ReactNode
}) {
  // 与 ui.tsx 相同：selectedDayId 在上层，移动端胶囊用非切换的 setSelectedDayId
  const [selectedDayId, setSelectedDayId] = useState<string | null>(initialDayId)
  const dnd = useTripDnd({
    items: DETAIL.items,
    pointPoolItems: POOL,
    reorder: async () => true,
    addItem: async () => null,
  })
  const selectedDay = DAYS.find((day) => day.id === selectedDayId) ?? null
  return (
    <MobileLayout
      header={null}
      detail={DETAIL}
      days={DAYS}
      selectedDay={selectedDay}
      selectedDayId={selectedDayId}
      onSelectDay={(dayId) => setSelectedDayId(dayId)}
      onShowAll={() => setSelectedDayId(null)}
      mapStage={<div data-testid="map-stage">{selectedDayId ?? 'all'}</div>}
      detailCard={detailCard}
      poolItems={POOL}
      dragOverlay={null}
      dnd={dnd}
      legsByDay={{}}
      legsFailedByDay={{}}
      onRetryLegs={() => {}}
      trip={trip as unknown as ReturnType<typeof useTripData>}
      dialogs={dialogs as unknown as DialogsHostApi}
      canStart
      startLabel="开始 Day 1"
      needsDayPick={false}
      onOpenDayPicker={() => {}}
      onStartImmersive={() => {}}
      onOpenItemDetail={() => {}}
      onMoveItem={() => {}}
      onEditNote={() => {}}
      locale="zh"
    />
  )
}

function setup(props: Partial<Parameters<typeof Harness>[0]> = {}) {
  const trip = makeTrip()
  const dialogs = makeDialogs()
  const view = render(<Harness trip={trip} dialogs={dialogs} {...props} />)
  return { trip, dialogs, ...view }
}

function poolSheet() {
  return screen.getByRole('dialog', { hidden: true, name: '点位池' })
}

function addFromPool() {
  fireEvent.click(screen.getByRole('button', { name: /^点位池$/ }))
  fireEvent.click(within(poolSheet()).getByRole('button', { name: '加入当前地图' }))
}

describe('MobileLayout「未安排」视图状态（B3 修复 F2）', () => {
  it('进入未安排：清掉选中天（地图不残留旧天），池加点进未安排，sheet 显示「加到 未安排」', () => {
    const { trip } = setup()
    expect(screen.getByTestId('map-stage').textContent).toBe('day1')

    fireEvent.click(screen.getByRole('tab', { name: /未安排/ }))
    expect(screen.getByTestId('map-stage').textContent).toBe('all')
    expect(screen.getByRole('tab', { name: /未安排/ }).getAttribute('aria-selected')).toBe('true')

    addFromPool()
    expect(within(poolSheet()).getByText('加到 未安排')).toBeTruthy()
    expect(trip.addItem).toHaveBeenCalledWith(null, { kind: 'point', pointId: '115908:pool-spot' })
  })

  it('从未安排点 Day 2：进入 Day 2，池加点进 Day 2', () => {
    const { trip } = setup()
    fireEvent.click(screen.getByRole('tab', { name: /未安排/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Day 2' }))
    expect(screen.getByTestId('map-stage').textContent).toBe('day2')
    expect(screen.getByRole('tab', { name: /未安排/ }).getAttribute('aria-selected')).toBe('false')

    addFromPool()
    expect(within(poolSheet()).getByText('加到 Day 2')).toBeTruthy()
    expect(trip.addItem).toHaveBeenCalledWith('day2', { kind: 'point', pointId: '115908:pool-spot' })
  })

  it('胶囊是 tab 语义：再点已选中的天保持选中，「全部」才清空', () => {
    setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Day 1' }))
    expect(screen.getByRole('tab', { name: 'Day 1' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('map-stage').textContent).toBe('day1')
    fireEvent.click(screen.getByRole('tab', { name: '全部' }))
    expect(screen.getByTestId('map-stage').textContent).toBe('all')
  })
})

describe('MobileLayout 视图与抽屉（B3 修复 F4/F6/F8）', () => {
  it('切换 计划/地图 不卸载地图（非活动视图 hidden）', () => {
    setup()
    const stage = screen.getByTestId('map-stage')
    expect(screen.getByTestId('mobile-map-view').className).toContain('hidden')
    fireEvent.click(screen.getByRole('button', { name: '地图' }))
    expect(screen.getByTestId('mobile-map-view').className).not.toContain('hidden')
    expect(screen.getByTestId('mobile-plan-view').className).toContain('hidden')
    fireEvent.click(screen.getByRole('button', { name: '计划' }))
    expect(screen.getByTestId('map-stage')).toBe(stage)
  })

  it('点位详情卡在计划 tab 下也以底部抽屉渲染', () => {
    setup({ detailCard: <aside aria-label="detail-card">card</aside> })
    const drawer = screen.getByTestId('mobile-detail-drawer')
    expect(within(drawer).getByLabelText('detail-card')).toBeTruthy()
    expect(screen.getByTestId('mobile-plan-view').className).not.toContain('hidden')
  })

  it('点位池 sheet：自定义点分区加入/新建/编辑，点位可从池中移除', () => {
    const { trip, dialogs } = setup()
    fireEvent.click(screen.getByRole('button', { name: /^点位池$/ }))
    const sheet = poolSheet()
    expect(within(sheet).getByText('Uji Tea House')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: '加入选中天' }))
    expect(trip.addItem).toHaveBeenCalledWith('day1', { kind: 'place', placeId: 'place-1' })
    fireEvent.click(within(sheet).getByRole('button', { name: '添加自定义点' }))
    expect(dialogs.openPlaceEditor).toHaveBeenCalledWith()
    fireEvent.click(within(sheet).getByRole('button', { name: '编辑自定义点' }))
    expect(dialogs.openPlaceEditor).toHaveBeenCalledWith({ placeId: 'place-1' })
    fireEvent.click(within(sheet).getByRole('button', { name: '从点位池删除' }))
    expect(trip.removeFromPool).toHaveBeenCalledWith('115908:pool-spot')
  })

  it('天摘要住宿抽屉里「添加住宿」打开 LodgingDialog（预设当天）', () => {
    const { dialogs } = setup()
    fireEvent.click(screen.getByRole('button', { name: '当天住宿' }))
    fireEvent.click(screen.getByRole('button', { name: '添加住宿' }))
    expect(dialogs.openLodgingEditor).toHaveBeenCalledWith({ presetDayIndex: 1 })
  })
})
