import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DayOrderDialog } from '@/app/(authed)/me/routebooks/[id]/components/DayOrderDialog'
import type { DayRecord } from '@/app/(authed)/me/routebooks/[id]/types'

const DAYS: DayRecord[] = [
  { id: 'day1', routeBookId: 'rb1', dayIndex: 1, date: null, title: null, defaultTravelMode: 'transit' },
  { id: 'day2', routeBookId: 'rb1', dayIndex: 2, date: null, title: null, defaultTravelMode: 'transit' },
  { id: 'day3', routeBookId: 'rb1', dayIndex: 3, date: null, title: null, defaultTravelMode: 'transit' },
]

function renderDialog(overrides: Partial<Parameters<typeof DayOrderDialog>[0]> = {}) {
  const props = {
    open: true,
    days: DAYS,
    itemCountByDay: { day1: 3, day2: 0, day3: 1 },
    onSubmit: vi.fn().mockResolvedValue(true),
    onInsertDay: vi.fn(),
    onDeleteDay: vi.fn(),
    onClose: vi.fn(),
    locale: 'zh' as const,
    ...overrides,
  }
  render(<DayOrderDialog {...props} />)
  return props
}

describe('DayOrderDialog', () => {
  it('提交当前顺序的 orderedDayIds', async () => {
    const props = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '保存顺序' }))
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1))
    expect(props.onSubmit).toHaveBeenCalledWith(['day1', 'day2', 'day3'])
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  })

  it('「+」在该天下方插入一天（onInsertDay 传当前 dayIndex）', () => {
    const props = renderDialog()
    const insertButtons = screen.getAllByRole('button', { name: '在下方插入一天' })
    fireEvent.click(insertButtons[1]!)
    expect(props.onInsertDay).toHaveBeenCalledWith(2)
  })

  it('空天可删、非空天与最后一天不可删', () => {
    renderDialog()
    const deleteButtons = screen.getAllByRole('button', { name: '删除' })
    expect(deleteButtons[0]).toBeDisabled()
    expect(deleteButtons[1]).not.toBeDisabled()
    expect(deleteButtons[2]).toBeDisabled()
  })
})
