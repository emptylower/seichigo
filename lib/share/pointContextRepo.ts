import type { SupportedLocale } from '@/lib/i18n/types'

/**
 * 点位 + 作品的一次性读取结果。
 * 注意 AnitabiPoint 没有 note 列，说明文字来自 AnitabiPointI18n.note，缺失时退回 mark
 * （与 lib/anitabi/readDetail.ts:48 的 `localizedNote || row.mark` 同一套规则）。
 */
export type PointContextRow = {
  pointId: string
  /** AnitabiPoint.name（原始名，可能带作品名前缀） */
  name: string
  /** AnitabiPointI18n.name（当前 locale），没有就是 null */
  localizedName: string | null
  /** AnitabiPoint.mark */
  mark: string | null
  /** AnitabiPointI18n.note（当前 locale） */
  localizedNote: string | null
  geoLat: number | null
  geoLng: number | null
  /** AnitabiBangumiI18n.title（当前 locale），没有就是 null */
  localizedBangumiTitle: string | null
  /**
   * 去前缀比对用的作品标题全集：三语 AnitabiBangumiI18n.title +
   * titleZh / titleJaRaw / titleOriginal / titleRomaji / titleEnglish。
   */
  bangumiTitleCandidates: string[]
}

export type PointAddressRow = {
  pointId: string
  addressZh: string | null
  addressEn: string | null
  addressJa: string | null
}

export type SaveAddressInput = PointAddressRow & { source: string }

export interface PointContextRepo {
  findPoint(pointId: string, locale: SupportedLocale): Promise<PointContextRow | null>
  findAddress(pointId: string): Promise<PointAddressRow | null>
  saveAddress(input: SaveAddressInput): Promise<void>
}
