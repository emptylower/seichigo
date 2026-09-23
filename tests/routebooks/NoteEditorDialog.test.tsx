import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NoteEditorDialog } from '@/app/(authed)/me/routebooks/[id]/components/NoteEditorDialog'

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
})
