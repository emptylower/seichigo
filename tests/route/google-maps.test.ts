import { describe, expect, it } from 'vitest'
import {
  buildGoogleMapsDirectionsUrls,
  buildGoogleStaticMapUrl,
  extractLatLngFromGoogleMapsUrl,
  type LatLng,
} from '@/lib/route/google'

describe('route google helpers', () => {
  describe('extractLatLngFromGoogleMapsUrl', () => {
    it('parses @lat,lng pattern', () => {
      const url = 'https://www.google.com/maps/place/Test/@35.123456,139.654321,17z'
      expect(extractLatLngFromGoogleMapsUrl(url)).toEqual({ lat: 35.123456, lng: 139.654321 })
    })

    it('parses q=lat,lng', () => {
      const url = 'https://maps.google.com/?q=35.1,139.2'
      expect(extractLatLngFromGoogleMapsUrl(url)).toEqual({ lat: 35.1, lng: 139.2 })
    })

    it('parses query=lat,lng', () => {
      const url = 'https://www.google.com/maps/search/?api=1&query=35.1,139.2'
      expect(extractLatLngFromGoogleMapsUrl(url)).toEqual({ lat: 35.1, lng: 139.2 })
    })

    it('parses !3dlat!4dlng pattern', () => {
      const url = 'https://www.google.com/maps/place/Test/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d35.12!4d139.98'
      expect(extractLatLngFromGoogleMapsUrl(url)).toEqual({ lat: 35.12, lng: 139.98 })
    })

    it('returns null for short links', () => {
      const url = 'https://maps.app.goo.gl/abcdef'
      expect(extractLatLngFromGoogleMapsUrl(url)).toBeNull()
    })
  })

  describe('buildGoogleMapsDirectionsUrls', () => {
    function pts(n: number): LatLng[] {
      return Array.from({ length: n }, (_, i) => ({ lat: 35 + i * 0.01, lng: 139 + i * 0.01 }))
    }

    it('builds a single url for small routes', () => {
      const urls = buildGoogleMapsDirectionsUrls(pts(4), { maxStopsPerUrl: 10 })
      expect(urls).toHaveLength(1)
      const u = new URL(urls[0]!)
      expect(u.hostname).toBe('www.google.com')
      expect(u.pathname).toBe('/maps/dir/')
      expect(u.searchParams.get('api')).toBe('1')
      expect(u.searchParams.get('origin')).toBe('35.000000,139.000000')
      expect(u.searchParams.get('destination')).toBe('35.030000,139.030000')
      expect(u.searchParams.get('waypoints')).toBe('35.010000,139.010000|35.020000,139.020000')
    })

    it('splits long routes into multiple urls with overlap', () => {
      const urls = buildGoogleMapsDirectionsUrls(pts(10), { maxStopsPerUrl: 4 })
      expect(urls).toHaveLength(3)

      const u1 = new URL(urls[0]!)
      const u2 = new URL(urls[1]!)
      const u3 = new URL(urls[2]!)

      expect(u1.searchParams.get('origin')).toBe('35.000000,139.000000')
      expect(u1.searchParams.get('destination')).toBe('35.030000,139.030000')

      expect(u2.searchParams.get('origin')).toBe('35.030000,139.030000')
      expect(u2.searchParams.get('destination')).toBe('35.060000,139.060000')

      expect(u3.searchParams.get('origin')).toBe('35.060000,139.060000')
      expect(u3.searchParams.get('destination')).toBe('35.090000,139.090000')
    })
  })

  describe('buildGoogleStaticMapUrl', () => {
    it('returns null without api key', () => {
      const url = buildGoogleStaticMapUrl([{ lat: 35.1, lng: 139.2 }], { apiKey: '' })
      expect(url).toBeNull()
    })

    it('includes markers and a path', () => {
      const url = buildGoogleStaticMapUrl(
        [
          { lat: 35.1, lng: 139.2 },
          { lat: 35.2, lng: 139.3 },
        ],
        { apiKey: 'k', width: 640, height: 360, scale: 2 }
      )
      expect(url).toBeTruthy()
      const u = new URL(url!)
      expect(u.hostname).toBe('maps.googleapis.com')
      expect(u.pathname).toBe('/maps/api/staticmap')
      expect(u.searchParams.get('key')).toBe('k')
      expect(u.searchParams.get('size')).toBe('640x360')
      expect(u.searchParams.get('scale')).toBe('2')
      expect(u.searchParams.get('maptype')).toBe('roadmap')
      expect(u.searchParams.getAll('markers')).toHaveLength(2)
      expect(u.searchParams.getAll('path')).toHaveLength(1)
      expect(u.searchParams.getAll('path')[0]).toContain('35.100000,139.200000')
      expect(u.searchParams.getAll('path')[0]).toContain('35.200000,139.300000')
    })
  })
})

