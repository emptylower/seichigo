import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePlaceLodgingMutations } from '@/app/(authed)/me/routebooks/[id]/hooks/usePlaceLodgingMutations'
import type { SetDetail } from '@/app/(authed)/me/routebooks/[id]/hooks/useMutationBase'
import type { RouteBookDetail } from '@/app/(authed)/me/routebooks/[id]/types'

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => data } as Response
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
    items: [],
    places: [
      {
        id: 'place-1',
        routeBookId: 'rb1',
        kind: 'other',
        title: 'P',
        address: null,
        lat: 35,
        lng: 135,
        note: null,
        createdAt: '2026-09-23T00:00:00.000Z',
      },
    ],
    lodgings: [],
  }
}

function setup(undoCount: number) {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(jsonResponse({ ok: true, bookUpdatedAt: '2026-09-23T03:00:00.000Z' }))
  const detail = makeDetail()
  let current: RouteBookDetail | null = detail
  const detailRef = { current }
  const setDetail: SetDetail = (value) => {
    current = typeof value === 'function' ? value(current) : value
  }
  const clearUndo = vi.fn()
  const getUndoCount = vi.fn(() => undoCount)
  const showToast = vi.fn()
  const { result } = renderHook(() =>
    usePlaceLodgingMutations({
      id: 'rb1',
      detailRef,
      setDetail,
      handleFailure: vi.fn(),
      pushUndo: vi.fn(),
      clearUndo,
      getUndoCount,
      refreshPointPool: vi.fn(async () => {}),
      showToast,
      load: vi.fn(async () => {}),
      locale: 'zh',
    })
  )
  return { result, clearUndo, showToast, getDetail: () => current }
}

describe('usePlaceLodgingMutations.deletePlace 撤销环清理', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('撤销环非空：清空并 toast 提示', async () => {
    const { result, clearUndo, showToast, getDetail } = setup(2)

    const ok = await result.current.deletePlace('place-1')

    expect(ok).toBe(true)
    expect(clearUndo).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('撤销历史已清空')
    expect(getDetail()!.places).toHaveLength(0)
  })

  it('撤销环为空：清空但不打扰 toast', async () => {
    const { result, clearUndo, showToast } = setup(0)

    const ok = await result.current.deletePlace('place-1')

    expect(ok).toBe(true)
    expect(clearUndo).toHaveBeenCalledTimes(1)
    expect(showToast).not.toHaveBeenCalled()
  })
})
