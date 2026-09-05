/**
 * generate-home-map-clusters.mts 的游标分页抽出（第十二轮审查中-12）：
 * fetchPage 注入（脚本侧用 Prisma cursor+skip:1+take 实现），纯生成器
 * 只负责游标推进与坐标过滤，可单测 off-by-one。
 */

export type CoordinateRow = {
  id: string
  lat: number | null
  lng: number | null
  /** A3 城市标签分组用：点位所属 bangumi（AnitabiBangumi.city 提供城市名） */
  bangumiId?: number | null
}

/** 0.1° 网格；第十二轮审查低-4：上限提到 2000（配脚本侧 ≤50KB 落盘断言） */
export const CELL_DEG = 0.1
export const MAX_CELLS = 2000
export const PAGE_SIZE = 5000

/**
 * AnitabiBangumi.city 里的非城市值（生产库实测的占位/国家级写法），分组时丢弃。
 * 生产库 mapping.cityId 全空、City 表无坐标，城市口径只能落在这些字符串上。
 */
const INVALID_CITY_NAMES = new Set([
  '0',
  '日本',
  '日本國',
  '海外',
  '欧洲',
  '中国',
  '北美',
  '美国',
  '韩国',
  '东南亚',
  '全世界',
  '全球',
  '其他',
  '不明',
])

/** 只剥一层行政后缀；'道' 特意不在表内（'北海道' 是专名），'都' 走特例表防止误伤 '京都' */
const CITY_SUFFIXES = ['市', '区', '郡', '町', '村', '县', '県', '府']
const CITY_NAME_OVERRIDES: Record<string, string> = { 东京都: '东京', 東京都: '东京' }

/** AnitabiBangumi.city 是否为可用的城市名（非空、非纯数字、不在黑名单） */
export function isInvalidCityName(city: string | null | undefined): boolean {
  const trimmed = (city ?? '').trim()
  if (!trimmed || trimmed.length <= 1) return true
  if (INVALID_CITY_NAMES.has(trimmed)) return true
  return /^\d+$/.test(trimmed)
}

/** 规范化为短城市名用于展示与 CityAlias.aliasNorm 精确匹配（"京都市"→"京都"、"东京都"→"东京"） */
export function normalizeCityName(city: string): string {
  const trimmed = city.trim()
  const override = CITY_NAME_OVERRIDES[trimmed]
  if (override) return override
  const suffix = CITY_SUFFIXES.find((s) => trimmed.endsWith(s) && trimmed.length - s.length >= 2)
  return suffix ? trimmed.slice(0, trimmed.length - suffix.length) : trimmed
}

/** 城市质心用逐维中位数（抗离群 bangumi：city 标错但点位在外地的少数派不影响） */
export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * 实测日本全域有 ≥2000 个带点位的 0.1° 格子，2000 格全量序列化约 74 KB，
 * 超出 50 KB 文件预算。cells 已按 count 降序：按预算保留热度最高的前 N 格
 * （二分找最大的 N），MAX_CELLS 只是格子数上限、文件预算才是硬约束。
 */
export function trimCellsToByteBudget<T>(
  cells: T[],
  maxBytes: number,
  measure: (cells: T[]) => number
): T[] {
  if (cells.length === 0 || measure(cells) <= maxBytes) return cells

  let lo = 1
  let hi = cells.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(cells.slice(0, mid)) <= maxBytes) lo = mid
    else hi = mid - 1
  }
  return cells.slice(0, lo)
}

/**
 * 游标分页流式读点位坐标：每次把上一页最后一行的 id 作为游标传给
 * fetchPage，遇到空页即止；行内坐标缺失的跳过但仍参与游标推进，
 * bangumiId 存在时随点位一起透传（A3 城市标签分组用）。
 */
export async function* streamPointCoordinates(
  fetchPage: (cursor: string | null) => Promise<CoordinateRow[]>
): AsyncGenerator<{ lat: number; lng: number; bangumiId?: number }> {
  let cursor: string | null = null
  for (;;) {
    const rows = await fetchPage(cursor)
    if (rows.length === 0) return
    for (const row of rows) {
      if (row.lat === null || row.lng === null) continue
      if (row.bangumiId === null || row.bangumiId === undefined) {
        yield { lat: row.lat, lng: row.lng }
        continue
      }
      yield { lat: row.lat, lng: row.lng, bangumiId: row.bangumiId }
    }
    cursor = rows[rows.length - 1]!.id
  }
}
