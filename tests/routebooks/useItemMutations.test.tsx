import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useTripData } from '@/app/(authed)/me/routebooks/[id]/hooks/useTripData'
import type { ItemRecord, RouteBookDetail } from '@/app/(authed)/me/routebooks/[id]/types'

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => data } as Response
}

const POINT_ITEM: ItemRecord = {
  id: 'item-x',
  routeBookId: 'rb1',
  dayId: 'day1',
  sortOrder: 0,
  kind: 'point',
  pointId: 'p1',
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
  createdAt: '2026-09-24T00:00:00.000Z',
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
    places: [],
    lodgings: [],
  }
}

describe('useItemMutations 撤销栈（冒烟 S6）', () => {
  const deletes: string[] = []
  const fetchMock = vi.fn()

  beforeEach(() => {
    deletes.length = 0
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = String(url)
      const method = init?.method ?? 'GET'
      if (path === '/api/me/routebooks/rb1' && method === 'GET') return jsonResponse({ ok: true, routeBook: makeDetail() })
      if (path === '/api/me/routebooks') return jsonResponse({ ok: true, items: [] })
      if (path.startsWith('/api/me/point-states') || path.startsWith('/api/me/point-pool')) return jsonResponse({ ok: true, items: [] })
      // 服务端对同天同点位幂等：两次 POST 都返回同一条目
      if (path === '/api/me/routebooks/rb1/items' && method === 'POST') {
        return jsonResponse({ ok: true, item: POINT_ITEM, items: [POINT_ITEM] })
      }
      if (method === 'DELETE' && path.startsWith('/api/me/routebooks/rb1/items/')) {
        deletes.push(path)
        return deletes.length === 1 ? jsonResponse({ ok: true }) : jsonResponse({ error: '条目不存在' }, false, 400)
      }
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('快速重复加入同一点（服务端幂等返回已有条目）只入栈一条撤销，连撤两次只 DELETE 一次', async () => {
    const { result } = renderHook(() => useTripData('rb1'))
    await waitFor(() => expect(result.current.detail).not.toBeNull())

    await act(async () => {
      await result.current.addItem('day1', { kind: 'point', pointId: 'p1' })
    })
    await act(async () => {
      await result.current.addItem('day1', { kind: 'point', pointId: 'p1' })
    })

    expect(result.current.detail?.items.map((row) => row.id)).toEqual(['item-x'])
    expect(result.current.undoCount).toBe(1)

    await act(async () => {
      await result.current.undo()
    })
    await act(async () => {
      await result.current.undo()
    })

    expect(deletes).toEqual(['/api/me/routebooks/rb1/items/item-x'])
    expect(result.current.detail?.items).toEqual([])
    expect(result.current.toast).toBeNull()
  })
})
