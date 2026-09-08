import { describe, expect, it, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useUsage, USAGE_CHANGED_EVENT } from '@/hooks/useUsage'

const view = {
  tier: 'free',
  tierLabel: '免费',
  remainingPercent: 42,
  resetsAt: '2026-09-20T00:00:00.000Z',
  upgradeAvailable: true,
  hints: { transitEstimateOnly: true, restaurantsLocked: true, maxDays: 3 },
}

/** 已登录访客：middleware 打的 sg_auth 标记存在时 useUsage 才会发 /api/me/usage */
function seedAuthHint() {
  document.cookie = 'sg_auth=1; path=/'
}

function clearAuthHint() {
  document.cookie = 'sg_auth=; path=/; max-age=0'
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearAuthHint()
})

describe('useUsage', () => {
  it('loads the usage view and exposes it', async () => {
    seedAuthHint()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(view), { status: 200 })))
    const { result } = renderHook(() => useUsage())
    await waitFor(() => expect(result.current.usage?.remainingPercent).toBe(42))
    expect(result.current.status).toBe('ready')
  })

  it('stays silent on 401/404/network errors', async () => {
    seedAuthHint()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    const { result } = renderHook(() => useUsage())
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.usage).toBeNull()
  })

  it('refetches when the usage-changed event fires', async () => {
    seedAuthHint()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(view), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...view, remainingPercent: 30 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useUsage())
    await waitFor(() => expect(result.current.usage?.remainingPercent).toBe(42))
    window.dispatchEvent(new Event(USAGE_CHANGED_EVENT))
    await waitFor(() => expect(result.current.usage?.remainingPercent).toBe(30))
  })

  it('skips the request entirely for anonymous visitors (no sg_auth hint)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useUsage())
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.usage).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
