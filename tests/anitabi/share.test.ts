import { describe, expect, it } from 'vitest'
import { buildMapShareImageUrl, parseMapShareQuery, toUrlSearchParams } from '@/lib/anitabi/share'

describe('anitabi share helpers', () => {
  it('parses bangumi and point from query params', () => {
    const query = parseMapShareQuery(new URLSearchParams({ b: '101', p: '101:station' }))
    expect(query).toEqual({ b: 101, p: '101:station' })
  })

  it('falls back to point prefix when bangumi id is missing', () => {
    const query = parseMapShareQuery(new URLSearchParams({ p: '223:harbor' }))
    expect(query).toEqual({ b: 223, p: '223:harbor' })
  })

  it('ignores invalid bangumi id values', () => {
    const query = parseMapShareQuery(new URLSearchParams({ b: 'not-a-number', p: 'spot' }))
    expect(query).toEqual({ b: null, p: 'spot' })
  })

  it('normalizes search params objects', () => {
    const params = toUrlSearchParams({
      b: '101',
      p: ['101:station'],
      q: ' ',
    })
    expect(params.toString()).toBe('b=101&p=101%3Astation')
  })

  it('builds map share image url', () => {
    expect(buildMapShareImageUrl('zh', { b: 101, p: '101:station' })).toBe('/api/anitabi/share-image?locale=zh&b=101&p=101%3Astation')
    expect(buildMapShareImageUrl('en', { b: null, p: null })).toBe('/api/anitabi/share-image?locale=en')
  })
})
