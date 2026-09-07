import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'

/**
 * MapLibre 在 jsdom 里没有 WebGL：用最小假实例记录 options/source/layer/符号层隐藏调用。
 * IntersectionObserver 在 jsdom 里没有：默认实现为 observe 即回调（立即可见），
 * 个别用例改成手动触发以验证「不进视口不初始化」。
 */
const mapState = vi.hoisted(() => ({
  instances: [] as FakeMapLike[],
  styleLayers: [] as Array<{ id: string; type: string }>,
}))

type FakeMapLike = {
  options: Record<string, unknown>
  sources: Map<string, Record<string, unknown>>
  layers: Map<string, Record<string, unknown>>
  hiddenSymbols: string[]
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
    hiddenSymbols: string[] = []
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
    getStyle() {
      return { layers: mapState.styleLayers }
    }
    setLayoutProperty(id: string, key: string, value: string) {
      if (key === 'visibility' && value === 'none') this.hiddenSymbols.push(id)
    }
    project(lngLat: [number, number]) {
      return { x: (lngLat[0] - 135) * 40, y: 200 - (lngLat[1] - 34) * 40 }
    }
    remove() {
      this.removed = true
    }
  }
  return { default: { Map: FakeMap } }
})

const ioState = vi.hoisted(() => ({ auto: true }))

class FakeIntersectionObserver {
  cb: (entries: Array<{ isIntersecting: boolean }>) => void
  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    this.cb = cb
  }
  observe() {
    if (ioState.auto) this.cb([{ isIntersecting: true }])
  }
  unobserve() {}
  disconnect() {}
}

import HomeMapDatabase, {
  HOME_MAPDB_CORE_LAYER_ID,
  HOME_MAPDB_GLOW_LAYER_ID,
  HOME_MAPDB_MID_LAYER_ID,
  HOME_MAPDB_SOURCE_ID,
} from '@/components/home/HomeMapDatabase'
import { heroDemoFixture, mapClustersFixture, statsFixture } from './fixtures'

/** totalPoints 50597 → 大数字「50,000」 */
function clusters50597() {
  return { ...mapClustersFixture(), totalPoints: 50597 }
}

async function mountedMap() {
  await waitFor(() => expect(mapState.instances).toHaveLength(1))
  const map = mapState.instances[0]!
  await act(async () => {
    map.fire('load')
  })
  return map
}

