import { describe, expect, it } from 'vitest'
import { parseHomeMapClusters } from '@/lib/home/mapClusters'

describe('parseHomeMapClusters labels', () => {
  const base = { generatedAt: '2026-09-05T00:00:00.000Z', totalPoints: 100, cells: [] }

  it('passes valid labels through untouched', () => {
    const parsed = parseHomeMapClusters({
      ...base,
      labels: [
        { name: { zh: '东京', en: 'Tokyo', ja: '東京' }, lng: 139.7, lat: 35.65, count: 4210 },
        { name: { zh: '京都', en: 'Kyoto', ja: '京都' }, lng: 135.75, lat: 35.05, count: 980 },
      ],
    })

    expect(parsed?.labels).toEqual([
      { name: { zh: '东京', en: 'Tokyo', ja: '東京' }, lng: 139.7, lat: 35.65, count: 4210 },
      { name: { zh: '京都', en: 'Kyoto', ja: '京都' }, lng: 135.75, lat: 35.05, count: 980 },
    ])
  })

  it('defaults labels to an empty array when absent so the frontend renders without labels', () => {
    const parsed = parseHomeMapClusters({ ...base })

    expect(parsed?.labels).toEqual([])
  })

  it('falls back missing en/ja names to zh', () => {
    const parsed = parseHomeMapClusters({
      ...base,
      labels: [{ name: { zh: '镰仓', en: '', ja: null }, lng: 139.55, lat: 35.3, count: 12 }],
    })

    expect(parsed?.labels).toBeDefined()
    expect(parsed!.labels![0]?.name).toEqual({ zh: '镰仓', en: '镰仓', ja: '镰仓' })
  })

  it('rejects invalid label shapes', () => {
    expect(parseHomeMapClusters({ ...base, labels: 'nope' })).toBeNull()
    expect(
      parseHomeMapClusters({ ...base, labels: [{ lng: 1, lat: 1, count: 1 }] })
    ).toBeNull()
    expect(
      parseHomeMapClusters({ ...base, labels: [{ name: '東京', lng: 1, lat: 1, count: 1 }] })
    ).toBeNull()
    expect(
      parseHomeMapClusters({ ...base, labels: [{ name: { zh: ' ' }, lng: 1, lat: 1, count: 1 }] })
    ).toBeNull()
    expect(
      parseHomeMapClusters({ ...base, labels: [{ name: { zh: 'x' }, lng: 1, lat: 1, count: 0 }] })
    ).toBeNull()
    expect(
      parseHomeMapClusters({ ...base, labels: [{ name: { zh: 'x' }, lng: Number.NaN, lat: 1, count: 1 }] })
    ).toBeNull()
  })
})

describe('parseHomeMapClusters bbox', () => {
  it('computes the bbox from cells across a global lng/lat span', () => {
    const parsed = parseHomeMapClusters({
      generatedAt: '2026-09-05T00:00:00.000Z',
      totalPoints: 5000,
      cells: [
        { lng: 139.7, lat: 35.7, count: 4210 },
        { lng: -122.4, lat: 37.8, count: 320 },
        { lng: 13.4, lat: 52.5, count: 180 },
        { lng: 121.5, lat: 25.0, count: 90 },
      ],
    })

    expect(parsed?.bbox).toEqual([-122.4, 25.0, 139.7, 52.5])
  })

  it('degenerates the bbox to the single cell point', () => {
    const parsed = parseHomeMapClusters({
      generatedAt: '2026-09-05T00:00:00.000Z',
      totalPoints: 42,
      cells: [{ lng: 139.65, lat: 35.65, count: 42 }],
    })

    expect(parsed?.bbox).toEqual([139.65, 35.65, 139.65, 35.65])
  })

  it('falls back to the world bbox when there are no cells', () => {
    const parsed = parseHomeMapClusters({
      generatedAt: '2026-09-05T00:00:00.000Z',
      totalPoints: 0,
      cells: [],
    })

    expect(parsed?.bbox).toEqual([-180, -90, 180, 90])
  })

  it('still rejects invalid payloads', () => {
    expect(parseHomeMapClusters({ generatedAt: '', totalPoints: 1, cells: [] })).toBeNull()
    expect(parseHomeMapClusters({ generatedAt: 'x', totalPoints: -1, cells: [] })).toBeNull()
    expect(parseHomeMapClusters('nope')).toBeNull()
  })
})
