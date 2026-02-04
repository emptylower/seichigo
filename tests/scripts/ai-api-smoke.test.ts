import { describe, expect, it } from 'vitest'
import { fetchFollowRedirects, joinUrl } from '../../scripts/ai-api-smoke.mjs'

describe('ai-api-smoke script helpers', () => {
  it('joinUrl preserves base when path empty', () => {
    expect(joinUrl('https://seichigo.com/api/ai', '')).toBe('https://seichigo.com/api/ai')
  })

  it('follows 308 redirects and returns final response', async () => {
    const originalFetch = globalThis.fetch

    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      if (calls.length === 1) {
        return new Response('', { status: 308, headers: { Location: '/api/ai' } })
      }
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    try {
      const res = await fetchFollowRedirects('https://seichigo.com/api/ai/', {}, 3)
      expect(res.status).toBe(401)
      expect(calls).toEqual(['https://seichigo.com/api/ai/', 'https://seichigo.com/api/ai'])
      expect(res.headers.get('content-type') || '').toContain('application/json')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
