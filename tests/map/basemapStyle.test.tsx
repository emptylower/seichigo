import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildInlineMapTilerStreetStyle, INLINE_BASEMAP_SOURCE_ID } from '@/features/map/anitabi/basemapStyle'

const ENV_KEYS = [
  'NEXT_PUBLIC_MAPTILER_KEY',
  'NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN',
  'NEXT_PUBLIC_STADIA_MAPS_API_KEY',
  'NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER',
  'NEXT_PUBLIC_MAP_VECTOR',
] as const

let envSnapshot: Array<[string, string | undefined]> = []

beforeEach(() => {
  envSnapshot = ENV_KEYS.map((key) => [key, process.env[key]])
  for (const key of ENV_KEYS) delete process.env[key]
  vi.resetModules()
})

afterEach(() => {
  for (const [key, value] of envSnapshot) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.resetModules()
})

describe('buildInlineMapTilerStreetStyle', () => {
  it('inlines the tile url array so style.json / tiles.json hops are skipped', () => {
    const style = buildInlineMapTilerStreetStyle('mt-key')
    expect(style.version).toBe(8)
    const source = style.sources[INLINE_BASEMAP_SOURCE_ID]
    expect(source?.type).toBe('vector')
    if (source?.type !== 'vector') throw new Error('expected vector source')
    expect(source.tiles).toEqual(['https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=mt-key'])
    expect('url' in source).toBe(false)
  })

  it('keeps glyphs on maptiler fonts for CJK labels and declares no sprite', () => {
    const style = buildInlineMapTilerStreetStyle('mt-key')
    expect(style.glyphs).toBe('https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=mt-key')
    expect('sprite' in style).toBe(false)
    const layerJson = JSON.stringify(style.layers)
    expect(layerJson).not.toContain('icon-image')
  })

  it('encodes special characters in the key', () => {
    const style = buildInlineMapTilerStreetStyle('a b&=c')
    expect(String(style.glyphs)).toContain('key=a%20b%26%3Dc')
    const source = style.sources[INLINE_BASEMAP_SOURCE_ID]
    if (source?.type !== 'vector') throw new Error('expected vector source')
    expect(source.tiles?.[0]).toContain('key=a%20b%26%3Dc')
  })

  it('only renders land / water / road / boundary / place-label source layers', () => {
    const style = buildInlineMapTilerStreetStyle('mt-key')
    const usedSourceLayers = new Set(
      style.layers
        .map((layer) => ('source-layer' in layer ? String(layer['source-layer']) : null))
        .filter((value): value is string => Boolean(value)),
    )
    expect([...usedSourceLayers].sort()).toEqual([
      'boundary',
      'landcover',
      'landuse',
      'place',
      'transportation',
      'water',
      'waterway',
    ])
    for (const layer of style.layers) {
      expect(layer.id.startsWith('base-')).toBe(true)
      if (layer.type !== 'background') {
        expect((layer as { source?: string }).source).toBe(INLINE_BASEMAP_SOURCE_ID)
      }
    }
  })
})

describe('getMapStyleCandidates inline street integration', () => {
  it('returns an inline style object for the maptiler street branch when key is configured', async () => {
    process.env.NEXT_PUBLIC_MAPTILER_KEY = 'mt-key'
    const { getMapStyleCandidates } = await import('@/features/map/anitabi/media')
    const candidates = getMapStyleCandidates('street')
    expect(candidates.map((candidate) => candidate.provider)).toEqual(['maptiler', 'raster'])
    const streetStyle = candidates[0]!.style
    expect(typeof streetStyle).toBe('object')
    if (typeof streetStyle === 'string') throw new Error('expected inline style object')
    expect(streetStyle.sources[INLINE_BASEMAP_SOURCE_ID]?.type).toBe('vector')
  })

  it('keeps the maptiler satellite branch on the remote hybrid style url', async () => {
    process.env.NEXT_PUBLIC_MAPTILER_KEY = 'mt-key'
    const { getMapStyleCandidates } = await import('@/features/map/anitabi/media')
    const candidates = getMapStyleCandidates('satellite')
    expect(candidates[0]!.provider).toBe('maptiler')
    expect(candidates[0]!.style).toBe('https://api.maptiler.com/maps/hybrid/style.json?key=mt-key')
  })

  it('skips maptiler without a key and always ends on raster', async () => {
    const { getMapStyleCandidates } = await import('@/features/map/anitabi/media')
    const candidates = getMapStyleCandidates('street')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.provider).toBe('raster')
    expect(typeof candidates[0]!.style).toBe('object')
  })

  it('respects provider order with keyed providers only', async () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER = 'mapbox,maptiler,stadia'
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = 'mb-token'
    process.env.NEXT_PUBLIC_MAPTILER_KEY = 'mt-key'
    const { getMapStyleCandidates } = await import('@/features/map/anitabi/media')
    const candidates = getMapStyleCandidates('street')
    expect(candidates.map((candidate) => candidate.provider)).toEqual(['mapbox', 'maptiler', 'raster'])
    expect(typeof candidates[1]!.style).toBe('object')
  })
})
