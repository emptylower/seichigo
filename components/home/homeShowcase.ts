import { getMedia, getTransport } from '@/app/(authed)/plan/[id]/components/itemPayload'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
import { t } from '@/lib/i18n'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

/**
 * 第三屏「规划师行程展示」的纯函数：标题截断、作品名提取、城市名静态表、
 * 交通小行文案、逐天折叠。组件（HomeShowcasePlan.tsx）只做渲染与轮播，
 * 这里的一切都能在 node 里直接单测。
 */

/** 展示行程标题太长（「2026东京圣诞周8日｜…」）：只取「｜/|」之前的部分，取不到就全量 */
export function showcaseShortTitle(title: string): string {
  const cut = title.split(/[｜|]/, 1)[0]?.trim()
  return cut || title.trim()
}

/** point 条目标题的格式是「作品名・点位名」：取「・」之前的部分，去重，最多 max 个 */
export function showcaseWorks(days: TripPlanDayView[], max = 4): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const day of days) {
    for (const item of day.items) {
      if (item.type !== 'point') continue
      const idx = item.title.indexOf('・')
      if (idx <= 0) continue
      const work = item.title.slice(0, idx).trim()
      if (!work || seen.has(work)) continue
      seen.add(work)
      out.push(work)
      if (out.length >= max) return out
    }
  }
  return out
}

/**
 * slug → 三语城市名静态表（客户端组件不能查库）。
 * 表里没有的 slug 由 cityDisplayName 兜底为首字母大写。
 */
const CITY_NAMES: Record<string, { zh: string; en: string; ja: string }> = {
  tokyo: { zh: '东京', en: 'Tokyo', ja: '東京' },
  kyoto: { zh: '京都', en: 'Kyoto', ja: '京都' },
  osaka: { zh: '大阪', en: 'Osaka', ja: '大阪' },
  kamakura: { zh: '镰仓', en: 'Kamakura', ja: '鎌倉' },
  nara: { zh: '奈良', en: 'Nara', ja: '奈良' },
  nagoya: { zh: '名古屋', en: 'Nagoya', ja: '名古屋' },
  yokohama: { zh: '横滨', en: 'Yokohama', ja: '横浜' },
  sapporo: { zh: '札幌', en: 'Sapporo', ja: '札幌' },
  fukuoka: { zh: '福冈', en: 'Fukuoka', ja: '福岡' },
  hakone: { zh: '箱根', en: 'Hakone', ja: '箱根' },
  kobe: { zh: '神户', en: 'Kobe', ja: '神戸' },
  numazu: { zh: '沼津', en: 'Numazu', ja: '沼津' },
  hanno: { zh: '饭能', en: 'Hanno', ja: '飯能' },
  // 当前 showcase 实际用到的两个：迪士尼所在的浦安、镰仓高校前所在的藤泽
  urayasu: { zh: '浦安', en: 'Urayasu', ja: '浦安' },
  fujisawa: { zh: '藤泽', en: 'Fujisawa', ja: '藤沢' },
}

/** 行程覆盖城市：days[].citySlug 去重，保持首次出现的顺序 */
export function showcaseCitySlugs(days: TripPlanDayView[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const day of days) {
    const slug = day.citySlug?.trim()
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
}

export function cityDisplayName(slug: string, locale: SiteLocale): string {
  const entry = CITY_NAMES[slug]
  if (entry) return entry[locale] ?? entry.zh
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

/** 巡礼点位条目数（type === 'point'） */
export function showcasePointCount(days: TripPlanDayView[]): number {
  let count = 0
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'point') count += 1
    }
  }
  return count
}

/** 住宿：标题去重后取第一条；标题自带的「住宿：」前缀剥掉，避免与行首标签重复 */
export function showcaseLodging(days: TripPlanDayView[]): string | null {
  const seen = new Set<string>()
  for (const day of days) {
    for (const item of day.items) {
      if (item.type !== 'lodging') continue
      const name = item.title.replace(/^住宿[:：]\s*/, '').trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      return name
    }
  }
  return null
}

/** 交通方式：walk→步行、train/rail/subway→电车、bus→巴士、其它→交通 */
export function transitModeLabel(mode: string | undefined, locale: SiteLocale): string {
  if (mode === 'walk') return t('pages.home.v2.planTransitWalk', locale)
  if (mode === 'train' || mode === 'rail' || mode === 'subway') return t('pages.home.v2.planTransitTrain', locale)
  if (mode === 'bus') return t('pages.home.v2.planTransitBus', locale)
  return t('pages.home.v2.planTransitOther', locale)
}

/**
 * transit 条目的极小灰字行：「步行 12 分钟 · 0.9 km」。
 * 没有 transport 载荷时退成「→」占位一行。
 */
export function transitLineText(item: TripPlanItemView, locale: SiteLocale): string {
  const transport = getTransport(item)
  if (!transport) return '→'
  const head: string[] = []
  if (transport.mode) head.push(transitModeLabel(transport.mode, locale))
  if (typeof transport.durationMin === 'number' && transport.durationMin > 0) {
    head.push(t('pages.home.v2.planMinutes', locale).replace('{n}', String(Math.round(transport.durationMin))))
  }
  const distance =
    typeof transport.distanceKm === 'number' && transport.distanceKm > 0 ? `${transport.distanceKm} km` : ''
  const text = head.join(' ')
  if (text && distance) return `${text} · ${distance}`
  return text || distance || '→'
}

/** Day 胶囊第二行「MM-DD」：date 为 null（当前数据如此）时不显示第二行，不编日期 */
export function showcaseDayDate(date: string | null): string | null {
  if (!date) return null
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(date)
  if (!match) return null
  return `${match[1]}-${match[2]}`
}

/** 每天最多显示的卡片数（point/meal/lodging/attraction/free 算卡片，transit 不算） */
export const SHOWCASE_MAX_CARDS = 6

/**
 * 逐天列表的可见行：按 sortOrder 排，收满 maxCards 张卡片为止
 * （transit 随行显示）；结尾多余的 transit 行裁掉，剩下的折叠成「还有 n 项」。
 */
export function visibleDayTimeline(
  items: TripPlanItemView[],
  maxCards = SHOWCASE_MAX_CARDS,
): { rows: TripPlanItemView[]; hiddenCount: number } {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder)
  const totalCards = sorted.filter((item) => item.type !== 'transit').length
  if (totalCards <= maxCards) return { rows: sorted, hiddenCount: 0 }

  let cards = 0
  let cut = sorted.length
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.type === 'transit') continue
    cards += 1
    if (cards === maxCards) {
      cut = i + 1
      break
    }
  }
  const rows = sorted.slice(0, cut)
  while (rows.length && rows[rows.length - 1]!.type === 'transit') rows.pop()
  return { rows, hiddenCount: totalCards - maxCards }
}

/**
 * 条目缩略图：payload.media.displayUrl（生成时已静态化的站内路径）优先；
 * 只有 point.image 站外直链时走公开代理（与 ItemThumbnail.staticImageSrc 同口径——
 * 静态 <img> 没有 ResilientMapImage 的候选梯，直链会 403）。
 */
export function showcaseItemImage(item: TripPlanItemView): { src: string | null; attribution: string | null } {
  const media = getMedia(item)
  if (media?.displayUrl) return { src: media.displayUrl, attribution: media.attribution ?? null }
  const raw = item.point?.image ?? null
  if (!raw) return { src: null, attribution: null }
  return { src: getMapDisplayImageCandidates(raw, { kind: 'point-thumbnail' })[0] ?? null, attribution: null }
}
