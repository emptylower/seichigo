import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildOsmRasterStyle,
  getMapStyleFailoverTimeoutMs,
  getRouteMapStyleCandidates,
  isMapStyleProviderError,
  RouteMapStyleFailover,
  shouldResyncRoutePreviewOnStyleEvent,
  type RouteMapStyleCandidate,
  type RouteStyleResyncParams,
} from '@/components/route/mapStyleFailover'

const ENV_KEYS = [
  'NEXT_PUBLIC_MAPTILER_KEY',
  'NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN',
  'NEXT_PUBLIC_STADIA_MAPS_API_KEY',
  'NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER',
  'NEXT_PUBLIC_MAP_STYLE_FAILOVER_TIMEOUT_MS',
] as const

let envSnapshot: Array<[string, string | undefined]> = []

beforeEach(() => {
  envSnapshot = ENV_KEYS.map((key) => [key, process.env[key]])
  for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  for (const [key, value] of envSnapshot) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function styleUrl(candidate: RouteMapStyleCandidate): string {
  if (typeof candidate.style !== 'string') throw new Error(`expected string style for ${candidate.provider}`)
  return candidate.style
}

describe('buildOsmRasterStyle', () => {
  it('builds a keyless OSM raster style', () => {
    const style = buildOsmRasterStyle()
    expect(style.version).toBe(8)
    const source = style.sources.osm
    expect(source?.type).toBe('raster')
    if (source?.type !== 'raster') throw new Error('expected raster source')
    expect(source.tiles).toEqual(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'])
    expect(style.layers).toHaveLength(1)
  })
})

describe('getRouteMapStyleCandidates', () => {
  it('prefers MapTiler dataviz when key is configured and keeps raster as final fallback', () => {
    process.env.NEXT_PUBLIC_MAPTILER_KEY = 'mt-key'
    const candidates = getRouteMapStyleCandidates()
    expect(candidates.map((c) => c.provider)).toEqual(['maptiler', 'raster'])
    expect(styleUrl(candidates[0]!)).toBe('https://api.maptiler.com/maps/dataviz/style.json?key=mt-key')
    expect(typeof candidates[1]!.style).toBe('object')
  })

  it('encodes special characters in the MapTiler key', () => {
    process.env.NEXT_PUBLIC_MAPTILER_KEY = 'a b&=c'
    const [first] = getRouteMapStyleCandidates()
    expect(styleUrl(first!)).toContain('key=a%20b%26%3Dc')
  })

  it('falls back to raster only when no provider keys are configured', () => {
    const candidates = getRouteMapStyleCandidates()
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.provider).toBe('raster')
  })

  it('respects provider order and includes keyed providers only', () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER = 'mapbox,stadia,maptiler'
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = 'mb-token'
    process.env.NEXT_PUBLIC_STADIA_MAPS_API_KEY = 'stadia-key'
    process.env.NEXT_PUBLIC_MAPTILER_KEY = 'mt-key'
    const candidates = getRouteMapStyleCandidates()
    expect(candidates.map((c) => c.provider)).toEqual(['mapbox', 'stadia', 'maptiler', 'raster'])
    expect(styleUrl(candidates[0]!)).toBe('https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=mb-token')
    expect(styleUrl(candidates[1]!)).toBe('https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=stadia-key')
  })

  it('skips providers without keys while keeping configured order', () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER = 'mapbox,maptiler'
    process.env.NEXT_PUBLIC_MAPTILER_KEY = 'mt-key'
    const candidates = getRouteMapStyleCandidates()
    expect(candidates.map((c) => c.provider)).toEqual(['maptiler', 'raster'])
  })

  it('appends raster when the order omits it', () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER = 'maptiler'
    process.env.NEXT_PUBLIC_MAPTILER_KEY = 'mt-key'
    const candidates = getRouteMapStyleCandidates()
    expect(candidates.map((c) => c.provider)).toEqual(['maptiler', 'raster'])
  })

  it('dedupes and ignores unknown order tokens', () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER = 'maptiler,,foo,maptiler'
    process.env.NEXT_PUBLIC_MAPTILER_KEY = 'mt-key'
    const candidates = getRouteMapStyleCandidates()
    expect(candidates.map((c) => c.provider)).toEqual(['maptiler', 'raster'])
  })
})

describe('getMapStyleFailoverTimeoutMs', () => {
  it('defaults to 9000ms when unset or unparsable', () => {
    expect(getMapStyleFailoverTimeoutMs()).toBe(9000)
    process.env.NEXT_PUBLIC_MAP_STYLE_FAILOVER_TIMEOUT_MS = 'not-a-number'
    expect(getMapStyleFailoverTimeoutMs()).toBe(9000)
  })

  it('respects configured values', () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_FAILOVER_TIMEOUT_MS = '12000'
    expect(getMapStyleFailoverTimeoutMs()).toBe(12000)
  })

  it('clamps to [3000, 30000]', () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_FAILOVER_TIMEOUT_MS = '500'
    expect(getMapStyleFailoverTimeoutMs()).toBe(3000)
    process.env.NEXT_PUBLIC_MAP_STYLE_FAILOVER_TIMEOUT_MS = '99999'
    expect(getMapStyleFailoverTimeoutMs()).toBe(30000)
  })
})

