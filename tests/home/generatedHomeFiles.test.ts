import { describe, expect, it } from 'vitest'
import { HomeDataSourceError } from '@/lib/home/dataSourceError'
import {
  readHomeHeroDemoFile,
  readHomeMapClustersFile,
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
})
