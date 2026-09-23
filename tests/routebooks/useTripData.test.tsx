import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTripData } from '@/app/(authed)/me/routebooks/[id]/hooks/useTripData'
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
    days: [
      { id: 'day1', routeBookId: 'rb1', dayIndex: 1, date: null, title: null, defaultTravelMode: 'transit' },
    ],
    items: [],
    places: [],
    lodgings: [],
  }
}

describe('useTripData 装载', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => {
      const path = String(url)
      if (path === '/api/me/routebooks/rb1') return jsonResponse({ ok: true, routeBook: makeDetail() })
      if (path === '/api/me/routebooks') return jsonResponse({ ok: true, items: [] })
      if (path.startsWith('/api/me/point-states')) return jsonResponse({ ok: true, items: [] })
      if (path.startsWith('/api/me/point-pool')) return jsonResponse({ ok: true, items: [] })
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mount 后详情接口只请求 1 次（load 不随 undoRing 新对象无限重载）', async () => {
    renderHook(() => useTripData('rb1'))

    // 等两个 tick 以上：让所有 setState → re-render 链走完
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }

    const detailCalls = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/me/routebooks/rb1')
    expect(detailCalls).toHaveLength(1)
  })
})