describe('isMapStyleProviderError', () => {
  it.each([
    'AJAXError: Forbidden (403): https://api.maptiler.com/maps/dataviz/style.json',
    '401 Unauthorized',
    '429 Too Many Requests',
    'invalid API key',
    'An error occurred while validating your access token',
    'quota exceeded for this account',
    'rate limit reached',
    'unauthorized domain',
  ])('matches provider auth/service errors: %s', (message) => {
    expect(isMapStyleProviderError(message)).toBe(true)
  })

  it.each(['404 Not Found', 'Network request failed', 'image failed to decode', ''])(
    'ignores unrelated or empty errors: %s',
    (message) => {
      expect(isMapStyleProviderError(message)).toBe(false)
    },
  )

  it('ignores nullish input', () => {
    expect(isMapStyleProviderError(null)).toBe(false)
    expect(isMapStyleProviderError(undefined)).toBe(false)
  })
})

describe('RouteMapStyleFailover', () => {
  const candidates: RouteMapStyleCandidate[] = [
    { provider: 'maptiler', label: 'MapTiler', style: 'https://example.com/mt.json' },
    { provider: 'mapbox', label: 'Mapbox', style: 'https://example.com/mb.json' },
    { provider: 'raster', label: 'raster', style: buildOsmRasterStyle() },
  ]

  it('starts at the first candidate', () => {
    const failover = new RouteMapStyleFailover(candidates)
    expect(failover.currentIndex).toBe(0)
    expect(failover.current.provider).toBe('maptiler')
    expect(failover.hasNext).toBe(true)
  })

  it('falls back to raster-only state when constructed with no candidates', () => {
    const failover = new RouteMapStyleFailover([])
    expect(failover.current.provider).toBe('raster')
    expect(failover.hasNext).toBe(false)
    expect(failover.advance(1000)).toBeNull()
  })

  it('advance moves through candidates and stops at the last one', () => {
    const failover = new RouteMapStyleFailover(candidates)
    expect(failover.advance(1000)?.provider).toBe('mapbox')
    expect(failover.currentIndex).toBe(1)
    expect(failover.advance(2000)?.provider).toBe('raster')
    expect(failover.hasNext).toBe(false)
    expect(failover.advance(3000)).toBeNull()
  })

  it('advances immediately on the first provider auth error', () => {
    const failover = new RouteMapStyleFailover(candidates)
    expect(failover.shouldAdvanceOnError('403 Forbidden', 1000)).toBe(true)
  })

  it('suppresses cascading errors from the previous style within the suppress window', () => {
    const failover = new RouteMapStyleFailover(candidates)
    failover.advance(1000)
    // 旧样式挂起请求在切换后继续报错：窗口内不连跳
    expect(failover.shouldAdvanceOnError('403 Forbidden', 1500)).toBe(false)
    expect(failover.shouldAdvanceOnError('403 Forbidden', 2999)).toBe(false)
    // 窗口过后新样式的真实故障仍可推进
    expect(failover.shouldAdvanceOnError('403 Forbidden', 3000)).toBe(true)
  })

  it('ignores non-provider errors and never advances past the last candidate', () => {
    const failover = new RouteMapStyleFailover([candidates[0]!, candidates[2]!])
    expect(failover.shouldAdvanceOnError('404 Not Found', 1000)).toBe(false)
    failover.advance(1000)
    expect(failover.shouldAdvanceOnError('403 Forbidden', 5000)).toBe(false)
  })
})

describe('shouldResyncRoutePreviewOnStyleEvent', () => {
  const base: RouteStyleResyncParams = {
    event: 'styledata',
    styleLoaded: false,
    layersPresent: false,
    syncing: false,
    disposed: false,
  }
  const decide = (overrides: Partial<RouteStyleResyncParams>) =>
    shouldResyncRoutePreviewOnStyleEvent({ ...base, ...overrides })

  it('resyncs on style.load even when isStyleLoaded() is still false (setStyle 时序要求)', () => {
    // MapLibre v5：style JSON 解析完成即同步触发 style.load，sprite/source 尚未就绪，
    // isStyleLoaded() 此时为 false；自定义资源必须此刻重新挂载
    expect(decide({ event: 'style.load', styleLoaded: false, layersPresent: false })).toBe(true)
  })

  it('does not resync on the first styledata of a new style while isStyleLoaded() is false', () => {
    expect(decide({ event: 'styledata', styleLoaded: false, layersPresent: false })).toBe(false)
  })

  it('resyncs on styledata once the style is fully loaded and layers are still missing', () => {
    expect(decide({ event: 'styledata', styleLoaded: true, layersPresent: false })).toBe(true)
  })

  it('is idempotent once route layers are present (style.load / styledata)', () => {
    expect(decide({ event: 'style.load', styleLoaded: false, layersPresent: true })).toBe(false)
    expect(decide({ event: 'styledata', styleLoaded: true, layersPresent: true })).toBe(false)
  })

  it('always resyncs on load to preserve the initial-mount forced sync semantics', () => {
    expect(decide({ event: 'load', styleLoaded: false, layersPresent: false })).toBe(true)
    expect(decide({ event: 'load', styleLoaded: true, layersPresent: true })).toBe(true)
  })

  it('never resyncs while a sync is re-entering or the component is disposed', () => {
    expect(decide({ event: 'style.load', styleLoaded: false, layersPresent: false, syncing: true })).toBe(false)
    expect(decide({ event: 'load', styleLoaded: true, layersPresent: false, disposed: true })).toBe(false)
  })
})
