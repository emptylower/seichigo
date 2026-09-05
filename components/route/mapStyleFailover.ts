import type { StyleSpecification } from 'maplibre-gl'

/**
 * RoutePreviewMap 的 style provider 候选与容错纯逻辑。
 *
 * 与 features/map/anitabi/media.ts 的主地图候选逻辑等价但独立：
 * - 保留 RoutePreviewMap 既有的 MapTiler `dataviz` 样式与单节点 OSM raster fallback（避免视觉回归）；
 * - 不依赖 mega-hook 模块图，可在 node 环境直接单测；
 * - env 在调用时读取（而非模块加载时），便于测试覆盖不同配置组合。
 */

export type RouteMapStyleProvider = 'maptiler' | 'mapbox' | 'stadia' | 'raster'

export interface RouteMapStyleCandidate {
  provider: RouteMapStyleProvider
  label: string
  style: string | StyleSpecification
}

const DEFAULT_PROVIDER_ORDER = 'maptiler,mapbox,stadia,raster'
const MAPTILER_STYLE_ID = 'dataviz'
const MAPBOX_STYLE_ID = 'streets-v12'
const STADIA_STYLE_ID = 'alidade_smooth'

const FAILOVER_TIMEOUT_DEFAULT_MS = 9000
const FAILOVER_TIMEOUT_MIN_MS = 3000
const FAILOVER_TIMEOUT_MAX_MS = 30000

/** 切换 provider 后，旧样式挂起请求仍会触发错误事件；窗口内抑制级联切换，避免竞态连跳。 */
const PROVIDER_SWITCH_SUPPRESS_MS = 2000

function readEnv(name: string): string {
  return String(process.env[name] || '').trim()
}

/** 与 RoutePreviewMap 既有 fallback 完全一致的无 key OSM raster 样式。 */
export function buildOsmRasterStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  }
}

function normalizeProvider(raw: string): RouteMapStyleProvider | null {
  const value = raw.trim().toLowerCase()
  if (value === 'maptiler') return 'maptiler'
  if (value === 'mapbox') return 'mapbox'
  if (value === 'stadia') return 'stadia'
  if (value === 'raster') return 'raster'
  return null
}

function parseProviderOrder(raw: string): RouteMapStyleProvider[] {
  const out: RouteMapStyleProvider[] = []
  const seen = new Set<RouteMapStyleProvider>()
  for (const token of raw.split(',')) {
    const provider = normalizeProvider(token)
    if (!provider || seen.has(provider)) continue
    seen.add(provider)
    out.push(provider)
  }
  if (!seen.has('raster')) out.push('raster')
  return out
}

function buildCandidate(provider: RouteMapStyleProvider): RouteMapStyleCandidate | null {
  if (provider === 'raster') {
    return { provider, label: 'raster', style: buildOsmRasterStyle() }
  }
  if (provider === 'maptiler') {
    const key = readEnv('NEXT_PUBLIC_MAPTILER_KEY')
    if (!key) return null
    return {
      provider,
      label: 'MapTiler',
      style: `https://api.maptiler.com/maps/${MAPTILER_STYLE_ID}/style.json?key=${encodeURIComponent(key)}`,
    }
  }
  if (provider === 'mapbox') {
    const token = readEnv('NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN')
    if (!token) return null
    return {
      provider,
      label: 'Mapbox',
      style: `https://api.mapbox.com/styles/v1/mapbox/${MAPBOX_STYLE_ID}?access_token=${encodeURIComponent(token)}`,
    }
  }
  const key = readEnv('NEXT_PUBLIC_STADIA_MAPS_API_KEY')
  if (!key) return null
  return {
    provider: 'stadia',
    label: 'Stadia',
    style: `https://tiles.stadiamaps.com/styles/${STADIA_STYLE_ID}.json?api_key=${encodeURIComponent(key)}`,
  }
}

/**
 * 按 NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER（默认 maptiler,mapbox,stadia,raster）构建可用候选：
 * 跳过缺少 key 的 provider，去重/忽略未知项，并保证 OSM raster 永远是最后一个候选。
 */
export function getRouteMapStyleCandidates(): RouteMapStyleCandidate[] {
  const orderRaw = readEnv('NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER') || DEFAULT_PROVIDER_ORDER
  const out: RouteMapStyleCandidate[] = []
  for (const provider of parseProviderOrder(orderRaw)) {
    const candidate = buildCandidate(provider)
    if (!candidate) continue
    out.push(candidate)
  }
  if (!out.length || out[out.length - 1]?.provider !== 'raster') {
    out.push({ provider: 'raster', label: 'raster', style: buildOsmRasterStyle() })
  }
  return out
}

