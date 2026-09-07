import type { Anime } from '@/lib/anime/getAllAnime'
import type { CityLite } from '@/lib/city/db'
import type { PublicPostListItem } from '@/lib/posts/types'
import type { TripPlanDayView } from '@/lib/tripPlan/view'
import type { HomeHeroDemo } from './heroDemo'

/** 首屏微演示形状的单一来源在 lib/home/heroDemo.ts；此处透传给组件侧既有导入路径 */
export type { HomeHeroDemo, HomeHeroDemoItem } from './heroDemo'

export type HomePopularAnimeItem = {
  anime: Anime
  postCount: number
  cover: string | null
}

export type HomePopularCityItem = {
  city: CityLite
  postCount: number
}

/** 首页入口卡的真实计数（A 部分 getHomeStats 提供） */
export type HomeStats = {
  points: number
  works: number
  cities: number
  posts: number
}

/** 首页第二屏展示计划（content/generated/home-showcase.json 落盘快照） */
export type HomeShowcase = {
  revisionId: string
  savedAt: string
  title: string
  summary: string
  days: TripPlanDayView[]
}

export type HomeMapCell = {
  lng: number
  lat: number
  count: number
}

/** 首页地图预览的城市名标签（A3，§0 契约；生成侧最多 8 条按 count 降序，en/ja 缺失回退 zh） */
export type HomeMapLabel = {
  name: { zh: string; en: string; ja: string }
  lng: number
  lat: number
  count: number
}

/** 首页地图预览的 0.1° 网格聚合（content/generated/home-map-clusters.json） */
export type HomeMapClusters = {
  generatedAt: string
  totalPoints: number
  cells: HomeMapCell[]
  /** 城市名标签；可选是为了不强制旧调用方构造，parse 层缺省会补空数组 */
  labels?: HomeMapLabel[]
  /** 由 cells 计算的全球范围 [minLng, minLat, maxLng, maxLat]，供前端一次性 fitBounds；空 cells 时为世界范围 */
  bbox?: [number, number, number, number]
}

/** 静态世界地图图片覆盖的地理范围（等距圆柱投影：经度自 lngStart 向东跨 lngSpan 度，跨 180° 回绕；纬度 latTop 到 latBottom） */
export type HomeMapWorldBounds = {
  lngStart: number
  lngSpan: number
  latTop: number
  latBottom: number
}

/** 静态世界地图上的城市/地区标签（A 部分脚本产物；按 count 降序，primary 只给最大的一条） */
export type HomeMapWorldLabel = {
  key: string
  name: { zh: string; en: string; ja: string }
  count: number
  lng: number
  lat: number
  primary?: boolean
}

/** 首页第二屏静态世界地图（content/generated/home-map-world.json；缺省时前端整段不渲染） */
export type HomeMapWorld = {
  generatedAt: string
  totalPoints: number
  image: {
    src: string
    src2x: string
    width: number
    height: number
    bounds: HomeMapWorldBounds
    attribution: string
  }
  labels: HomeMapWorldLabel[]
}

export type HomePortalData = {
  featured: PublicPostListItem | null
  latestShelf: PublicPostListItem[]
  popularAnime: HomePopularAnimeItem[]
  popularCities: HomePopularCityItem[]
  stats: HomeStats
  showcase: HomeShowcase
  mapClusters: HomeMapClusters
  /** 首屏微演示（content/generated/home-hero-demo.json，§0 第十二轮第三批） */
  heroDemo: HomeHeroDemo
  /** 静态世界地图（content/generated/home-map-world.json）；可选产物，缺失为 null 且不影响其它数据 */
  mapWorld?: HomeMapWorld | null
  guides: PublicPostListItem[]
}
