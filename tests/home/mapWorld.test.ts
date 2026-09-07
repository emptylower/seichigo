import { describe, expect, it } from 'vitest'
import {
  isLatInWorldBounds,
  isLngInWorldBounds,
  parseHomeMapWorld,
  projectMapWorld,
} from '@/lib/home/mapWorld'

const bounds = { lngStart: -22, lngSpan: 345, latTop: 74, latBottom: -52 }

const validPayload = {
  generatedAt: '2026-09-07T00:00:00.000Z',
  totalPoints: 50597,
  image: {
    src: '/images/home/map-world.webp',
    src2x: '/images/home/map-world@2x.webp',
    width: 1208,
    height: 441,
    bounds,
    attribution: '底图：TUBS / Wikimedia Commons, CC BY-SA 3.0',
  },
  labels: [
    {
      key: 'tokyo',
      name: { zh: '东京', en: 'Tokyo', ja: '東京' },
      count: 13959,
      lng: 139.69,
      lat: 35.69,
      primary: true,
    },
    {
      key: 'london',
      name: { zh: '伦敦', en: 'London', ja: 'ロンドン' },
      count: 612,
      lng: -0.13,
      lat: 51.51,
    },
  ],
}

describe('projectMapWorld（§1 像素换算公式）', () => {
  it('maps the origin corner to 0%,0% and the far corner to 100%,100%', () => {
    expect(projectMapWorld(bounds, -22, 74)).toEqual({ xPct: 0, yPct: 0 })
    expect(projectMapWorld(bounds, -22 + 345, -52)).toEqual({ xPct: 100, yPct: 100 })
  })

  it('interpolates latitude linearly between latTop and latBottom', () => {
    const { yPct } = projectMapWorld(bounds, 0, 74 - 126 * 0.25)
    expect(yPct).toBeCloseTo(25, 10)
  })

  it('wraps longitudes across the antimeridian to the same x as the equivalent angle', () => {
    const east = projectMapWorld(bounds, 190, 0)
    const west = projectMapWorld(bounds, -170, 0)
    expect(east.xPct).toBeCloseTo(west.xPct, 10)
    expect(east.xPct).toBeCloseTo((212 / 345) * 100, 10)
  })

  it('keeps x monotonic going east and never dips below zero after wrapping', () => {
    // -30° 落在 -37..-22 的大西洋空档外：越过 323° 上限应超过 100%
    expect(projectMapWorld(bounds, -30, 0).xPct).toBeGreaterThan(100)
    expect(projectMapWorld(bounds, -50, 0).xPct).toBeLessThan(100)
    expect(projectMapWorld(bounds, -180, 0).xPct).toBeGreaterThanOrEqual(0)
  })
})

describe('bounds predicates', () => {
  it('accepts edges and rejects coordinates outside the covered range', () => {
    expect(isLngInWorldBounds(-22, bounds)).toBe(true)
    expect(isLngInWorldBounds(-37, bounds)).toBe(true)
    // 空档在大西洋 -37..-22 之间：-30/-25 不在覆盖内；回绕段 -50 与东侧 -21.99 都在
    expect(isLngInWorldBounds(-30, bounds)).toBe(false)
    expect(isLngInWorldBounds(-25, bounds)).toBe(false)
    expect(isLngInWorldBounds(-50, bounds)).toBe(true)
    expect(isLngInWorldBounds(-21.99, bounds)).toBe(true)
    expect(isLngInWorldBounds(-180, bounds)).toBe(true)
    expect(isLatInWorldBounds(74, bounds)).toBe(true)
    expect(isLatInWorldBounds(-52, bounds)).toBe(true)
    expect(isLatInWorldBounds(74.01, bounds)).toBe(false)
    expect(isLatInWorldBounds(-52.01, bounds)).toBe(false)
  })
})

describe('parseHomeMapWorld', () => {
  it('parses a valid payload and keeps primary only where present', () => {
    const parsed = parseHomeMapWorld(validPayload)
    expect(parsed).not.toBeNull()
    expect(parsed?.totalPoints).toBe(50597)
    expect(parsed?.image.bounds).toEqual(bounds)
    expect(parsed?.labels[0]?.primary).toBe(true)
    expect(parsed?.labels[1]?.primary).toBeUndefined()
  })

  it('falls back en/ja names to zh when missing', () => {
    const parsed = parseHomeMapWorld({
      ...validPayload,
      labels: [{ key: 'x', name: { zh: '镰仓' }, count: 30, lng: 139.5, lat: 35.3 }],
    })
    expect(parsed?.labels[0]?.name).toEqual({ zh: '镰仓', en: '镰仓', ja: '镰仓' })
  })

  it.each([
    ['not an object', 'nope'],
    ['missing generatedAt', { ...validPayload, generatedAt: ' ' }],
    ['negative totalPoints', { ...validPayload, totalPoints: -1 }],
    ['empty labels', { ...validPayload, labels: [] }],
    ['label without key', { ...validPayload, labels: [{ name: { zh: 'x' }, count: 1, lng: 0, lat: 0 }] }],
    ['label with zero count', { ...validPayload, labels: [{ ...validPayload.labels[0], count: 0, primary: true }] }],
    ['non-boolean primary', { ...validPayload, labels: [{ ...validPayload.labels[0], primary: 'yes' }] }],
    ['image src missing', { ...validPayload, image: { ...validPayload.image, src: '' } }],
    ['image dimensions not positive ints', { ...validPayload, image: { ...validPayload.image, width: 0 } }],
    ['attribution missing', { ...validPayload, image: { ...validPayload.image, attribution: '' } }],
    ['bounds missing', { ...validPayload, image: { ...validPayload.image, bounds: undefined } }],
    ['lngSpan zero', { ...validPayload, image: { ...validPayload.image, bounds: { ...bounds, lngSpan: 0 } } }],
    ['latTop not above latBottom', { ...validPayload, image: { ...validPayload.image, bounds: { ...bounds, latTop: -52 } } }],
  ])('rejects %s', (_name, raw) => {
    expect(parseHomeMapWorld(raw)).toBeNull()
  })
})
