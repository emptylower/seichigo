import { describe, expect, it } from 'vitest'
import { aggregateCells, pickCityLabels, type CityLabelCandidate } from '@/lib/home/mapClusters'

describe('pickCityLabels', () => {
  const tokyo: CityLabelCandidate = {
    name: { zh: '东京', en: 'Tokyo', ja: '東京' },
    lat: 35.6812,
    lng: 139.7671,
    tieKey: 'tokyo',
  }
  const sapporo: CityLabelCandidate = {
    name: { zh: '札幌', en: 'Sapporo', ja: '札幌' },
    lat: 43.0618,
    lng: 141.3545,
    tieKey: 'sapporo',
  }

  it('sums cell counts within the 25km radius and sorts labels by count desc', () => {
    const labels = pickCityLabels(
      [
        { lng: 139.75, lat: 35.65, count: 500 },
        { lng: 139.85, lat: 35.7, count: 120 },
        { lng: 141.35, lat: 43.05, count: 90 },
        // 距东京 ~43km、距札幌 ~800km：不属于任何城市
        { lng: 139.45, lat: 35.3, count: 40 },
      ],
      [tokyo, sapporo]
    )

    expect(labels).toEqual([
      { name: { zh: '东京', en: 'Tokyo', ja: '東京' }, lng: 139.7671, lat: 35.6812, count: 620 },
      { name: { zh: '札幌', en: 'Sapporo', ja: '札幌' }, lng: 141.3545, lat: 43.0618, count: 90 },
    ])
  })

  it('drops cities with no cells inside the radius', () => {
    const osaka: CityLabelCandidate = {
      name: { zh: '大阪', en: 'Osaka', ja: '大阪' },
      lat: 34.6871,
      lng: 135.5142,
      tieKey: 'osaka',
    }

    const labels = pickCityLabels([{ lng: 139.75, lat: 35.65, count: 500 }], [tokyo, osaka])

    expect(labels.map((label) => label.name.zh)).toEqual(['东京'])
  })

  it('merges labels closer than minSeparationKm (metro areas) while keeping Kyoto/Osaka apart', () => {
    const yokohama: CityLabelCandidate = {
      name: { zh: '横滨', en: 'Yokohama', ja: '横浜' },
      lat: 35.4437,
      lng: 139.638,
      tieKey: 'yokohama',
      weight: 30,
    }
    const kyoto: CityLabelCandidate = {
      name: { zh: '京都', en: 'Kyoto', ja: '京都' },
      lat: 35.0116,
      lng: 135.7681,
      tieKey: 'kyoto',
      weight: 50,
    }
    const osaka: CityLabelCandidate = {
      name: { zh: '大阪', en: 'Osaka', ja: '大阪' },
      lat: 34.6871,
      lng: 135.5142,
      tieKey: 'osaka',
      weight: 40,
    }

    const labels = pickCityLabels(
      [
        { lng: 139.75, lat: 35.65, count: 500 },
        { lng: 139.65, lat: 35.45, count: 300 },
        { lng: 135.75, lat: 35.05, count: 200 },
        { lng: 135.55, lat: 34.65, count: 150 },
      ],
      [{ ...tokyo, weight: 200 }, yokohama, kyoto, osaka]
    )

    // 横滨距东京 ~28km 被合并；京都-大阪 ~43km 保留两者
    expect(labels.map((label) => label.name.zh)).toEqual(['东京', '京都', '大阪'])
  })

  it('lets the higher-weight canonical city keep the metro name over a denser small ward', () => {
    // 品川质心更贴近密度中心、count 更高，但"东京"组点位多得多 → 留名东京
    const shinagawa: CityLabelCandidate = {
      name: { zh: '品川', en: 'Shinagawa', ja: '品川' },
      lat: 35.6285,
      lng: 139.7393,
      tieKey: 'shinagawa',
      weight: 5,
    }
    const tokyoWeighted: CityLabelCandidate = { ...tokyo, weight: 200 }

    const labels = pickCityLabels(
      [
        { lng: 139.73, lat: 35.63, count: 1600 },
        { lng: 139.75, lat: 35.68, count: 100 },
      ],
      [shinagawa, tokyoWeighted]
    )

    expect(labels).toEqual([
      { name: { zh: '东京', en: 'Tokyo', ja: '東京' }, lng: 139.7671, lat: 35.6812, count: 1700 },
    ])
  })

  it('caps labels at maxLabels and breaks count ties by tieKey asc', () => {
    const cells = [
      { lng: 139.75, lat: 35.65, count: 7 },
      { lng: 141.35, lat: 43.05, count: 7 },
    ]

    expect(pickCityLabels(cells, [tokyo, sapporo], { maxLabels: 1 })).toHaveLength(1)
    // 同 count 7：tieKey 'sapporo' < 'tokyo'，札幌在前
    expect(pickCityLabels(cells, [tokyo, sapporo]).map((label) => label.name.zh)).toEqual([
      '札幌',
      '东京',
    ])

    const reversed: CityLabelCandidate = { ...sapporo, tieKey: 'zzz' }
    expect(pickCityLabels(cells, [tokyo, reversed]).map((label) => label.name.zh)).toEqual([
      '东京',
      '札幌',
    ])
  })

  it('skips candidates with invalid coordinates or blank names and rejects bad options', () => {
    const cells = [{ lng: 139.75, lat: 35.65, count: 5 }]

    expect(
      pickCityLabels(cells, [
        { ...tokyo, lat: Number.NaN },
        { ...tokyo, name: { zh: '', en: '', ja: '' } },
      ])
    ).toEqual([])

    expect(pickCityLabels(cells, [tokyo], { radiusKm: 0 })).toEqual([])
    expect(pickCityLabels(cells, [tokyo], { maxLabels: 0 })).toEqual([])
    expect(pickCityLabels(cells, [tokyo], { minSeparationKm: -1 })).toEqual([])
  })

  it('falls back missing en/ja names to zh in emitted labels', () => {
    const kamakura: CityLabelCandidate = {
      name: { zh: '镰仓', en: '', ja: '' },
      lat: 35.3192,
      lng: 139.5467,
      tieKey: 'kamakura',
    }

    const labels = pickCityLabels([{ lng: 139.55, lat: 35.3, count: 9 }], [kamakura])

    expect(labels[0]?.name).toEqual({ zh: '镰仓', en: '镰仓', ja: '镰仓' })
  })
})

