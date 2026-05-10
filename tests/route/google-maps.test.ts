import { describe, expect, it } from 'vitest'
import {
  buildGoogleMapsEmbedDirectionsUrl,
  buildGoogleMapsEmbedPlaceUrl,
  buildGoogleMapsPanoramaUrl,
  buildGoogleMapsDirectionsUrls,
  buildGoogleStaticMapUrl,
  extractLatLngFromGoogleMapsUrl,
  isGoogleMapsPanoramaUrl,
  resolveGoogleMapsPanoramaUrl,
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

  describe('buildGoogleMapsEmbedDirectionsUrl', () => {
    it('returns null without api key', () => {
      const url = buildGoogleMapsEmbedDirectionsUrl({
        apiKey: '',
        origin: { lat: 35.1, lng: 139.2 },
        destination: { lat: 35.2, lng: 139.3 },
      })
      expect(url).toBeNull()
    })

    it('builds an official embed v1 directions url with mode and lat,lng coords', () => {
      const url = buildGoogleMapsEmbedDirectionsUrl({
        apiKey: 'k',
        origin: { lat: 35.1, lng: 139.2 },
        destination: { lat: 35.2, lng: 139.3 },
        mode: 'transit',
      })
      expect(url).toBeTruthy()
      const u = new URL(url!)
      expect(u.hostname).toBe('www.google.com')
      expect(u.pathname).toBe('/maps/embed/v1/directions')
      expect(u.searchParams.get('key')).toBe('k')
      expect(u.searchParams.get('origin')).toBe('35.100000,139.200000')
      expect(u.searchParams.get('destination')).toBe('35.200000,139.300000')
      expect(u.searchParams.get('mode')).toBe('transit')
    })

    it('accepts plain string queries (e.g. place names)', () => {
      const url = buildGoogleMapsEmbedDirectionsUrl({
        apiKey: 'k',
        origin: 'Tokyo Station',
        destination: 'Shinjuku Station',
        mode: 'walking',
      })
      const u = new URL(url!)
      expect(u.searchParams.get('origin')).toBe('Tokyo Station')
      expect(u.searchParams.get('destination')).toBe('Shinjuku Station')
      expect(u.searchParams.get('mode')).toBe('walking')
    })

    it('joins waypoints with pipes', () => {
      const url = buildGoogleMapsEmbedDirectionsUrl({
        apiKey: 'k',
        origin: { lat: 35.1, lng: 139.2 },
        destination: { lat: 35.3, lng: 139.4 },
        waypoints: [{ lat: 35.2, lng: 139.3 }, 'Akihabara'],
        mode: 'driving',
      })
      const u = new URL(url!)
      expect(u.searchParams.get('waypoints')).toBe('35.200000,139.300000|Akihabara')
    })

    it('omits mode when not provided', () => {
      const url = buildGoogleMapsEmbedDirectionsUrl({
        apiKey: 'k',
        origin: 'A',
        destination: 'B',
      })
      const u = new URL(url!)
      expect(u.searchParams.has('mode')).toBe(false)
    })

    it('returns null when origin or destination resolves empty', () => {
      const url = buildGoogleMapsEmbedDirectionsUrl({
        apiKey: 'k',
        origin: '   ',
        destination: 'B',
      })
      expect(url).toBeNull()
    })
  })

  describe('buildGoogleMapsEmbedPlaceUrl', () => {
    it('returns null without api key or query', () => {
      expect(buildGoogleMapsEmbedPlaceUrl({ apiKey: '', q: 'A' })).toBeNull()
      expect(buildGoogleMapsEmbedPlaceUrl({ apiKey: 'k', q: '   ' })).toBeNull()
    })

    it('builds embed v1 place url from coords', () => {
      const url = buildGoogleMapsEmbedPlaceUrl({ apiKey: 'k', q: { lat: 35.1, lng: 139.2 }, zoom: 15 })
      const u = new URL(url!)
      expect(u.hostname).toBe('www.google.com')
      expect(u.pathname).toBe('/maps/embed/v1/place')
      expect(u.searchParams.get('q')).toBe('35.100000,139.200000')
      expect(u.searchParams.get('zoom')).toBe('15')
    })

    it('clamps zoom into 0-21 range', () => {
      const high = buildGoogleMapsEmbedPlaceUrl({ apiKey: 'k', q: 'A', zoom: 99 })
      expect(new URL(high!).searchParams.get('zoom')).toBe('21')
      const low = buildGoogleMapsEmbedPlaceUrl({ apiKey: 'k', q: 'A', zoom: -3 })
      expect(new URL(low!).searchParams.get('zoom')).toBe('0')
    })
  })

  describe('panorama helpers', () => {
    it('detects panorama urls', () => {
      expect(isGoogleMapsPanoramaUrl('https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=35.1,139.2')).toBe(true)
      expect(isGoogleMapsPanoramaUrl('https://www.google.com/maps?q=35.1,139.2')).toBe(false)
    })

    it('builds a panorama url from valid point', () => {
      const url = buildGoogleMapsPanoramaUrl({ lat: 35.1, lng: 139.2 }, { heading: 120, pitch: 5 })
      expect(url).toBeTruthy()
      const parsed = new URL(url!)
      expect(parsed.hostname).toBe('www.google.com')
      expect(parsed.searchParams.get('map_action')).toBe('pano')
      expect(parsed.searchParams.get('viewpoint')).toBe('35.100000,139.200000')
      expect(parsed.searchParams.get('heading')).toBe('120')
      expect(parsed.searchParams.get('pitch')).toBe('5')
    })

    it('returns null when point is invalid', () => {
      expect(buildGoogleMapsPanoramaUrl({ lat: 999, lng: 139.2 })).toBeNull()
    })

    it('prefers source panorama link when available', () => {
      const source = 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=35.1,139.2'
      expect(resolveGoogleMapsPanoramaUrl({ originLink: source, geo: { lat: 0, lng: 0 } })).toBe(source)
    })

    it('falls back to geo when source is not panorama', () => {
      const url = resolveGoogleMapsPanoramaUrl({
        originLink: 'https://www.google.com/maps?q=35.1,139.2',
        geo: { lat: 36.1, lng: 140.2 },
      })
      expect(url).toBeTruthy()
      const parsed = new URL(url!)
      expect(parsed.searchParams.get('map_action')).toBe('pano')
      expect(parsed.searchParams.get('viewpoint')).toBe('36.100000,140.200000')
    })
  })
})