describe('HomeMapDatabase', () => {
  beforeEach(() => {
    mapState.instances.length = 0
    mapState.styleLayers = []
    ioState.auto = true
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('大数字取整到千位（50597 → 50,000）＋粉色加号，标题与统计胶囊都是真实数据', () => {
    render(<HomeMapDatabase locale="zh" clusters={clusters50597()} stats={statsFixture} demo={heroDemoFixture()} />)

    expect(screen.getByText('50,000')).toBeInTheDocument()
    expect(screen.getByText('+')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '巡礼点位，全部落在地图上' })).toBeInTheDocument()
    // 统计胶囊（桌面浮层 + 移动端横排两处同数据）：作品 1,234 / 巡礼点位 50,597（精确值）/ 攻略 87
    expect(screen.getAllByText('1,234').length).toBe(2)
    expect(screen.getAllByText('50,597').length).toBe(2)
    expect(screen.getAllByText('87').length).toBe(2)
    expect(screen.getAllByText('作品').length).toBe(2)
    expect(screen.getAllByText('巡礼点位').length).toBe(2)
    expect(screen.getAllByText('攻略').length).toBe(2)
    // 副标题由真实数据拼出（不再含城市数）
    expect(screen.getByText(/来自 1,234 部动漫作品 · 每天都在增加/)).toBeInTheDocument()
  })

  it('地图段根 section 带 id="home-showcase"（接住首屏滚动提示），CTA 指向 /map', () => {
    const { container } = render(<HomeMapDatabase locale="zh" clusters={clusters50597()} stats={statsFixture} />)

    expect(container.querySelector('section#home-showcase')).not.toBeNull()
    expect(screen.getByRole('link', { name: /打开地图/ })).toHaveAttribute('href', '/map')
    expect(screen.getByText('免登录，随便逛')).toBeInTheDocument()
  })

  it('进入视口后才初始化地图：世界视野以日本为中心、重复渲染铺满容器、同一个 source 叠三层热力 circle', async () => {
    render(<HomeMapDatabase locale="zh" clusters={clusters50597()} stats={statsFixture} />)
    const map = await mountedMap()

    expect(map.options.interactive).toBe(false)
    expect(map.options.attributionControl).toBe(false)
    // renderWorldCopies=true：zoom 1.x 时世界比容器窄，不重复画 MapLibre 无法把中心放到日本
    expect(map.options.renderWorldCopies).toBe(true)
    expect(map.options.center).toEqual([138, 28])

    const source = map.sources.get(HOME_MAPDB_SOURCE_ID) as
      | { type: string; cluster?: boolean; data: { features: Array<{ properties: { count: number } }> } }
      | undefined
    expect(source?.type).toBe('geojson')
    expect(source?.cluster).toBeFalsy()
    expect(source?.data.features).toHaveLength(3)

    const glow = map.layers.get(HOME_MAPDB_GLOW_LAYER_ID) as { paint: Record<string, unknown> } | undefined
    const mid = map.layers.get(HOME_MAPDB_MID_LAYER_ID) as { paint: Record<string, unknown> } | undefined
    const core = map.layers.get(HOME_MAPDB_CORE_LAYER_ID) as { paint: Record<string, unknown> } | undefined
    expect(glow?.paint['circle-color']).toBe('#ec4899')
    expect(glow?.paint['circle-radius']).toEqual([
      'interpolate',
      ['linear'],
      ['get', 'count'],
      2, 6, 100, 12, 1000, 18, 10000, 22,
    ])
    expect(glow?.paint['circle-opacity']).toBe(0.12)
    expect(glow?.paint['circle-blur']).toBe(1)
    expect(mid?.paint['circle-opacity']).toBe(0.35)
    expect(core?.paint['circle-opacity']).toBe(0.9)
    expect(core?.paint['circle-blur']).toBe(0)
  })

  it('底图的地名 symbol 图层全部隐藏（只剩陆地/水面/国界），非 symbol 不动', async () => {
    // 无 key 时候选兜底是 raster（无 symbol 可隐，组件整步跳过）；给个 key 让首个候选是矢量样式
    vi.stubEnv('NEXT_PUBLIC_MAPTILER_KEY', 'test-key')
    mapState.styleLayers = [
      { id: 'water', type: 'fill' },
      { id: 'place-label', type: 'symbol' },
      { id: 'country-label', type: 'symbol' },
    ]
    render(<HomeMapDatabase locale="zh" clusters={clusters50597()} />)
    const map = await mountedMap()

    expect(map.hiddenSymbols).toEqual(['place-label', 'country-label'])
  })

  it('城市标签是 HTML 胶囊：load 后出、名字按 locale 取、count 粉色、做碰撞规避', async () => {
    render(<HomeMapDatabase locale="zh" clusters={clusters50597()} />)
    await mountedMap()

    // FakeMap.project 返回确定坐标：两个城市标签都在（明显重叠的才会被碰撞规避去掉）
    expect(document.querySelectorAll('[data-map-label]')).toHaveLength(2)
    const tokyo = screen.getByText('4,210')
    expect(tokyo).toHaveClass('text-brand-600')
    expect(tokyo.parentElement?.textContent).toContain('东京')
    expect(screen.getByText('1,980').parentElement?.textContent).toContain('大阪')
  })

  it('IntersectionObserver 不触发时不初始化地图（首屏不为看不见的地图付代价）', async () => {
    ioState.auto = false
    render(<HomeMapDatabase locale="zh" clusters={clusters50597()} />)
    await Promise.resolve()
    expect(mapState.instances).toHaveLength(0)
  })

  it('无 stats 时不渲染统计胶囊，副标题只剩「每天都在增加」', () => {
    render(<HomeMapDatabase locale="zh" clusters={clusters50597()} />)

    expect(screen.queryByText('1,234')).toBeNull()
    expect(screen.getByText('每天都在增加')).toBeInTheDocument()
  })

  it('有 demo.map 时渲染放大预览小卡（截图 + 粉色圆点 + 点位小卡），缺 demo.map 时不渲染', () => {
    const withDemo = render(<HomeMapDatabase locale="zh" clusters={clusters50597()} demo={heroDemoFixture()} />)
    expect(withDemo.container.querySelector('img[src="/images/home/hero-phone-map.webp"]')).not.toBeNull()
    expect(withDemo.container.querySelectorAll('circle').length).toBe(3)
    expect(screen.getByText('东京 · 新宿区')).toBeInTheDocument()
    expect(screen.getByText('须贺神社男坂')).toBeInTheDocument()
    expect(screen.getByText('每一个点都能点开看')).toBeInTheDocument()
    withDemo.unmount()

    const demo = heroDemoFixture()
    delete demo.map
    render(<HomeMapDatabase locale="zh" clusters={clusters50597()} demo={demo} />)
    expect(screen.queryByText('每一个点都能点开看')).toBeNull()
    expect(screen.queryByText('东京 · 新宿区')).toBeNull()
  })

  it('cells 为空时整段不渲染（A 部分尚未落盘），也不初始化地图', async () => {
    const { container } = render(
      <HomeMapDatabase locale="zh" clusters={{ generatedAt: '', totalPoints: 0, cells: [] }} stats={statsFixture} />,
    )
    expect(container.firstChild).toBeNull()
    await Promise.resolve()
    expect(mapState.instances).toHaveLength(0)
  })

  it('卸载时销毁地图实例', async () => {
    const view = render(<HomeMapDatabase locale="zh" clusters={clusters50597()} />)
    await waitFor(() => expect(mapState.instances).toHaveLength(1))
    view.unmount()
    expect(mapState.instances[0]!.removed).toBe(true)
  })
})