describe('aggregateCells', () => {
  it('aggregates points into 0.1° cells with cell-center coordinates, sorted by count desc', () => {
    const cells = aggregateCells([
      { lat: 35.7013, lng: 139.7966 },
      { lat: 35.7412, lng: 139.7536 },
      { lat: 35.6812, lng: 139.7671 },
      { lat: 34.67, lng: 135.5 },
    ], 0.1, 100)

    expect(cells).toEqual([
      { lat: 35.75, lng: 139.75, count: 2 },
      { lat: 34.65, lng: 135.55, count: 1 },
      { lat: 35.65, lng: 139.75, count: 1 },
    ])
  })

  it('breaks count ties deterministically by lng then lat', () => {
    const cells = aggregateCells([
      { lat: 35.1, lng: 139.1 },
      { lat: 34.9, lng: 139.2 },
      { lat: 35.2, lng: 139.0 },
    ], 0.1, 100)

    expect(cells.map((c) => [c.lat, c.lng, c.count])).toEqual([
      [35.25, 139.05, 1],
      [35.15, 139.15, 1],
      [34.95, 139.25, 1],
    ])
  })

  it('keeps only the top maxCells cells', () => {
    const points = [
      { lat: 35.1, lng: 139.1 },
      { lat: 35.1, lng: 139.1 },
      { lat: 35.1, lng: 139.1 },
      { lat: 34.2, lng: 135.2 },
      { lat: 34.2, lng: 135.2 },
      { lat: 33.3, lng: 130.3 },
    ]

    const cells = aggregateCells(points, 0.1, 2)

    expect(cells).toHaveLength(2)
    expect(cells[0]).toMatchObject({ lat: 35.15, count: 3 })
    expect(cells[1]).toMatchObject({ lat: 34.25, count: 2 })
  })

  it('skips non-finite coordinates and rejects invalid grid parameters', () => {
    expect(aggregateCells([
      { lat: Number.NaN, lng: 139.1 },
      { lat: 35.1, lng: Number.POSITIVE_INFINITY },
      { lat: 35.1, lng: 139.1 },
    ], 0.1, 10)).toEqual([{ lat: 35.15, lng: 139.15, count: 1 }])

    expect(aggregateCells([{ lat: 35.1, lng: 139.1 }], 0, 10)).toEqual([])
    expect(aggregateCells([{ lat: 35.1, lng: 139.1 }], -0.1, 10)).toEqual([])
    expect(aggregateCells([{ lat: 35.1, lng: 139.1 }], 0.1, 0)).toEqual([])
  })
})
