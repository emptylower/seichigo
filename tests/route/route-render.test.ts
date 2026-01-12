import { describe, expect, it } from 'vitest'
import { renderSeichiRouteEmbedHtml } from '@/lib/route/render'

describe('route render', () => {
  it('falls back to svg when no google static maps key is set', () => {
    const html = renderSeichiRouteEmbedHtml({ version: 1, spots: [{ name_zh: 'A' }, { name_zh: 'B' }] })
    expect(html).toContain('<svg')
    expect(html).toContain('<table')
  })

  it('renders a google static map card when coords and key are present', () => {
    const prev = process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY = 'k'

    try {
      const html = renderSeichiRouteEmbedHtml({
        version: 1,
        spots: [
          { name_zh: 'A', lat: 35.1, lng: 139.2 },
          { name_zh: 'B', lat: 35.2, lng: 139.3 },
        ],
      })
      expect(html).toContain('seichi-route__map-card')
      expect(html).toContain('<img')
      expect(html).toContain('maps.googleapis.com/maps/api/staticmap')
      expect(html).toContain('seichi-route__map-primary')
      expect(html).toContain('www.google.com/maps/dir/')
    } finally {
      if (prev === undefined) {
        delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY
      } else {
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY = prev
      }
    }
  })
})

