import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NoteEditorDialog } from '@/app/(authed)/me/routebooks/[id]/components/NoteEditorDialog'
import type { ItemRecord } from '@/app/(authed)/me/routebooks/[id]/types'

function makeNoteItem(overrides: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'note-1',
    routeBookId: 'rb1',
    dayId: 'day1',
    sortOrder: 0,
    kind: 'note',
    pointId: null,
    placeId: null,
    title: '集合地点',
    note: '站前广场雕像下',
    timeStart: '09:30',
    timeEnd: null,
    locked: false,
    icon: 'camera',
    color: 'sky',
    legMode: null,
    payload: null,
    createdAt: '2026-09-23T00:00:00.000Z',
    ...overrides,
  }
}

describe('NoteEditorDialog', () => {
  it('提交 onSubmit：标题/详情/图标/颜色/时间', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(<NoteEditorDialog open dayLabelText="Day 2" onSubmit={onSubmit} onClose={() => {}} locale="zh" />)

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '集合地点' } })
    fireEvent.change(screen.getByLabelText('详情（可选）'), { target: { value: '站前广场雕像下' } })
    fireEvent.click(screen.getByRole('button', { name: '拍照' }))
    fireEvent.click(screen.getByRole('button', { name: '天蓝' }))
    fireEvent.change(screen.getByLabelText('时间（可选）'), { target: { value: '09:30' } })
    fireEvent.click(screen.getByRole('button', { name: '添加备注' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({
      title: '集合地点',
      note: '站前广场雕像下',
      icon: 'camera',
      color: 'sky',
      timeStart: '09:30',
    })
  })

  it('默认图标 info / 颜色 gray，空详情与时间提交为 null', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(<NoteEditorDialog open onSubmit={onSubmit} onClose={() => {}} locale="zh" />)

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '记得带护照' } })
    fireEvent.click(screen.getByRole('button', { name: '添加备注' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({
      title: '记得带护照',
      note: null,
      icon: 'info',
      color: 'gray',
      timeStart: null,
    })
  })

  it('标题为空时禁用提交', () => {
    const onSubmit = vi.fn()
    render(<NoteEditorDialog open onSubmit={onSubmit} onClose={() => {}} locale="zh" />)
    expect(screen.getByRole('button', { name: '添加备注' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('编辑模式：预填已有字段，改动后提交编辑结果', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(<NoteEditorDialog open item={makeNoteItem()} onSubmit={onSubmit} onClose={() => {}} locale="zh" />)

    // 预填
    expect(screen.getByLabelText('标题')).toHaveValue('集合地点')
    expect(screen.getByLabelText('详情（可选）')).toHaveValue('站前广场雕像下')
    expect(screen.getByLabelText('时间（可选）')).toHaveValue('09:30')
    expect(screen.getByRole('button', { name: '拍照' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '天蓝' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('编辑备注')).toBeTruthy()

    // 改动标题/颜色/时间后提交
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '改：北口集合' } })
    fireEvent.click(screen.getByRole('button', { name: '琥珀' }))
    fireEvent.change(screen.getByLabelText('时间（可选）'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存备注' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({
      title: '改：北口集合',
      note: '站前广场雕像下',
      icon: 'camera',
      color: 'amber',
      timeStart: null,
    })
  })

  it('编辑模式：非法的 icon/color 落回默认值', () => {
    const onSubmit = vi.fn()
    render(
      <NoteEditorDialog
        open
        item={makeNoteItem({ icon: 'not-a-real-icon', color: 'neon' })}
        onSubmit={onSubmit}
        onClose={() => {}}
        locale="zh"
      />
    )
    expect(screen.getByRole('button', { name: '信息' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '灰色' })).toHaveAttribute('aria-pressed', 'true')
  })
})
