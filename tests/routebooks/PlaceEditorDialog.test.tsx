import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PlaceEditorDialog } from '@/app/(authed)/me/routebooks/[id]/components/PlaceEditorDialog'
import type { PlaceRecord } from '@/app/(authed)/me/routebooks/[id]/types'

function makePlace(overrides: Partial<PlaceRecord> = {}): PlaceRecord {
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
    ...overrides,
  }
}

function fillForm() {
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '东京塔酒店' } })
  fireEvent.change(screen.getByLabelText('纬度'), { target: { value: '35.6586' } })
  fireEvent.change(screen.getByLabelText('经度'), { target: { value: '139.7454' } })
}

describe('PlaceEditorDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, results: [] }) }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('提交时 onSubmit 收到数字 lat/lng 与表单字段', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(<PlaceEditorDialog open onSubmit={onSubmit} onClose={() => {}} locale="zh" />)

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: '保存自定义点' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'other',
      title: '东京塔酒店',
      address: null,
      lat: 35.6586,
      lng: 139.7454,
      note: null,
    })
  })

  it('名称或坐标非法时禁用提交', () => {
    const onSubmit = vi.fn()
    render(<PlaceEditorDialog open onSubmit={onSubmit} onClose={() => {}} locale="zh" />)
    const submit = screen.getByRole('button', { name: '保存自定义点' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '只有名字' } })
    expect(submit).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('编辑模式预填已有字段', () => {
    render(<PlaceEditorDialog open place={makePlace()} onSubmit={() => {}} onClose={() => {}} locale="zh" />)
    expect(screen.getByLabelText('名称')).toHaveValue('宇治川茶屋')
    expect(screen.getByLabelText('纬度')).toHaveValue(34.8892)
    expect(screen.getByText('编辑自定义点')).toBeTruthy()
  })

  it('initialCoords 预填坐标（地图右键新建）', () => {
    render(
      <PlaceEditorDialog open initialCoords={{ lat: 35.0116, lng: 135.7681 }} onSubmit={() => {}} onClose={() => {}} locale="zh" />
    )
    expect(screen.getByLabelText('纬度')).toHaveValue(35.0116)
    expect(screen.getByLabelText('经度')).toHaveValue(135.7681)
  })

  it('搜索只在用户输入时触发：编辑初始化/选中结果都不触发，请求带 near', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        results: [{ title: '东京塔', address: '东京都港区芝公园', lat: 35.6586, lng: 139.7454 }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<PlaceEditorDialog open place={makePlace()} onSubmit={() => {}} onClose={() => {}} locale="zh" />)

    // 编辑模式初始化预填了地址，但不触发搜索
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(fetchMock).not.toHaveBeenCalled()

    // 用户输入触发搜索，且带上当前表单坐标作 near
    fireEvent.change(screen.getByLabelText('地址搜索'), { target: { value: '东京塔' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toContain('/api/geocode/search?q=')
    expect(url).toContain('near=34.8892%2C135.8075')

    // 选中结果：地址回填但不再触发搜索
    fireEvent.click(await screen.findByText('东京塔'))
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('地址搜索')).toHaveValue('东京都港区芝公园')
  })
})
