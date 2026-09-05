import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/** MapLibre 在 jsdom 里没有 WebGL：用最小假实例记录 source/layer/fitBounds 调用 */
const mapState = vi.hoisted(() => ({ instances: [] as FakeMapLike[] }))

type FakeMapLike = {
  options: Record<string, unknown>
  sources: Map<string, Record<string, unknown>>
  layers: Map<string, Record<string, unknown>>
  fitBoundsCalls: Array<[unknown, unknown]>
  removed: boolean
  fire: (event: string) => void
  getSource: (id: string) => Record<string, unknown> | undefined
  getLayer: (id: string) => Record<string, unknown> | undefined
}

vi.mock('maplibre-gl', () => {
  class FakeMap {
    options: Record<string, unknown>
    sources = new Map<string, Record<string, unknown>>()
    layers = new Map<string, Record<string, unknown>>()
    handlers = new Map<string, Array<() => void>>()
    fitBoundsCalls: Array<[unknown, unknown]> = []
    removed = false

    constructor(options: Record<string, unknown>) {
      this.options = options
      mapState.instances.push(this as unknown as FakeMapLike)
    }
    on(event: string, cb: () => void) {
      const list = this.handlers.get(event) ?? []
      list.push(cb)
      this.handlers.set(event, list)
    }
    off() {}
    fire(event: string) {
      for (const cb of this.handlers.get(event) ?? []) cb()
    }
    addSource(id: string, spec: Record<string, unknown>) {
      this.sources.set(id, spec)
    }
    getSource(id: string) {
      return this.sources.get(id)
    }
    addLayer(spec: Record<string, unknown>) {
      this.layers.set(String(spec.id), spec)
    }
    getLayer(id: string) {
      return this.layers.get(id)
    }
    fitBounds(bounds: unknown, options: unknown) {
      this.fitBoundsCalls.push([bounds, options])
    }
    remove() {
      this.removed = true
    }
  }
  return { default: { Map: FakeMap } }
})

import HomeMapTeaser, {
  HOME_MAP_CELL_CIRCLE_LAYER_ID,
  HOME_MAP_CELL_SOURCE_ID,
  HOME_MAP_LABEL_LAYER_ID,
  HOME_MAP_LABEL_SOURCE_ID,
} from '@/components/home/HomeMapTeaser'
import { mapClustersFixture } from './fixtures'

/** 少数海外格子会把预生成 bbox 撑成全球范围（预览里表现为世界被左右重复画两遍） */
function clustersWithOverseasOutliers() {
  const base = mapClustersFixture()
  return {
    ...base,
    cells: [...base.cells, { lng: 2.35, lat: 48.85, count: 3 }, { lng: -74.0, lat: 40.7, count: 2 }],
    bbox: [-74.0, 34.9, 141.3, 48.85] as [number, number, number, number],
  }
}

async function mounted() {
  await waitFor(() => expect(mapState.instances).toHaveLength(1))
  const map = mapState.instances[0]!
  map.fire('load')
  return map
}