/** 与主地图 shared.ts 保持一致的 failover 超时：默认 9000ms，clamp 到 [3000, 30000]。 */
export function getMapStyleFailoverTimeoutMs(): number {
  const parsed = Number.parseInt(readEnv('NEXT_PUBLIC_MAP_STYLE_FAILOVER_TIMEOUT_MS'), 10)
  if (!Number.isFinite(parsed)) return FAILOVER_TIMEOUT_DEFAULT_MS
  return Math.max(FAILOVER_TIMEOUT_MIN_MS, Math.min(FAILOVER_TIMEOUT_MAX_MS, parsed))
}

/** 识别代表认证/服务不可用的 style/资源错误（与主地图 error 判定正则一致）。 */
export function isMapStyleProviderError(message: string | null | undefined): boolean {
  const msg = String(message || '').trim()
  if (!msg) return false
  return /(401|403|429|unauthor|forbidden|access token|api key|quota|rate)/i.test(msg)
}

/**
 * provider 切换状态机：只关心当前候选下标与切换抑制窗口，不触碰 MapLibre。
 * 错误驱动的切换要求距上次切换超过 suppressWindowMs，
 * 使旧样式挂起请求引发的级联错误事件不会连跳多个 provider。
 */
export class RouteMapStyleFailover {
  private readonly candidates: RouteMapStyleCandidate[]
  private readonly suppressWindowMs: number
  private index = 0
  private lastSwitchAt = Number.NEGATIVE_INFINITY

  constructor(candidates: RouteMapStyleCandidate[], suppressWindowMs: number = PROVIDER_SWITCH_SUPPRESS_MS) {
    this.candidates = candidates.length
      ? candidates
      : [{ provider: 'raster', label: 'raster', style: buildOsmRasterStyle() }]
    this.suppressWindowMs = suppressWindowMs
  }

  get currentIndex(): number {
    return this.index
  }

  get current(): RouteMapStyleCandidate {
    return this.candidates[Math.min(this.index, this.candidates.length - 1)]!
  }

  get hasNext(): boolean {
    return this.index < this.candidates.length - 1
  }

  /** 切换到下一个 provider 并返回它；已是最后一个候选时返回 null。 */
  advance(now: number): RouteMapStyleCandidate | null {
    if (!this.hasNext) return null
    this.index += 1
    this.lastSwitchAt = now
    return this.current
  }

  /** 收到疑似 provider 鉴权/服务错误时，是否应立即切换（抑制切换窗口内的级联旧错误）。 */
  shouldAdvanceOnError(message: string | null | undefined, now: number): boolean {
    if (!this.hasNext) return false
    if (!isMapStyleProviderError(message)) return false
    return now - this.lastSwitchAt >= this.suppressWindowMs
  }
}

export type RouteStyleResyncEvent = 'style.load' | 'styledata' | 'load'

export interface RouteStyleResyncParams {
  event: RouteStyleResyncEvent
  /** map.isStyleLoaded() 当前值（style JSON + 全部 source + sprite 均就绪才为 true） */
  styleLoaded: boolean
  /** 自定义路线图层当前是否已在 style 中 */
  layersPresent: boolean
  /** 是否正在同步（防重入） */
  syncing: boolean
  /** 组件是否已卸载 */
  disposed: boolean
}

/**
 * RoutePreviewMap 自定义资源重同步触发判定。
 *
 * MapLibre v5 事件时序（按安装版本源码核实）：
 * - `style.load` 在每次 style JSON 解析完成、内置 layer 创建后同步触发（setStyle 后同样触发），
 *   此时即可安全 addSource/addLayer；但 sprite/tile 可能尚未完成，`isStyleLoaded()` 可能仍为 false，
 *   因此 style.load 不得以 isStyleLoaded() 为前置条件。
 * - `styledata` 在 style 开始变化/加载的多个时点触发，新 style 的首次事件时 isStyleLoaded() 通常为
 *   false，故 styledata 仅在 styleLoaded 为 true 时作为兜底触发。
 * - `load` 仅保证地图实例首次完整渲染（inline 初始 style 的 style.load/styledata 在 Map 构造器内
 *   同步触发、早于监听器注册，初次挂载必须靠 load），不用于 setStyle 后的重同步。
 */
export function shouldResyncRoutePreviewOnStyleEvent(params: RouteStyleResyncParams): boolean {
  if (params.disposed || params.syncing) return false
  // 初次完整加载：保持既有强制同步语义（幂等，marker 会先移除再重建）
  if (params.event === 'load') return true
  // 已同步过的重复事件：幂等跳过
  if (params.layersPresent) return false
  // 每次 style JSON 就绪即允许挂载自定义资源（不依赖 isStyleLoaded）
  if (params.event === 'style.load') return true
  // styledata：仅在 style 完全就绪时兜底
  return params.styleLoaded
}
