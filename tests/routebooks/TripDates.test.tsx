import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DetailNav } from '@/app/(authed)/me/routebooks/[id]/components/DetailChrome'
import { DaySummaryBar } from '@/app/(authed)/me/routebooks/[id]/components/mobile/DaySummaryBar'
import { useDayMutations } from '@/app/(authed)/me/routebooks/[id]/hooks/useDayMutations'
import type { SetDetail } from '@/app/(authed)/me/routebooks/[id]/hooks/useMutationBase'
import type { DayRecord, RouteBookDetail } from '@/app/(authed)/me/routebooks/[id]/types'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

function makeDay(id: string, dayIndex: number, date: string | null): DayRecord {
  return { id, routeBookId: 'rb1', dayIndex, date, title: null, defaultTravelMode: 'transit' }
}

function renderNav(startDate: string | null, onSaveStartDate = vi.fn(async (_value: string | null) => true)) {
  render(
    <DetailNav
      title="京吹巡礼"
      editing={false}
      draft="京吹巡礼"
      onDraftChange={() => {}}
      onSave={() => {}}
      onStartEdit={() => {}}
      onCancelEdit={() => {}}
      startDate={startDate}
      onSaveStartDate={onSaveStartDate}
      locale="zh"
    />
  )
  return onSaveStartDate
}

describe('S4 行程日期入口', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('面包屑「日期」→ 选开始日期保存：回调收到 UTC 零点 ISO，弹窗关闭', async () => {
    const onSave = renderNav(null)
    fireEvent.click(screen.getByRole('button', { name: '编辑行程日期' }))
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-26' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('2026-09-26T00:00:00.000Z'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '行程日期' })).toBeNull())
  })

  it('已有日期：预填并可「清除日期」→ 回调收到 null', async () => {
    const onSave = renderNav('2026-09-15T00:00:00.000Z')
    fireEvent.click(screen.getByRole('button', { name: '编辑行程日期' }))
    expect(screen.getByLabelText('开始日期')).toHaveValue('2026-09-15')
    // 未改动时保存禁用
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '清除日期' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null))
  })

  it('移动端 DaySummaryBar 抽屉里同样可改开始日期', async () => {
    const onSave = vi.fn(async (_value: string | null) => true)
    render(
      <DaySummaryBar
        day={makeDay('day1', 1, null)}
        items={[]}
        places={[]}
        lodgings={[]}
        getPointPreview={() => ({ title: '', subtitle: '', image: null, geo: null })}
        startDate={null}
        onSaveStartDate={onSave}
        locale="zh"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '当天住宿' }))
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-26' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('2026-09-26T00:00:00.000Z'))
  })

  it('patchBook({ startDate })：PATCH 体正确，本地按开始日期重算各天 date，不整页重拉', async () => {
    const detail: RouteBookDetail = {
      id: 'rb1',
      title: '测试行程',
      status: 'draft',
      metadata: null,
      startDate: '2026-09-15T00:00:00.000Z',
      dayCount: 3,
      createdAt: '2026-09-23T00:00:00.000Z',
      updatedAt: '2026-09-23T00:00:00.000Z',
      days: [
        makeDay('dayA', 1, '2026-09-15T00:00:00.000Z'),
        makeDay('dayB', 2, '2026-09-16T00:00:00.000Z'),
        makeDay('dayC', 3, '2026-09-17T00:00:00.000Z'),
      ],
      items: [],
      places: [],
      lodgings: [],
    }
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        routeBook: { id: 'rb1', startDate: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' },
        bookUpdatedAt: '2026-09-24T00:00:00.000Z',
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    let current: RouteBookDetail | null = detail
    const setDetail: SetDetail = (value) => {
      current = typeof value === 'function' ? value(current) : value
    }
    const load = vi.fn(async () => {})
    const { result } = renderHook(() =>
      useDayMutations({
        id: 'rb1',
        detailRef: { current: detail },
        setDetail,
        handleFailure: vi.fn(),
        pushUndo: vi.fn(),
        refreshPointPool: vi.fn(async () => {}),
        showToast: vi.fn(),
        load,
        locale: 'zh',
      })
    )

    const ok = await result.current.patchBook({ startDate: '2026-09-26T00:00:00.000Z' })

    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/me/routebooks/rb1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({
      startDate: '2026-09-26T00:00:00.000Z',
      updatedAt: '2026-09-23T00:00:00.000Z',
    })
    expect(load).not.toHaveBeenCalled()
    const next = current as RouteBookDetail | null
    expect(next?.startDate).toBe('2026-09-26T00:00:00.000Z')
    expect(next?.updatedAt).toBe('2026-09-24T00:00:00.000Z')
    expect(next?.days.map((day) => day.date)).toEqual([
      '2026-09-26T00:00:00.000Z',
      '2026-09-27T00:00:00.000Z',
      '2026-09-28T00:00:00.000Z',
    ])
  })
})
