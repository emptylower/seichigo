import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LodgingDialog } from '@/app/(authed)/me/routebooks/[id]/components/LodgingDialog'
import { useDialogsHost } from '@/app/(authed)/me/routebooks/[id]/components/DialogsHost'
import type { LodgingRecord, PlaceRecord, RouteBookDetail } from '@/app/(authed)/me/routebooks/[id]/types'
import type { PlaceInput } from '@/app/(authed)/me/routebooks/[id]/hooks/tripDataTypes'

function makeDay(id: string, dayIndex: number) {
  return { id, routeBookId: 'rb1', dayIndex, date: null, title: null, defaultTravelMode: 'transit' as const }
}

function makePlace(id: string, kind: PlaceRecord['kind'], title: string): PlaceRecord {
  return {
    id,
    routeBookId: 'rb1',
    kind,
    title,
    address: null,
    lat: 35,
    lng: 135,
    note: null,
    createdAt: '2026-09-23T00:00:00.000Z',
  }
}

function makeDetail(overrides: Partial<RouteBookDetail> = {}): RouteBookDetail {
  return {
    id: 'rb1',
    title: '测试行程',
    status: 'draft',
    metadata: null,
    startDate: null,
    dayCount: 3,
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
    days: [makeDay('day1', 1), makeDay('day2', 2), makeDay('day3', 3)],
    items: [],
    places: [makePlace('pl-hotel', 'lodging', '宇治站前酒店'), makePlace('pl-cafe', 'restaurant', '平等院茶屋')],
    lodgings: [],
    ...overrides,
  }
}

function renderDialog(overrides: Partial<Parameters<typeof LodgingDialog>[0]> = {}) {
  const props: Parameters<typeof LodgingDialog>[0] = {
    open: true,
    detail: makeDetail(),
    onSubmit: vi.fn().mockResolvedValue(true),
    onRequestNewPlace: vi.fn(),
    onClose: vi.fn(),
    locale: 'zh',
    ...overrides,
  }
  render(<LodgingDialog {...props} />)
  return props
}

describe('LodgingDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('提交 payload 形状：placeId/from/to/checkIn/checkOut/note', async () => {
    const props = renderDialog({ presetPlaceId: 'pl-hotel', presetDayIndex: 1 })

    fireEvent.change(screen.getByLabelText('退房日'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('入住时间（可选）'), { target: { value: '15:00' } })
    fireEvent.change(screen.getByLabelText('退房时间（可选）'), { target: { value: '11:00' } })
    fireEvent.change(screen.getByLabelText('备注（可选）'), { target: { value: '含早' } })
    fireEvent.click(screen.getByRole('button', { name: '保存住宿' }))

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1))
    expect(props.onSubmit).toHaveBeenCalledWith({
      placeId: 'pl-hotel',
      fromDayIndex: 1,
      toDayIndex: 3,
      checkIn: '15:00',
      checkOut: '11:00',
      note: '含早',
    })
  })

  it('presetDayIndex 预选入住日，退房日默认入住日的下一天', () => {
    renderDialog({ presetDayIndex: 2 })
    expect(screen.getByLabelText('入住日')).toHaveValue('2')
    expect(screen.getByLabelText('退房日')).toHaveValue('3')
  })

  it('编辑模式预填并有「删除住宿」；确认后才调 onDelete', async () => {
    const lodging: LodgingRecord = {
      id: 'lod1',
      routeBookId: 'rb1',
      placeId: 'pl-hotel',
      fromDayIndex: 1,
      toDayIndex: 3,
      checkIn: '15:00',
      checkOut: null,
      note: '两晚',
    }
    const onDelete = vi.fn().mockResolvedValue(true)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderDialog({ lodging, onDelete })

    // 预填
    expect(screen.getByLabelText('入住日')).toHaveValue('1')
    expect(screen.getByLabelText('退房日')).toHaveValue('3')
    expect(screen.getByLabelText('备注（可选）')).toHaveValue('两晚')

    // 取消确认 → 不删
    fireEvent.click(screen.getByRole('button', { name: '删除住宿' }))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()

    // 确认 → 删
    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '删除住宿' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
  })

  it('新建模式没有删除按钮', () => {
    renderDialog({ presetPlaceId: 'pl-hotel' })
    expect(screen.queryByRole('button', { name: '删除住宿' })).toBeNull()
  })
})

describe('DialogsHost 住宿 → 新建住宿点往返', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function RoundTripHarness() {
    const createPlace = vi.fn(async (_input: PlaceInput) => 'new-place-id')
    const dialogs = useDialogsHost({
      detail: makeDetail(),
      createPlace,
      updatePlace: vi.fn(async () => true),
      createLodging: vi.fn(async () => 'lod-new'),
      updateLodging: vi.fn(async () => true),
      deleteLodging: vi.fn(async () => true),
      addItem: vi.fn(async () => 'item-new'),
      updateItem: vi.fn(async () => true),
      insertDay: vi.fn(async () => null),
      deleteDay: vi.fn(async () => true),
      reorderDays: vi.fn(async () => true),
      locale: 'zh',
    })
    return (
      <>
        <button type="button" onClick={() => dialogs.openLodgingEditor({ presetDayIndex: 2 })}>
          打开住宿
        </button>
        {dialogs.host}
      </>
    )
  }

  it('新建住宿点后返回住宿弹窗时保留 presetDayIndex', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, results: [] }) })
    )
    render(<RoundTripHarness />)

    fireEvent.click(screen.getByRole('button', { name: '打开住宿' }))
    expect(screen.getByLabelText('入住日')).toHaveValue('2')

    // 跳去新建住宿点
    fireEvent.click(screen.getByRole('button', { name: '新建住宿点' }))
    await screen.findByText('添加自定义点')

    // 填好并保存
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '新酒店' } })
    fireEvent.change(screen.getByLabelText('纬度'), { target: { value: '34.9' } })
    fireEvent.change(screen.getByLabelText('经度'), { target: { value: '135.8' } })
    fireEvent.click(screen.getByRole('button', { name: '保存自定义点' }))

    // 回到住宿弹窗：预选入住日仍是 Day 2
    await waitFor(() => expect(screen.getByLabelText('入住日')).toHaveValue('2'))
    expect(screen.getByText('添加住宿')).toBeTruthy()
  })
})
