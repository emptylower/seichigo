import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDayLegs, legsSigHash } from '@/app/(authed)/me/routebooks/[id]/hooks/useDayLegs'
import type { RouteBookDetail } from '@/app/(authed)/me/routebooks/[id]/types'

function jsonResponse(data: unknown, ok = true): Response {
  return { ok, json: async () => data } as Response
}

function makeItem(id: string, dayId: string, sortOrder: number) {
  return {
    id,
    routeBookId: 'rb1',
    dayId,
    sortOrder,
    kind: 'point' as const,
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

function makeDetail(itemOrder: string[] = ['i1', 'i2']): RouteBookDetail {
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
    items: itemOrder.map((id, index) => makeItem(id, 'day1', index)),
    places: [],
    lodgings: [],
  }
}

async function flush(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function sigOf(url: string): string | null {
  return new URL(url, 'http://localhost').searchParams.get('sig')
}

describe('useDayLegs ?sig= 接线', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () =>
      jsonResponse({ ok: true, stops: [], legs: [], staleTransitItemIds: [], dayGeometry: null })
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('请求 URL 带 sig 参数（8 位 hex）', async () => {
    renderHook(() => useDayLegs('rb1', makeDetail(), 'day1', true))
    await flush()

    const legCalls = fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.includes('/legs'))
    expect(legCalls.length).toBeGreaterThan(0)
    const sig = sigOf(legCalls[0])
    expect(sig).toMatch(/^[0-9a-f]{8}$/)
  })

  it('同一顺序两次签名相同', async () => {
    renderHook(() => useDayLegs('rb1', makeDetail(['i1', 'i2']), 'day1', true))
    await flush()
    const first = fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.includes('/legs'))
    const firstSig = sigOf(first[0])
    expect(firstSig).not.toBeNull()

    fetchMock.mockClear()
    renderHook(() => useDayLegs('rb1', makeDetail(['i1', 'i2']), 'day1', true))
    await flush()
    const second = fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.includes('/legs'))
    expect(sigOf(second[0])).toBe(firstSig)
  })

  it('条目顺序变化后签名不同', async () => {
    renderHook(() => useDayLegs('rb1', makeDetail(['i1', 'i2']), 'day1', true))
    await flush()
    const first = fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.includes('/legs'))
    const firstSig = sigOf(first[0])

    fetchMock.mockClear()
    renderHook(() => useDayLegs('rb1', makeDetail(['i2', 'i1']), 'day1', true))
    await flush()
    const second = fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.includes('/legs'))
    const secondSig = sigOf(second[0])
    expect(secondSig).not.toBeNull()
    expect(secondSig).not.toBe(firstSig)
  })

  it('legsSigHash 稳定且为 8 位 hex', () => {
    expect(legsSigHash('abc')).toBe(legsSigHash('abc'))
    expect(legsSigHash('abc')).toMatch(/^[0-9a-f]{8}$/)
    expect(legsSigHash('abc')).not.toBe(legsSigHash('abd'))
  })
})
