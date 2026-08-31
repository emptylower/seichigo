import { describe, it, expect } from 'vitest'
import { clusterIntoDays, orderWithinDay, haversineKm } from '@/lib/planAgent/cluster'

const UJI = [
  { id: 'uji-bridge', lat: 34.8892, lng: 135.8075 },
  { id: 'daikichiyama', lat: 34.8963, lng: 135.8123 },
  { id: 'uji-shrine', lat: 34.8918, lng: 135.8113 },
]
const KYOTO = [
  { id: 'kyoto-station', lat: 34.9858, lng: 135.7585 },
  { id: 'rokujizo', lat: 34.9337, lng: 135.7695 },
]

describe('haversineKm', () => {
  it('measures ~8km between Kyoto Station and Uji Bridge', () => {
    const d = haversineKm({ lat: 34.9858, lng: 135.7585 }, { lat: 34.8892, lng: 135.8075 })
    expect(d).toBeGreaterThan(8)
    expect(d).toBeLessThan(15)
  })
})

describe('clusterIntoDays', () => {
  it('separates Uji and Kyoto groups into two days', () => {
    const clusters = clusterIntoDays([...UJI, ...KYOTO], 2)
    expect(clusters).toHaveLength(2)
    const groups = clusters.map((c) => [...c.pointIds].sort())
    expect(groups).toContainEqual(['daikichiyama', 'uji-bridge', 'uji-shrine'])
    expect(groups).toContainEqual(['kyoto-station', 'rokujizo'])
  })

  it('caps cluster count at point count and assigns sequential dayIndex from 1', () => {
    const clusters = clusterIntoDays(UJI.slice(0, 2), 5)
    expect(clusters.length).toBeLessThanOrEqual(2)
    expect(clusters.map((c) => c.dayIndex)).toEqual(clusters.map((_, i) => i + 1))
  })

  it('is deterministic', () => {
    const a = clusterIntoDays([...UJI, ...KYOTO], 2)
    const b = clusterIntoDays([...UJI, ...KYOTO], 2)
    expect(a).toEqual(b)
  })

  it('is input-order independent and assigns every point exactly once', () => {
    const shuffled = [KYOTO[1], UJI[2], KYOTO[0], UJI[0], UJI[1]]
    const a = clusterIntoDays([...UJI, ...KYOTO], 2)
    const b = clusterIntoDays(shuffled, 2)
    expect(a.map((c) => [...c.pointIds].sort())).toEqual(b.map((c) => [...c.pointIds].sort()))
    const all = a.flatMap((c) => c.pointIds).sort()
    expect(all).toEqual(['daikichiyama', 'kyoto-station', 'rokujizo', 'uji-bridge', 'uji-shrine'])
  })

  it('handles empty input', () => {
    expect(clusterIntoDays([], 3)).toEqual([])
  })
})

describe('orderWithinDay', () => {
  it('produces a nearest-neighbor walk starting from the northernmost point', () => {
    const line = [
      { id: 'south', lat: 34.9, lng: 135.8 },
      { id: 'north', lat: 34.94, lng: 135.8 },
      { id: 'middle', lat: 34.92, lng: 135.8 },
    ]
    expect(orderWithinDay(line).map((p) => p.id)).toEqual(['north', 'middle', 'south'])
  })
})
