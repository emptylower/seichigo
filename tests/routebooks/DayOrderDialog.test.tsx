import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  DayOrderDialog,
  insertOrderAfter,
  mergeDayOrder,
} from '@/app/(authed)/me/routebooks/[id]/components/DayOrderDialog'
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
  const view = render(<DayOrderDialog {...props} />)
  return { props, ...view }
}

describe('DayOrderDialog', () => {
  it('提交当前顺序的 orderedDayIds', async () => {
    const { props } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '保存顺序' }))
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1))
    expect(props.onSubmit).toHaveBeenCalledWith(['day1', 'day2', 'day3'])
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  })

  it('「+」在该天下方插入一天（onInsertDay 传可视位置）', () => {
    const { props } = renderDialog()
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

  it('服务端顺序变了也保留本地已拖顺序，插入仍按可视位置', async () => {
    // 模拟「本地已拖成 day1,day2,day3，但服务端 dayIndex 已变成 d2:1,d3:2,d1:3」
    const { props, rerender } = renderDialog()
    const reordered: DayRecord[] = [
      { ...DAYS[0]!, dayIndex: 3 },
      { ...DAYS[1]!, dayIndex: 1 },
      { ...DAYS[2]!, dayIndex: 2 },
    ]
    rerender(<DayOrderDialog {...props} days={reordered} />)

    // day2 在可视第 2 位（index 1）→ afterVisualIndex = 2；若误用服务端 dayIndex 会是 1
    const insertButtons = screen.getAllByRole('button', { name: '在下方插入一天' })
    fireEvent.click(insertButtons[1]!)
    expect(props.onInsertDay).toHaveBeenCalledWith(2)
  })

  it('插入返回新天 id：插到可视位置、弹窗保持打开、提交顺序含新天', async () => {
    const onInsertDay = vi.fn().mockResolvedValue('day4')
    const onSubmit = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()
    const { props, rerender } = renderDialog({ onInsertDay, onSubmit, onClose })

    const insertButtons = screen.getAllByRole('button', { name: '在下方插入一天' })
    fireEvent.click(insertButtons[1]!) // day2 下方
    await waitFor(() => expect(onInsertDay).toHaveBeenCalledWith(2))

    // 弹窗仍在（未触发 onClose / 未卸载）
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('调整天顺序')).toBeTruthy()

    // 父组件把新天合入 days（本地更新，不整页重载）
    const withNew: DayRecord[] = [
      ...DAYS,
      { id: 'day4', routeBookId: 'rb1', dayIndex: 3, date: null, title: null, defaultTravelMode: 'transit' },
    ]
    rerender(<DayOrderDialog {...props} onInsertDay={onInsertDay} onSubmit={onSubmit} onClose={onClose} days={withNew} />)

    fireEvent.click(screen.getByRole('button', { name: '保存顺序' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    // 新天落在 day2 与 day3 之间（可视位置），而不是追加到末尾
    expect(onSubmit).toHaveBeenCalledWith(['day1', 'day2', 'day4', 'day3'])
  })
})

describe('mergeDayOrder', () => {
  it('空本地顺序直接用服务端顺序', () => {
    expect(mergeDayOrder([], ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('保留本地顺序、剔除已删除、追加新增', () => {
    expect(mergeDayOrder(['b', 'a', 'gone'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })
})

describe('insertOrderAfter', () => {
  it('插到锚点下一位', () => {
    expect(insertOrderAfter(['a', 'b', 'c'], 'b', 'x')).toEqual(['a', 'b', 'x', 'c'])
  })

  it('newId 已存在则先挪走再插入（与 merge 追加竞态收敛）', () => {
    expect(insertOrderAfter(['a', 'b', 'c', 'x'], 'b', 'x')).toEqual(['a', 'b', 'x', 'c'])
  })

  it('锚点不存在时追加到末尾', () => {
    expect(insertOrderAfter(['a'], 'missing', 'x')).toEqual(['a', 'x'])
  })
})
