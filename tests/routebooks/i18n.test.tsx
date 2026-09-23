import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { DayPlanSidebar } from '@/app/(authed)/me/routebooks/[id]/components/DayPlanSidebar'
import { PointDetailCard } from '@/app/(authed)/me/routebooks/[id]/components/PointDetailCard'
import type {
  ItemRecord,
  PlaceRecord,
  RouteBookDetail,
} from '@/app/(authed)/me/routebooks/[id]/types'

const CJK = /[぀-ヿ㐀-鿿]/

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
  title: 'Tokyo Pilgrimage',
  status: 'in_progress',
  metadata: null,
  startDate: null,
  dayCount: 2,
  createdAt: '2026-09-23T00:00:00.000Z',
  updatedAt: '2026-09-23T00:00:00.000Z',
  days: [
    { id: 'day1', routeBookId: 'rb1', dayIndex: 1, date: null, title: 'Uji loop', defaultTravelMode: 'transit' },
    { id: 'day2', routeBookId: 'rb1', dayIndex: 2, date: null, title: null, defaultTravelMode: 'walking' },
  ],
  items: [
    makeItem({ id: 'item-1', sortOrder: 0 }),
    makeItem({ id: 'item-2', sortOrder: 1, kind: 'place', pointId: null, placeId: 'place-1' }),
    makeItem({ id: 'item-3', sortOrder: 2, kind: 'note', pointId: null, title: 'Lunch break', icon: 'info', color: 'gray' }),
    makeItem({ id: 'item-4', sortOrder: 3, kind: 'transit', pointId: null, title: 'JR line', payload: { transport: { durationMin: 22 } } }),
    makeItem({ id: 'item-5', dayId: null, sortOrder: 0 }),
  ],
  places: [
    {
      id: 'place-1',
      routeBookId: 'rb1',
      kind: 'restaurant',
      title: 'Uji Tea House',
      address: 'Uji, Kyoto',
      lat: 34.8892,
      lng: 135.8075,
      note: null,
      createdAt: '2026-09-23T00:00:00.000Z',
    } as PlaceRecord,
  ],
  lodgings: [],
}

function getPointPreview() {
  return {
    title: 'Uji Bridge',
    subtitle: 'Haruhi Suzumiya',
    image: null,
    geo: [34.8892, 135.8075] as [number, number],
  }
}

describe('routebook 详情页 i18n', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('DayPlanSidebar 用 locale=en 渲染不出现 CJK', () => {
    const { container } = render(
      <DayPlanSidebar
        detail={DETAIL}
        selectedDayId="day1"
        onSelectDay={() => {}}
        onShowAll={() => {}}
        getPointPreview={getPointPreview}
        legsByDay={{}}
        routeVisible
        onToggleRoute={() => {}}
        onOptimize={() => {}}
        onUndo={() => {}}
        undoLabel={null}
        onAddItem={() => {}}
        onUpdateItem={() => {}}
        onDeleteItem={() => {}}
        onReorder={() => {}}
        onUpdateDay={() => {}}
        onInsertDay={() => {}}
        onDeleteDay={() => {}}
        locale="en"
      />
    )
    expect(CJK.test(container.textContent ?? '')).toBe(false)
    expect(CJK.test(container.innerHTML)).toBe(false)
    // 单天徽标 = 游览顺序（时间线 seq 徽章）
    expect(screen.getAllByText('Uji Bridge').length).toBeGreaterThan(0)
  })

  it('PointDetailCard 用 locale=en 渲染不出现 CJK（point 条目）', () => {
    const { container } = render(
      <PointDetailCard
        routeBookId="rb1"
        item={makeItem({ id: 'item-1' })}
        preview={getPointPreview()}
        place={null}
        days={DETAIL.days}
        lang="en"
        locale="en"
        onClose={() => {}}
        onDelete={() => {}}
        onMoveItem={() => {}}
      />
    )
    expect(CJK.test(container.textContent ?? '')).toBe(false)
    expect(CJK.test(container.innerHTML)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('PointDetailCard 用 locale=en 渲染不出现 CJK（place 条目 + 404 介绍）', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: 'no intro' }) } as Response)
    const { container, findByText } = render(
      <PointDetailCard
        routeBookId="rb1"
        item={makeItem({ id: 'item-2', kind: 'place', pointId: null, placeId: 'place-1' })}
        preview={null}
        place={DETAIL.places[0] ?? null}
        days={DETAIL.days}
        lang="en"
        locale="en"
        onClose={() => {}}
        onDelete={() => {}}
        onMoveItem={() => {}}
      />
    )
    await findByText('No Google info yet')
    expect(CJK.test(container.textContent ?? '')).toBe(false)
    expect(CJK.test(container.innerHTML)).toBe(false)
  })
})

describe('LanguageSwitcher 无前缀路径', () => {
  const pushMock = vi.fn()
  const refreshMock = vi.fn()

  beforeEach(() => {
    pushMock.mockReset()
    refreshMock.mockReset()
    vi.resetModules()
    vi.doMock('next/navigation', () => ({
      usePathname: () => '/me/routebooks',
      useRouter: () => ({ push: pushMock, refresh: refreshMock }),
    }))
  })

  afterEach(() => {
    vi.doUnmock('next/navigation')
  })

  it('/me 下切语言：URL 不变 → router.refresh 而不是 push', async () => {
    const { default: LanguageSwitcher } = await import('@/components/LanguageSwitcher')
    render(<LanguageSwitcher locale="zh" />)
    act(() => {
      screen.getByText('English').click()
    })
    // cookie 已写；无前缀路径 push 目标等于当前 pathname，所以走 refresh
    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
    expect(document.cookie).toContain('NEXT_LOCALE=en')
  })
})
