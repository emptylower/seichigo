import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PlannerPointPoolPanel } from '@/app/(authed)/me/routebooks/[id]/components/PlannerPointPoolPanel'
import type { ItemRecord, PlaceRecord, RouteBookDetail } from '@/app/(authed)/me/routebooks/[id]/types'

function makePlace(): PlaceRecord {
  return {
    id: 'place-1',
    routeBookId: 'rb1',
    kind: 'restaurant',
    title: '宇治川茶屋',
    address: '京都府宇治市',
    lat: 34.8892,
    lng: 135.8075,
    note: null,
    createdAt: '2026-09-23T00:00:00.000Z',
  }
}

function makeItem(id: string, placeId: string | null): ItemRecord {
  return {
    id,
    routeBookId: 'rb1',
    dayId: 'day1',
    sortOrder: 0,
    kind: 'place',
    pointId: null,
    placeId,
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
  }
}

function makeDetail(): RouteBookDetail {
  return {
    id: 'rb1',
    title: '测试行程',
    status: 'draft',
    metadata: null,
    startDate: null,
    dayCount: 2,
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
    days: [
      { id: 'day1', routeBookId: 'rb1', dayIndex: 1, date: null, title: null, defaultTravelMode: 'transit' },
      { id: 'day2', routeBookId: 'rb1', dayIndex: 2, date: null, title: null, defaultTravelMode: 'transit' },
    ],
    items: [makeItem('item-1', 'place-1'), makeItem('item-2', 'place-1'), makeItem('item-3', null)],
    places: [makePlace()],
    lodgings: [
      {
        id: 'lod1',
        routeBookId: 'rb1',
        placeId: 'place-1',
        fromDayIndex: 1,
        toDayIndex: 2,
        checkIn: null,
        checkOut: null,
        note: null,
      },
    ],
  }
}

function renderPanel(overrides: { onDeletePlace?: (placeId: string) => void } = {}) {
  const props = {
    detail: makeDetail(),
    pointPoolItems: [],
    selectedDayId: 'day1' as string | null,
    getPointPreview: () => ({ title: 'P', subtitle: 'S', image: null, geo: null }),
    onAddItem: vi.fn(),
    onReorder: vi.fn(),
    onFocusPoint: vi.fn(),
    onRemoveFromPool: vi.fn(),
    onCreatePlace: vi.fn(),
    onEditPlace: vi.fn(),
    onDeletePlace: overrides.onDeletePlace ?? vi.fn(),
    locale: 'zh' as const,
  }
  render(<PlannerPointPoolPanel {...props} />)
  return props
}

describe('PlannerPointPoolPanel 删除自定义点确认', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('点删除先弹确认，文案列出级联删除的 2 条条目与 1 段住宿', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { onDeletePlace } = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '删除自定义点' }))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const message = String(confirmSpy.mock.calls[0]![0])
    expect(message).toContain('宇治川茶屋')
    expect(message).toContain('2')
    expect(message).toContain('1')
    // 取消 → 不删
    expect(onDeletePlace).not.toHaveBeenCalled()
  })

  it('确认后才调 onDeletePlace', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onDeletePlace } = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '删除自定义点' }))

    expect(onDeletePlace).toHaveBeenCalledTimes(1)
    expect(onDeletePlace).toHaveBeenCalledWith('place-1')
  })
})
