import type { HomeHeroDemoLike } from '@/components/home/heroDemoShape'
import type {
  HomeMapClusters,
  HomeMapWorld,
  HomePopularAnimeItem,
  HomePopularCityItem,
  HomePortalData,
  HomeShowcase,
  HomeStats,
} from '@/lib/home/types'
import type { PublicPostListItem } from '@/lib/posts/types'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

/**
 * 第十二轮落地页的前端 fixture：形状对齐 §0 契约（A 部分落盘的
 * home-showcase.json / home-map-clusters.json 与 getHomeStats 的返回）。
 */
export const statsFixture: HomeStats = { points: 128456, works: 1234, cities: 96, posts: 87 }

function pointItem(id: string, title: string, at: { lat: number; lng: number }, start: string): TripPlanItemView {
  return {
    id,
    sortOrder: 0,
    type: 'point',
    pointId: id,
    timeHint: null,
    title,
    note: null,
    reason: null,
    payload: { schedule: { start, end: start, confidence: 'explicit' } },
    point: { id, name: title, nameZh: title, lat: at.lat, lng: at.lng, image: null },
  } as TripPlanItemView
}

/** 非点位条目（用餐/住宿）：图片走 payload.media，带 Google 照片署名（中-11） */
function mediaItem(
  id: string,
  type: 'meal' | 'lodging',
  title: string,
  media: { displayUrl: string; attribution: string },
): TripPlanItemView {
  return {
    id,
    sortOrder: 0,
    type,
    pointId: null,
    timeHint: null,
    title,
    note: null,
    reason: null,
    payload: { media: { source: 'google_places', ...media } },
    point: null,
  } as TripPlanItemView
}

export function showcaseDaysFixture(): TripPlanDayView[] {
  return [
    {
      id: 'd1',
      dayIndex: 1,
      date: '2026-12-24',
      citySlug: 'tokyo',
      summary: '新宿到代代木的取景地',
      items: [
        pointItem('p1', '须贺神社', { lat: 35.6866, lng: 139.7288 }, '09:00'),
        mediaItem('m1', 'meal', '新宿 · 一兰拉面', {
          displayUrl: '/api/google/place-photo?ref=mealREF',
          attribution: '照片：Kenji Sato',
        }),
        pointItem('p2', '代代木会馆', { lat: 35.6905, lng: 139.7005 }, '11:00'),
      ],
    },
    {
      id: 'd2',
      dayIndex: 2,
      date: '2026-12-25',
      citySlug: 'tokyo',
      summary: '田端与荒川沿线',
      items: [pointItem('p3', '田端站', { lat: 35.7381, lng: 139.7608 }, '10:00')],
    },
    {
      id: 'd3',
      dayIndex: 3,
      date: '2026-12-26',
      citySlug: 'tokyo',
      summary: '台场一日',
      items: [
        pointItem('p4', '台场海滨公园', { lat: 35.6301, lng: 139.7754 }, '13:00'),
        mediaItem('l1', 'lodging', '台场 · 日航酒店', {
          displayUrl: '/api/google/place-photo?ref=lodgingREF',
          attribution: '照片：Mei Tanaka',
        }),
      ],
    },
  ]
}

export function showcaseFixture(): HomeShowcase {
  return {
    revisionId: 'rev-showcase-1',
    savedAt: '2026-09-01T08:30:00Z',
    title: '东京 8 日巡礼',
    summary: '按作品把东京拆成 8 天，含交通与用餐安排。',
    days: showcaseDaysFixture(),
  }
}

/**
 * §0 契约里的城市标签（A3 生成）。`HomeMapClusters` 里 `labels` 是可选字段，
 * A 部分尚未落盘时前端按空数组处理，所以 fixture 单独给出类型。
 */
export type HomeMapLabelFixture = {
  name: { zh: string; en: string; ja: string }
  lng: number
  lat: number
  count: number
}

export function mapLabelsFixture(): HomeMapLabelFixture[] {
  return [
    { name: { zh: '东京', en: 'Tokyo', ja: '東京' }, lng: 139.7, lat: 35.7, count: 4210 },
    { name: { zh: '大阪', en: 'Osaka', ja: '大阪' }, lng: 135.8, lat: 34.9, count: 1980 },
  ]
}

