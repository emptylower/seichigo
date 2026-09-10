import { describe, expect, it } from 'vitest'
import {
  isPreloadVaryStripPath,
  stripNextRouterVaryFromResponse,
} from '@/worker/preloadVaryStrip'

function buildResponse(varyLines: string[]): Response {
  const headers = new Headers()
  for (const line of varyLines) {
    headers.append('vary', line)
  }
  headers.set('content-type', 'application/json')
  headers.set('cache-control', 'public, s-maxage=300, stale-while-revalidate=1800')
  return new Response('{"ok":true}', { status: 200, headers })
}

async function readVaryLines(response: Response): Promise<string[]> {
  const lines: string[] = []
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'vary') lines.push(value)
  })
  return lines
}

describe('isPreloadVaryStripPath', () => {
  it('matches only the preload API prefix', () => {
    expect(isPreloadVaryStripPath('/api/anitabi/preload/manifest')).toBe(true)
    expect(isPreloadVaryStripPath('/api/anitabi/preload/chunks/0')).toBe(true)
    expect(isPreloadVaryStripPath('/api/anitabi/chunks/0')).toBe(false)
    expect(isPreloadVaryStripPath('/map')).toBe(false)
  })
})

describe('stripNextRouterVaryFromResponse', () => {
  it('removes the Next router vary line and keeps other tokens (double vary line form)', async () => {
    const source = buildResponse([
      'rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch',
      'accept-encoding',
    ])

    const cleaned = stripNextRouterVaryFromResponse(
      'https://seichigo.com/api/anitabi/preload/chunks/0?locale=zh',
      source,
    )

    expect(await readVaryLines(cleaned)).toEqual(['accept-encoding'])
    await expect(cleaned.json()).resolves.toEqual({ ok: true })
    expect(cleaned.headers.get('cache-control')).toBe(
      'public, s-maxage=300, stale-while-revalidate=1800',
    )
  })

  it('handles the merged single-line vary form', async () => {
    const source = buildResponse([
      'rsc, accept-encoding, next-router-state-tree',
    ])

    const cleaned = stripNextRouterVaryFromResponse(
      'https://seichigo.com/api/anitabi/preload/manifest?locale=zh',
      source,
    )

    expect(await readVaryLines(cleaned)).toEqual(['accept-encoding'])
  })

  it('drops vary entirely when only router tokens were present', async () => {
    const source = buildResponse([
      'rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch',
    ])

    const cleaned = stripNextRouterVaryFromResponse(
      'https://seichigo.com/api/anitabi/preload/manifest?locale=zh',
      source,
    )

    expect(cleaned.headers.get('vary')).toBeNull()
  })

  it('passes non-preload responses through untouched (same reference)', () => {
    const source = buildResponse([
      'rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch',
    ])

    const passed = stripNextRouterVaryFromResponse('https://seichigo.com/map', source)

    expect(passed).toBe(source)
  })

  it('does not rebuild when no router tokens are present', () => {
    const source = buildResponse(['accept-encoding'])

    const passed = stripNextRouterVaryFromResponse(
      'https://seichigo.com/api/anitabi/preload/manifest?locale=zh',
      source,
    )

    expect(passed).toBe(source)
  })

  it('returns the original response for unparseable request urls', () => {
    const source = buildResponse(['rsc'])

    const passed = stripNextRouterVaryFromResponse('not-a-url', source)

    expect(passed).toBe(source)
  })

  it('preserves non-200 status and headers on rebuild', async () => {
    const headers = new Headers()
    headers.append('vary', 'rsc')
    headers.set('content-type', 'application/json')
    const source = new Response('{"error":"x"}', { status: 503, headers })

    const cleaned = stripNextRouterVaryFromResponse(
      'https://seichigo.com/api/anitabi/preload/manifest?locale=zh',
      source,
    )

    expect(cleaned.status).toBe(503)
    expect(cleaned.headers.get('vary')).toBeNull()
    await expect(cleaned.json()).resolves.toEqual({ error: 'x' })
  })
})
