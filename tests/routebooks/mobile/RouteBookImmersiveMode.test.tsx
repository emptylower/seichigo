import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RouteBookImmersiveMode } from '@/app/(authed)/me/routebooks/[id]/components/RouteBookImmersiveMode'
import type { ItemRecord, PlaceRecord } from '@/app/(authed)/me/routebooks/[id]/types'

const PLACE: PlaceRecord = {
  id: 'place-1',
  routeBookId: 'rb1',
  kind: 'restaurant',
  title: 'Uji Tea House',
  address: 'Uji, Kyoto',
  lat: 34.8892,
  lng: 135.8075,
  note: null,
  createdAt: '2026-09-23T00:00:00.000Z',
}

function makeItem(overrides: Partial<ItemRecord>): ItemRecord {
  return {
    id: 'item-1',
    routeBookId: 'rb1',
    dayId: 'day1',
    sortOrder: 0,
    kind: 'place',
    pointId: null,
    placeId: 'place-1',
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

function getPointPreview() {
  return {
    title: 'Uji Bridge',
    subtitle: 'Haruhi Suzumiya',
    image: null,
    geo: [34.8892, 135.8075] as [number, number],
  }
}

function renderImmersive(overrides: Partial<Parameters<typeof RouteBookImmersiveMode>[0]> = {}) {
  const props = {
    routeBookTitle: 'Test Trip',
    sequence: [makeItem({ id: 'item-place' })],
    places: [PLACE],
    dayLabel: 'Day 1',
    checkedInPointIds: new Set<string>(),
    getPointPreview,
    onCheckInSuccess: vi.fn(),
    onUndoCheckIn: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
    locale: 'zh' as const,
    ...overrides,
  }
  const view = render(<RouteBookImmersiveMode {...props} />)
  return { props, ...view }
}

/** intro → cards 进入首站 */
function enterCards() {
  fireEvent.click(screen.getByRole('button', { name: /进入导航/ }))
}

describe('RouteBookImmersiveMode place 条目', () => {
  it('place 站导航态不显示打卡按钮，显示「到达 · 下一站」', () => {
    renderImmersive()
    enterCards()
    // 首站是 place：点「导航」进入导航态
    fireEvent.click(screen.getByRole('button', { name: '导航' }))
    expect(screen.queryByRole('button', { name: '导航完成并打卡' })).toBeNull()
    expect(screen.getByRole('button', { name: '到达 · 下一站' })).toBeTruthy()
  })

  it('point 站导航态仍显示打卡按钮', () => {
    renderImmersive({
      sequence: [makeItem({ id: 'item-point', kind: 'point', pointId: '115908:uji-bridge', placeId: null })],
    })
    enterCards()
    fireEvent.click(screen.getByRole('button', { name: '导航' }))
    expect(screen.getByRole('button', { name: '导航完成并打卡' })).toBeTruthy()
  })
})

describe('RouteBookImmersiveMode 最后一站完成', () => {
  it('有下一天：总结文案含下一天首站名（明天从 X 开始）', () => {
    renderImmersive({ nextDayFirstTitle: '宇治上神社' })
    enterCards()
    // 最后一站是 place → 「完成今天」
    fireEvent.click(screen.getByRole('button', { name: '完成今天' }))
    expect(screen.getByText('Day 1 完成')).toBeTruthy()
    expect(screen.getByText('明天从 宇治上神社 开始')).toBeTruthy()
  })

  it('没有下一天：显示「全部完成」', () => {
    renderImmersive({ nextDayFirstTitle: null })
    enterCards()
    fireEvent.click(screen.getByRole('button', { name: '完成今天' }))
    expect(screen.getByText('全部完成')).toBeTruthy()
  })
})
