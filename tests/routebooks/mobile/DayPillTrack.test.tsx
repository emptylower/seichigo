import { describe, it, expect, vi, beforeAll } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DayPillTrack } from '@/app/(authed)/me/routebooks/[id]/components/mobile/DayPillTrack'
import type { DayRecord } from '@/app/(authed)/me/routebooks/[id]/types'

const DAYS: DayRecord[] = [
  { id: 'day1', routeBookId: 'rb1', dayIndex: 1, date: null, title: null, defaultTravelMode: 'transit' },
  { id: 'day2', routeBookId: 'rb1', dayIndex: 2, date: null, title: null, defaultTravelMode: 'transit' },
  { id: 'day3', routeBookId: 'rb1', dayIndex: 3, date: '2026-09-12T00:00:00.000Z', title: null, defaultTravelMode: 'transit' },
]

beforeAll(() => {
  // jsdom 没有 scrollIntoView（选中胶囊自动滚入视野会调用）
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
})

function renderTrack(overrides: Partial<Parameters<typeof DayPillTrack>[0]> = {}) {
  const props = {
    days: DAYS,
    selectedDayId: null as string | null,
    unassignedSelected: false,
    unassignedCount: 2,
    onSelectDay: vi.fn(),
    onShowAll: vi.fn(),
    onShowUnassigned: vi.fn(),
    locale: 'zh' as const,
    ...overrides,
  }
  const view = render(<DayPillTrack {...props} />)
  return { props, ...view }
}

describe('DayPillTrack', () => {
  it('点击 Day 胶囊回调对应 dayId', () => {
    const { props } = renderTrack()
    fireEvent.click(screen.getByRole('tab', { name: 'Day 2' }))
    expect(props.onSelectDay).toHaveBeenCalledWith('day2')
  })

  it('「全部」胶囊回调 onShowAll（selectedDayId → null 语义）', () => {
    const { props } = renderTrack({ selectedDayId: 'day1' })
    fireEvent.click(screen.getByRole('tab', { name: '全部' }))
    expect(props.onShowAll).toHaveBeenCalledTimes(1)
    expect(props.onSelectDay).not.toHaveBeenCalled()
  })

  it('「未安排」胶囊回调 onShowUnassigned 并显示条数', () => {
    const { props } = renderTrack()
    const pill = screen.getByRole('tab', { name: /未安排/ })
    expect(pill.textContent).toContain('2')
    fireEvent.click(pill)
    expect(props.onShowUnassigned).toHaveBeenCalledTimes(1)
  })

  it('选中态 aria-selected：选中天 / 全部 / 未安排 互斥', () => {
    const { rerender, props } = renderTrack({ selectedDayId: 'day1' })
    expect(screen.getByRole('tab', { name: 'Day 1' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '全部' }).getAttribute('aria-selected')).toBe('false')

    rerender(<DayPillTrack {...props} selectedDayId={null} unassignedSelected />)
    expect(screen.getByRole('tab', { name: '全部' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tab', { name: /未安排/ }).getAttribute('aria-selected')).toBe('true')

    rerender(<DayPillTrack {...props} selectedDayId={null} unassignedSelected={false} />)
    expect(screen.getByRole('tab', { name: '全部' }).getAttribute('aria-selected')).toBe('true')
  })

  it('有日期时胶囊显示日期片段（Day 3 · 9/12）', () => {
    renderTrack()
    expect(screen.getByRole('tab', { name: /Day 3 · 9\/12/ })).toBeTruthy()
  })
})
