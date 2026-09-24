import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useDialogsHost } from '@/app/(authed)/me/routebooks/[id]/components/DialogsHost'
import type { ItemRecord, PlaceRecord, RouteBookDetail } from '@/app/(authed)/me/routebooks/[id]/types'
import type { CreateItemInput, PlaceInput } from '@/app/(authed)/me/routebooks/[id]/hooks/tripDataTypes'

const PLACE: PlaceRecord = {
  id: 'place-1',
  routeBookId: 'rb1',
  kind: 'restaurant',
  title: '宇治川茶屋',
  address: null,
  lat: 34.8892,
  lng: 135.8075,
  note: null,
  createdAt: '2026-09-23T00:00:00.000Z',
}

function pointItem(id: string, dayId: string, sortOrder: number): ItemRecord {
  return {
    id,
    routeBookId: 'rb1',
    dayId,
    sortOrder,
    kind: 'point',
    pointId: `pt-${id}`,
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
  }
}

function makeDetail(items: ItemRecord[] = []): RouteBookDetail {
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
    items,
    places: [PLACE],
    lodgings: [],
  }
}

type Mocks = {
  createPlace: (input: PlaceInput) => Promise<string | null>
  updatePlace: (placeId: string, input: Partial<PlaceInput>) => Promise<boolean>
  addItem: (dayId: string | null, input: CreateItemInput) => Promise<string | null>
}

function Harness({ mocks, items = [] }: { mocks: Mocks; items?: ItemRecord[] }) {
  const dialogs = useDialogsHost({
    detail: makeDetail(items),
    createPlace: mocks.createPlace,
    updatePlace: mocks.updatePlace,
    createLodging: vi.fn(async () => null),
    updateLodging: vi.fn(async () => true),
    deleteLodging: vi.fn(async () => true),
    addItem: mocks.addItem,
    updateItem: vi.fn(async () => true),
    insertDay: vi.fn(async () => null),
    deleteDay: vi.fn(async () => true),
    reorderDays: vi.fn(async () => true),
    locale: 'zh',
  })
  return (
    <>
      <button type="button" onClick={() => dialogs.openPlaceEditor({ targetDayId: 'day1' })}>
        新建到选中天
      </button>
      <button type="button" onClick={() => dialogs.openPlaceEditor()}>
        新建无选中天
      </button>
      <button
        type="button"
        onClick={() => dialogs.openPlaceEditor({ initialCoords: { lat: 35.0116, lng: 135.7681 }, targetDayId: 'day1' })}
      >
        地图右键新建
      </button>
      <button type="button" onClick={() => dialogs.openPlaceEditor({ placeId: 'place-1', targetDayId: 'day1' })}>
        编辑已有
      </button>
      {dialogs.host}
    </>
  )
}

function makeMocks() {
  return {
    createPlace: vi.fn(async (_input: PlaceInput) => 'place-new' as string | null),
    updatePlace: vi.fn(async (_placeId: string, _input: Partial<PlaceInput>) => true),
    addItem: vi.fn(async (_dayId: string | null, _input: CreateItemInput) => 'item-new' as string | null),
  }
}

function fillAndSave(withCoords = true) {
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '测试酒店' } })
  if (withCoords) {
    fireEvent.change(screen.getByLabelText('纬度'), { target: { value: '35.694268' } })
    fireEvent.change(screen.getByLabelText('经度'), { target: { value: '139.708654' } })
  }
  fireEvent.click(screen.getByRole('button', { name: '保存自定义点' }))
}

describe('DialogsHost 新建自定义点即上地图（冒烟 #9 / S3）', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, results: [] }) }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('有选中天：建点后自动 addItem 到该天末尾（kind=place）', async () => {
    const mocks = makeMocks()
    render(<Harness mocks={mocks} />)
    fireEvent.click(screen.getByRole('button', { name: '新建到选中天' }))
    fillAndSave()

    await waitFor(() => expect(mocks.addItem).toHaveBeenCalledTimes(1))
    expect(mocks.createPlace).toHaveBeenCalledTimes(1)
    expect(mocks.addItem).toHaveBeenCalledWith('day1', { kind: 'place', placeId: 'place-new' })
  })

  it('无选中天：加入「未安排」（dayId=null）', async () => {
    const mocks = makeMocks()
    render(<Harness mocks={mocks} />)
    fireEvent.click(screen.getByRole('button', { name: '新建无选中天' }))
    fillAndSave()

    await waitFor(() => expect(mocks.addItem).toHaveBeenCalledTimes(1))
    expect(mocks.addItem).toHaveBeenCalledWith(null, { kind: 'place', placeId: 'place-new' })
  })

  it('地图右键新建同理：加到选中天', async () => {
    const mocks = makeMocks()
    render(<Harness mocks={mocks} />)
    fireEvent.click(screen.getByRole('button', { name: '地图右键新建' }))
    fillAndSave(false)

    await waitFor(() => expect(mocks.addItem).toHaveBeenCalledTimes(1))
    expect(mocks.addItem).toHaveBeenCalledWith('day1', { kind: 'place', placeId: 'place-new' })
  })

  it('选中天点位已满 25：退回「未安排」', async () => {
    const mocks = makeMocks()
    const full = Array.from({ length: 25 }, (_, index) => pointItem(`f${index}`, 'day1', index))
    render(<Harness mocks={mocks} items={full} />)
    fireEvent.click(screen.getByRole('button', { name: '新建到选中天' }))
    fillAndSave()

    await waitFor(() => expect(mocks.addItem).toHaveBeenCalledTimes(1))
    expect(mocks.addItem).toHaveBeenCalledWith(null, { kind: 'place', placeId: 'place-new' })
  })

  it('建点失败：不建条目', async () => {
    const mocks = makeMocks()
    mocks.createPlace.mockResolvedValueOnce(null)
    render(<Harness mocks={mocks} />)
    fireEvent.click(screen.getByRole('button', { name: '新建到选中天' }))
    fillAndSave()

    await waitFor(() => expect(mocks.createPlace).toHaveBeenCalledTimes(1))
    expect(mocks.addItem).not.toHaveBeenCalled()
  })

  it('编辑模式只 updatePlace，不新增条目', async () => {
    const mocks = makeMocks()
    render(<Harness mocks={mocks} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑已有' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '改名茶屋' } })
    fireEvent.click(screen.getByRole('button', { name: '保存自定义点' }))

    await waitFor(() => expect(mocks.updatePlace).toHaveBeenCalledTimes(1))
    expect(mocks.createPlace).not.toHaveBeenCalled()
    expect(mocks.addItem).not.toHaveBeenCalled()
  })
})