describe('HomeMapTeaser', () => {
  beforeEach(() => {
    mapState.instances.length = 0
  })

  it('标题是「全球 N 个巡礼点位」＋副标题，整块可点进 /map', () => {
    render(<HomeMapTeaser locale="zh" clusters={mapClustersFixture()} />)

    expect(screen.getByRole('link', { name: /全球 128,456 个巡礼点位/ })).toHaveAttribute('href', '/map')
    expect(screen.getByText('点开地图看每一个点')).toBeInTheDocument()
  })

  it('低-7：标题走 i18n 模板——en/ja 各自的「全球」口径', () => {
    const en = render(<HomeMapTeaser locale="en" clusters={mapClustersFixture()} />)
    expect(screen.getByRole('link', { name: /128,456 pilgrimage spots worldwide/ })).toBeInTheDocument()
    en.unmount()

    render(<HomeMapTeaser locale="ja" clusters={mapClustersFixture()} />)
    expect(screen.getByRole('link', { name: /世界 128,456 か所の聖地/ })).toBeInTheDocument()
  })

  it('中-3：不聚类——每个格子一个细点，按 count 分档 1.5/2.5/3.5，无描边', async () => {
    render(<HomeMapTeaser locale="zh" clusters={mapClustersFixture()} />)
    const map = await mounted()
    expect(map.options.interactive).toBe(false)

    const source = map.sources.get(HOME_MAP_CELL_SOURCE_ID) as
      | {
          type: string
          cluster?: boolean
          data: { features: Array<{ properties: { count: number }; geometry: { coordinates: [number, number] } }> }
        }
      | undefined
    expect(source?.type).toBe('geojson')
    expect(source?.cluster).toBeFalsy()

    // 中-10：三元组逐格断言（count 与 A 部分落盘的格子一一对应）
    expect((source?.data.features ?? []).map((f) => [f.properties.count, ...f.geometry.coordinates])).toEqual([
      [4210, 139.7, 35.7],
      [1980, 135.8, 34.9],
      [640, 141.3, 43.1],
    ])

    const circle = map.layers.get(HOME_MAP_CELL_CIRCLE_LAYER_ID) as
      | { filter?: unknown; layout?: Record<string, unknown>; paint: Record<string, unknown> }
      | undefined
    expect(circle?.filter).toBeUndefined()
    expect(circle?.paint['circle-radius']).toEqual(['step', ['get', 'count'], 1.5, 100, 2.5, 1000, 3.5])
    expect(circle?.paint['circle-opacity']).toBe(0.7)
    expect(circle?.paint['circle-stroke-width']).toBeUndefined()
  })

  it('点图层不再标数字（没有任何 text-field）', async () => {
    render(<HomeMapTeaser locale="zh" clusters={mapClustersFixture()} />)
    const map = await mounted()

    const circle = map.layers.get(HOME_MAP_CELL_CIRCLE_LAYER_ID) as { layout?: Record<string, unknown> } | undefined
    expect(circle?.layout?.['text-field']).toBeUndefined()
    // 旧的「圆圈里标数字」图层整层不存在了
    expect([...map.layers.keys()].filter((id) => id.includes('count'))).toEqual([])
  })

  it('城市名走独立 symbol 图层：text-field 取当前语言的名字，按 count 排序', async () => {
    render(<HomeMapTeaser locale="ja" clusters={mapClustersFixture()} />)
    const map = await mounted()

    const source = map.sources.get(HOME_MAP_LABEL_SOURCE_ID) as
      | { data: { features: Array<{ properties: Record<string, unknown>; geometry: { coordinates: number[] } }> } }
      | undefined
    expect((source?.data.features ?? []).map((f) => f.properties.ja)).toEqual(['東京', '大阪'])

    const labels = map.layers.get(HOME_MAP_LABEL_LAYER_ID) as
      | { type: string; layout: Record<string, unknown>; paint: Record<string, unknown> }
      | undefined
    expect(labels?.type).toBe('symbol')
    expect(labels?.layout['text-field']).toEqual(['get', 'ja'])
    expect(labels?.layout['text-size']).toBe(11)
    expect(labels?.layout['text-anchor']).toBe('top')
    expect(labels?.layout['text-offset']).toEqual([0, 0.6])
    expect(labels?.layout['symbol-sort-key']).toEqual(['-', 0, ['get', 'count']])
    // 碰撞时按 count 取舍：东京优先，其余城市能挤下就显示
    expect(labels?.layout['text-allow-overlap']).toBe(false)
    expect(labels?.paint['text-halo-width']).toBe(1)
  })

  it('labels 缺省（A3 尚未落盘）时不建标签图层，点照常画', async () => {
    const { labels: _labels, ...withoutLabels } = mapClustersFixture()
    render(<HomeMapTeaser locale="zh" clusters={withoutLabels} />)
    const map = await mounted()

    expect(map.getLayer(HOME_MAP_LABEL_LAYER_ID)).toBeUndefined()
    expect(map.getSource(HOME_MAP_LABEL_SOURCE_ID)).toBeUndefined()
    expect(map.getLayer(HOME_MAP_CELL_CIRCLE_LAYER_ID)).toBeTruthy()
  })

  it('初始视野用核心格子 bounds 一次性 fitBounds（padding 24 / maxZoom 6）', async () => {
    render(<HomeMapTeaser locale="zh" clusters={mapClustersFixture()} />)
    const map = await mounted()

    expect(map.fitBoundsCalls).toHaveLength(1)
    const [[minLng, minLat], [maxLng, maxLat]] = map.fitBoundsCalls[0]![0] as [[number, number], [number, number]]
    // 以头部格子加权质心为中心的正方形（半径 3° + 外扩 1.5°）
    expect((minLng + maxLng) / 2).toBeCloseTo(947453 / 6830, 6)
    expect((minLat + maxLat) / 2).toBeCloseTo(246983 / 6830, 6)
    expect(maxLng - minLng).toBeCloseTo(9, 6)
    expect(maxLat - minLat).toBeCloseTo(9, 6)
    expect(map.fitBoundsCalls[0]![1]).toMatchObject({ padding: 24, maxZoom: 6, animate: false })
  })

  it('fitBounds 不再吃预生成 bbox：海外孤点被排除在初始视野外', async () => {
    render(<HomeMapTeaser locale="zh" clusters={clustersWithOverseasOutliers()} />)
    const map = await mounted()

    const [[minLng, minLat], [maxLng, maxLat]] = map.fitBoundsCalls[0]![0] as [[number, number], [number, number]]
    // 巴黎 (2.35, 48.85) 与纽约 (-74, 40.7) 都不在框内
    expect(minLng).toBeGreaterThan(2.35)
    expect(minLng).toBeGreaterThan(-74)
    expect(maxLat).toBeLessThan(48.85)
    expect(minLat).toBeGreaterThan(20)
    expect(maxLng).toBeLessThan(180)
  })

  it('世界不左右重复渲染：renderWorldCopies 关掉', async () => {
    render(<HomeMapTeaser locale="zh" clusters={mapClustersFixture()} />)
    const map = await mounted()

    expect(map.options.renderWorldCopies).toBe(false)
  })

  it('没有 bbox 也照常 fitBounds（视野只由 cells 决定）', async () => {
    const { bbox: _bbox, ...withoutBbox } = mapClustersFixture()
    render(<HomeMapTeaser locale="zh" clusters={withoutBbox} />)
    const map = await mounted()

    expect(map.fitBoundsCalls).toHaveLength(1)
  })

  it('卸载时销毁地图实例', async () => {
    const view = render(<HomeMapTeaser locale="zh" clusters={mapClustersFixture()} />)
    await waitFor(() => expect(mapState.instances).toHaveLength(1))
    view.unmount()
    expect(mapState.instances[0]!.removed).toBe(true)
  })

  it('MapLibre 只在预览挂载后按需加载（首屏 JS 不含地图库）', async () => {
    render(<HomeMapTeaser locale="zh" clusters={{ generatedAt: '', totalPoints: 0, cells: [] }} />)
    await Promise.resolve()
    expect(mapState.instances).toHaveLength(0)
  })

  it('没有 cells 时整段不渲染（A 部分尚未落盘）', () => {
    const { container } = render(<HomeMapTeaser locale="zh" clusters={{ generatedAt: '', totalPoints: 0, cells: [] }} />)
    expect(container.firstChild).toBeNull()
  })
})
