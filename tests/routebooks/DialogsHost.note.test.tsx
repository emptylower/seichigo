import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useDialogsHost } from '@/app/(authed)/me/routebooks/[id]/components/DialogsHost'
import type { ItemRecord, RouteBookDetail } from '@/app/(authed)/me/routebooks/[id]/types'
import type { CreateItemInput, UpdateItemInput } from '@/app/(authed)/me/routebooks/[id]/hooks/tripDataTypes'

const NOTE_ITEM: ItemRecord = {
  id: 'note-1',
  routeBookId: 'rb1',
  dayId: 'day1',
  sortOrder: 0,
  kind: 'note',
  pointId: null,
  placeId: null,
  title: '已有备注',
  note: '旧详情',
  timeStart: '08:00',
  timeEnd: null,
  locked: false,
  icon: 'train',
  color: 'pink',
  legMode: null,
  payload: null,
  createdAt: '2026-09-23T00:00:00.000Z',
}

function makeDetail(): RouteBookDetail {
  return {
    id: 'rb1',
    title: '测试行程',
    status: 'draft',
    metadata: null,
    startDate: null,
    dayCount: 1,
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
    days: [{ id: 'day1', routeBookId: 'rb1', dayIndex: 1, date: null, title: null, defaultTravelMode: 'transit' }],
    items: [NOTE_ITEM],
    places: [],
    lodgings: [],
  }
}

type HarnessProps = {
  addItem: (dayId: string | null, input: CreateItemInput) => Promise<string | null>
  updateItem: (itemId: string, data: UpdateItemInput) => Promise<boolean>
}

function NoteHarness({ addItem, updateItem }: HarnessProps) {
  const dialogs = useDialogsHost({
    detail: makeDetail(),
    createPlace: vi.fn(async () => null),
    updatePlace: vi.fn(async () => true),
    createLodging: vi.fn(async () => null),
    updateLodging: vi.fn(async () => true),
    deleteLodging: vi.fn(async () => true),
    addItem,
    updateItem,
    insertDay: vi.fn(async () => null),
    deleteDay: vi.fn(async () => true),
    reorderDays: vi.fn(async () => true),
    locale: 'zh',
  })
  return (
    <>
      <button type="button" onClick={() => dialogs.openNoteEditor('day1')}>
        打开新建备注
      </button>
      <button type="button" onClick={() => dialogs.openNoteEditor('day1', 'note-1')}>
        打开编辑备注
      </button>
      {dialogs.host}
    </>
  )
}

describe('DialogsHost 备注编排', () => {
  it('新建非默认图标/颜色：先 addItem 再 PATCH icon/color 两步', async () => {
    const addItem = vi.fn().mockResolvedValue('note-new')
    const updateItem = vi.fn().mockResolvedValue(true)
    render(<NoteHarness addItem={addItem} updateItem={updateItem} />)

    fireEvent.click(screen.getByRole('button', { name: '打开新建备注' }))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '集合地点' } })
    fireEvent.click(screen.getByRole('button', { name: '拍照' }))
    fireEvent.click(screen.getByRole('button', { name: '天蓝' }))
    fireEvent.click(screen.getByRole('button', { name: '添加备注' }))

    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1))
    expect(addItem).toHaveBeenCalledWith('day1', { kind: 'note', title: '集合地点', note: undefined, timeStart: undefined })
    expect(updateItem).toHaveBeenCalledWith('note-new', { icon: 'camera', color: 'sky' })
  })

  it('默认图标+颜色：只 addItem，不再 PATCH', async () => {
    const addItem = vi.fn().mockResolvedValue('note-new')
    const updateItem = vi.fn().mockResolvedValue(true)
    render(<NoteHarness addItem={addItem} updateItem={updateItem} />)

    fireEvent.click(screen.getByRole('button', { name: '打开新建备注' }))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '纯文字' } })
    fireEvent.click(screen.getByRole('button', { name: '添加备注' }))

    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1))
    expect(updateItem).not.toHaveBeenCalled()
  })

  it('第二步 PATCH 失败：提交视为失败，弹窗保持打开', async () => {
    const addItem = vi.fn().mockResolvedValue('note-new')
    const updateItem = vi.fn().mockResolvedValue(false)
    render(<NoteHarness addItem={addItem} updateItem={updateItem} />)

    fireEvent.click(screen.getByRole('button', { name: '打开新建备注' }))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '集合地点' } })
    fireEvent.click(screen.getByRole('button', { name: '拍照' }))
    fireEvent.click(screen.getByRole('button', { name: '添加备注' }))

    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1))
    // 弹窗未关闭（还能再看到表单）
    expect(screen.getByLabelText('标题')).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加备注' })).toBeTruthy()
  })

  it('编辑模式：一条 PATCH 更新全部字段，不走 addItem', async () => {
    const addItem = vi.fn().mockResolvedValue('note-new')
    const updateItem = vi.fn().mockResolvedValue(true)
    render(<NoteHarness addItem={addItem} updateItem={updateItem} />)

    fireEvent.click(screen.getByRole('button', { name: '打开编辑备注' }))
    // 预填自 item
    expect(screen.getByLabelText('标题')).toHaveValue('已有备注')

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '改后标题' } })
    fireEvent.click(screen.getByRole('button', { name: '保存备注' }))

    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1))
    expect(updateItem).toHaveBeenCalledWith('note-1', {
      title: '改后标题',
      note: '旧详情',
      icon: 'train',
      color: 'pink',
      timeStart: '08:00',
    })
    expect(addItem).not.toHaveBeenCalled()
  })
})