export function mapClustersFixture(): HomeMapClusters & { labels: HomeMapLabelFixture[] } {
  return {
    generatedAt: '2026-09-05T00:00:00Z',
    totalPoints: 128456,
    cells: [
      { lng: 139.7, lat: 35.7, count: 4210 },
      { lng: 135.8, lat: 34.9, count: 1980 },
      { lng: 141.3, lat: 43.1, count: 640 },
    ],
    bbox: [135.8, 34.9, 141.3, 43.1],
    labels: mapLabelsFixture(),
  }
}

/**
 * 静态世界地图（content/generated/home-map-world.json，§1 契约形状）：
 * bounds 与 1x 图尺寸同真实产物。标签放东京/京都/伦敦/首尔/洛杉矶——
 * 东京与京都经度只差 4°、纬度只差 0.7°，在 1208px 基准下矩形相交（京都应被挤掉）；
 * 首尔的纬度比真实值（37.57）北移到 45°：真实坐标下首尔胶囊与东京胶囊相交
 * （Δx≈45px < 两胶囊半宽之和≈81px），会被碰撞规避丢掉，就没法验证「海外标签全在」。
 */
export function mapWorldFixture(): HomeMapWorld {
  return {
    generatedAt: '2026-09-07T08:37:14Z',
    totalPoints: 50597,
    image: {
      src: '/images/home/map-world.webp',
      src2x: '/images/home/map-world@2x.webp',
      width: 1208,
      height: 441,
      bounds: { lngStart: -22, lngSpan: 345, latTop: 74, latBottom: -52 },
      attribution: '底图：TUBS / Wikimedia Commons, CC BY-SA 3.0',
    },
    labels: [
      { key: 'tokyo', name: { zh: '东京', en: 'Tokyo', ja: '東京' }, count: 13959, lng: 139.69, lat: 35.69, primary: true },
      { key: 'kyoto', name: { zh: '京都', en: 'Kyoto', ja: '京都' }, count: 4392, lng: 135.77, lat: 35.01 },
      { key: 'london', name: { zh: '伦敦', en: 'London', ja: 'ロンドン' }, count: 666, lng: -0.13, lat: 51.51 },
      { key: 'los-angeles', name: { zh: '洛杉矶', en: 'Los Angeles', ja: 'ロサンゼルス' }, count: 45, lng: -118.24, lat: 34.05 },
      { key: 'seoul', name: { zh: '首尔', en: 'Seoul', ja: 'ソウル' }, count: 33, lng: 126.98, lat: 45 },
    ],
  }
}

export function postFixture(index: number): PublicPostListItem {
  return {
    source: 'mdx',
    path: `/posts/guide-${index}`,
    title: `巡礼攻略 ${index}`,
    animeIds: [`anime-${index}`],
    localizedAnimeNames: [`作品 ${index}`],
    city: 'tokyo',
    localizedCity: '东京',
    routeLength: `${index + 2} 天`,
    tags: ['tokyo'],
    cover: `/assets/cover-${index}.jpg`,
    publishDate: '2026-08-01',
  }
}

export function guidesFixture(count = 6): PublicPostListItem[] {
  return Array.from({ length: count }, (_, i) => postFixture(i + 1))
}

/** 热门作品：带 en/ja 译名，用来断言滚动条按 locale 取显示名（B1） */
export function popularAnimeFixture(count = 3): HomePopularAnimeItem[] {
  return Array.from({ length: count }, (_, i) => ({
    anime: {
      id: `anime-${i + 1}`,
      name: `作品 ${i + 1}`,
      name_en: `Work ${i + 1}`,
      name_ja: `作品${i + 1}（日）`,
    },
    postCount: 3 + i,
    cover: null,
  }))
}

/**
 * 首屏演示数据（content/generated/home-hero-demo.json，第十四轮 §0 契约形状）：
 * 条目带 `lat/lng`、`transit` 是相邻两点各一条的数组、外加一张静态地图截图 `map`。
 * 类型用组件侧的 `HomeHeroDemoLike`（读取侧宽松形状），
 * 这样同一份 fixture 也能喂给只认旧形状的调用方。
 */
