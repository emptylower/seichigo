import { describe, expect, it } from 'vitest'
import {
  RENDER_CACHE_CONTROL,
  buildNotModifiedResponse,
  matchesIfNoneMatch,
} from '@/lib/anitabi/handlers/imageServeCache'

describe('RENDER_CACHE_CONTROL', () => {
  it('exposes a browser-cacheable render policy with max-age and s-maxage', () => {
    expect(RENDER_CACHE_CONTROL).toContain('max-age=86400')
    expect(RENDER_CACHE_CONTROL).toContain('s-maxage=86400')
    expect(RENDER_CACHE_CONTROL).toContain('stale-while-revalidate=604800')
    expect(RENDER_CACHE_CONTROL).toContain('public')
    expect(RENDER_CACHE_CONTROL).not.toContain('no-store')
  })
})

describe('matchesIfNoneMatch', () => {
  it('matches an exact quoted etag', () => {
    expect(matchesIfNoneMatch('"abc"', '"abc"')).toBe(true)
  })

  it('matches a weak validator against the strong etag', () => {
    expect(matchesIfNoneMatch('W/"abc"', '"abc"')).toBe(true)
  })

  it('matches a strong header validator against a weak etag (weak comparison both directions)', () => {
    expect(matchesIfNoneMatch('"abc"', 'W/"abc"')).toBe(true)
    expect(matchesIfNoneMatch('W/"abc"', 'W/"abc"')).toBe(true)
  })

  it('matches one candidate inside a comma-separated list', () => {
    expect(matchesIfNoneMatch('"x", "abc"', '"abc"')).toBe(true)
  })

  it('matches the wildcard header', () => {
    expect(matchesIfNoneMatch('*', '"abc"')).toBe(true)
  })

  it('matches a list mixing weak and strong validators with whitespace', () => {
    expect(matchesIfNoneMatch('"x" , W/"abc"', '"abc"')).toBe(true)
  })

  it('does not match a different etag', () => {
    expect(matchesIfNoneMatch('"x"', '"abc"')).toBe(false)
  })

  it('does not match substrings of the etag', () => {
    expect(matchesIfNoneMatch('"ab"', '"abc"')).toBe(false)
    expect(matchesIfNoneMatch('"abcd"', '"abc"')).toBe(false)
  })

  it('does not match for missing header or missing etag', () => {
    expect(matchesIfNoneMatch(null, '"abc"')).toBe(false)
    expect(matchesIfNoneMatch('', '"abc"')).toBe(false)
    expect(matchesIfNoneMatch('"abc"', '')).toBe(false)
    expect(matchesIfNoneMatch(undefined, '"abc"')).toBe(false)
  })
})

describe('buildNotModifiedResponse', () => {
  it('returns a bodyless 304 with cache headers and the etag', async () => {
    const response = buildNotModifiedResponse('"abc"')

    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
    await expect(response.text()).resolves.toBe('')
    expect(response.headers.get('ETag')).toBe('"abc"')
    expect(response.headers.get('Cache-Control')).toBe(RENDER_CACHE_CONTROL)
  })
})
