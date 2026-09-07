import { describe, expect, it } from 'vitest'
import { HomeDataSourceError } from '@/lib/home/dataSourceError'
import {
  readHomeHeroDemoFile,
  readHomeMapClustersFile,
  readHomeMapWorldFile,
  readHomeShowcaseFile,
} from '@/lib/home/generatedHomeFiles'

describe('generatedHomeFiles (static import readers)', () => {
  it('validates the statically imported generated artifacts without fs access', () => {
    const showcase = readHomeShowcaseFile()
    expect(showcase.revisionId).toBeTruthy()
    expect(showcase.savedAt).toBeTruthy()
    expect(Array.isArray(showcase.days)).toBe(true)

    const clusters = readHomeMapClustersFile()
    expect(clusters.generatedAt).toBeTruthy()
    expect(clusters.totalPoints).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(clusters.cells)).toBe(true)

    const heroDemo = readHomeHeroDemoFile()
    expect(heroDemo.planTitle).toBeTruthy()
    expect(heroDemo.day.dayIndex).toBeGreaterThanOrEqual(1)
    expect(heroDemo.day.items.length).toBeGreaterThanOrEqual(3)
    for (const item of heroDemo.day.items) {
      expect(item.imageUrl).toMatch(/^\/images\/showcase\//)
      expect(Number.isFinite(item.lat)).toBe(true)
      expect(Number.isFinite(item.lng)).toBe(true)
    }
    expect(heroDemo.day.transit).toHaveLength(heroDemo.day.items.length - 1)
    for (const entry of heroDemo.day.transit) {
      expect(entry.label).toBeTruthy()
    }
    expect(heroDemo.map?.src).toBe('/images/home/hero-phone-map.webp')
    expect(heroDemo.map?.markers.map((marker) => marker.itemId)).toEqual(heroDemo.day.items.map((item) => item.id))
  })

  it('throws a HomeDataSourceError for invalid showcase payloads', () => {
    expect(() => readHomeShowcaseFile({ days: 'not-an-array' })).toThrow(HomeDataSourceError)
    expect(() => readHomeShowcaseFile(null)).toThrow(HomeDataSourceError)
  })

  it('throws a HomeDataSourceError for invalid map clusters payloads', () => {
    expect(() => readHomeMapClustersFile({ cells: [{ lng: 0 }] })).toThrow(HomeDataSourceError)
    expect(() => readHomeMapClustersFile('nope')).toThrow(HomeDataSourceError)
  })

  it('throws a HomeDataSourceError for invalid hero demo payloads', () => {
    expect(() => readHomeHeroDemoFile({ planTitle: '', day: null })).toThrow(HomeDataSourceError)
    expect(() => readHomeHeroDemoFile('nope')).toThrow(HomeDataSourceError)
  })

  it('reads the optional world map artifact and returns null (never throws) for invalid payloads', () => {
    const world = readHomeMapWorldFile()
    expect(world).not.toBeNull()
    expect(world?.image.src).toBe('/images/home/map-world.webp')
    expect(world?.image.src2x).toBe('/images/home/map-world@2x.webp')
    expect(world?.image.width).toBe(1208)
    expect(world?.image.height).toBe(441)
    expect(world?.image.bounds).toEqual({ lngStart: -22, lngSpan: 345, latTop: 74, latBottom: -52 })
    expect(world?.image.attribution).toContain('CC BY-SA 3.0')
    expect((world?.labels.length ?? 0)).toBeGreaterThanOrEqual(6)
    expect(world?.labels.filter((label) => label.primary)).toHaveLength(1)

    expect(readHomeMapWorldFile({ labels: [] })).toBeNull()
    expect(readHomeMapWorldFile('nope')).toBeNull()
  })
})