export function heroDemoFixture(): HomeHeroDemoLike {
  return {
    planTitle: '东京 8 日巡礼',
    day: {
      dayIndex: 2,
      summary: '《你的名字》取景地一日',
      items: [
        {
          id: 'h1',
          title: '须贺神社男坂',
          titles: { zh: '须贺神社男坂', en: 'Suga Shrine Steps', ja: '須賀神社の男坂' },
          time: '09:30',
          imageUrl: '/images/showcase/h1.jpg',
          lat: 35.6866,
          lng: 139.7288,
        },
        {
          id: 'h2',
          title: '信浓町步道桥',
          titles: { zh: '信浓町步道桥', en: 'Shinanomachi Footbridge', ja: '信濃町歩道橋' },
          time: '10:20',
          imageUrl: '/images/showcase/h2.jpg',
          lat: 35.6805,
          lng: 139.7205,
        },
        {
          id: 'h3',
          title: '四谷见附桥',
          titles: { zh: '四谷见附桥', en: 'Yotsuya Mitsuke Bridge', ja: '四ツ谷見附橋' },
          time: '11:10',
          imageUrl: '/images/showcase/h3.jpg',
          lat: 35.6862,
          lng: 139.7305,
        },
      ],
      transit: [
        { fromId: 'h1', toId: 'h2', mode: 'walk', label: '步行 · 约 8 分钟' },
        { fromId: 'h2', toId: 'h3', mode: 'walk', label: '步行 · 约 12 分钟' },
      ],
    },
    map: {
      src: '/images/home/hero-phone-map.webp',
      width: 320,
      height: 240,
      markers: [
        { itemId: 'h1', x: 62, y: 88 },
        { itemId: 'h2', x: 158, y: 142 },
        { itemId: 'h3', x: 246, y: 74 },
      ],
      attribution: '© MapTiler © OpenStreetMap contributors',
    },
  }
}

/** 旧形状（`transit` 是单个对象、没有 lat/lng/map）：断言组件对 A 未落盘时的兼容 */
export function heroDemoLegacyFixture(): HomeHeroDemoLike {
  return {
    planTitle: '京吹京都巡礼 3 日',
    day: {
      dayIndex: 1,
      summary: '宇治线一日',
      items: [
        { id: 'h1', title: '宇治桥', time: '09:00', imageUrl: '/images/showcase/h1.jpg' },
        { id: 'h2', title: '京阪宇治站', time: '10:20', imageUrl: '/images/showcase/h2.jpg' },
        { id: 'h3', title: '大吉山展望台', time: '11:30', imageUrl: '/images/showcase/h3.jpg' },
      ],
      transit: { mode: 'walk', label: '步行 12 分钟' },
    },
  }
}

export function popularCitiesFixture(count = 3): HomePopularCityItem[] {
  return Array.from({ length: count }, (_, i) => ({
    city: {
      id: `city-${i + 1}`,
      slug: `city-${i + 1}`,
      name_zh: `城市 ${i + 1}`,
      name_en: `City ${i + 1}`,
      name_ja: `都市 ${i + 1}`,
      description_zh: null,
      description_en: null,
      description_ja: null,
      transportTips_zh: null,
      transportTips_en: null,
      transportTips_ja: null,
      cover: null,
      needsReview: false,
      hidden: false,
    },
    postCount: 2 + i,
  }))
}

export function portalDataFixture(overrides: Partial<HomePortalData> = {}): HomePortalData {
  return {
    featured: postFixture(0),
    latestShelf: guidesFixture(3),
    popularAnime: popularAnimeFixture(),
    popularCities: popularCitiesFixture(),
    stats: statsFixture,
    showcase: showcaseFixture(),
    mapClusters: mapClustersFixture(),
    mapWorld: mapWorldFixture(),
    guides: guidesFixture(6),
    // 组件侧读的是宽松形状 `HomeHeroDemoLike`（lat/lng/transit 都可缺省，兼容 A 落盘前后），
    // 它比 `HomePortalData['heroDemo']` 的必填字段少，所以这里显式转一次。
    heroDemo: heroDemoFixture() as unknown as HomePortalData['heroDemo'],
    ...overrides,
  }
}
