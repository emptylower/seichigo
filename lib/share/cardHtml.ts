import type { SupportedLocale } from '@/lib/i18n/types'
import { SHARE_CARD_SIZES, type ShareCardLayout } from '@/lib/share/types'

/**
 * 版面常量：由下线前的 canvas 常量一比一转成 CSS 用的数值。
 * 对照来源见 components/share/pointShareCardDraw.ts 的 CAPSULE_METRICS /
 * CARD_ROW_METRICS / CARD_FOOTER_SIZES / buildCardLayout。
 * 断行与省略号一律交给浏览器（flex + -webkit-line-clamp），不再手算几何。
 */
export type CardMetrics = {
  width: number
  height: number
  /** 主视觉：横版是左列宽度，竖版是顶部高度 */
  visual: number
  /** 右列（横版）/ 文字区（竖版）的左内边距 */
  columnLeft: number
  /** 右内边距 */
  columnRight: number
  /** 文字区上内边距 */
  columnTop: number
  /** 页脚下内边距 */
  columnBottom: number
  /** 竖版画布安全边距（左右同值），横版为 0（用 columnLeft/Right） */
  padding: number
  nameSize: number
  nameLines: number
  nameGap: number
  animeSize: number
  animeGap: number
  addressSize: number
  addressGap: number
  noteSize: number
  noteLines: number
  capsuleRadius: number
  capsulePadV: number
  capsulePadH: number
  capsuleGap: number
  outlineSize: number
  qrSize: number
  qrPad: number
  qrRadius: number
  titleSize: number
  coordSize: number
  subSize: number
  titleGap: number
  subGap: number
  /** 文字区与胶囊之间的最小间距 */
  capsuleTopGap: number
  footerSize: number
  taglineSize: number
  footerGap: number
}

export const CARD_METRICS: Readonly<Record<ShareCardLayout, CardMetrics>> = {
  portrait: {
    width: SHARE_CARD_SIZES.portrait.width,
    height: SHARE_CARD_SIZES.portrait.height,
    visual: 640,
    columnLeft: 64,
    columnRight: 64,
    columnTop: 36,
    columnBottom: 36,
    padding: 64,
    nameSize: 60,
    nameLines: 2,
    nameGap: 10,
    animeSize: 38,
    animeGap: 14,
    addressSize: 34,
    addressGap: 12,
    noteSize: 32,
    noteLines: 2,
    capsuleRadius: 24,
    capsulePadV: 24,
    capsulePadH: 28,
    capsuleGap: 24,
    outlineSize: 180,
    qrSize: 180,
    qrPad: 6,
    qrRadius: 12,
    titleSize: 34,
    coordSize: 28,
    subSize: 22,
    titleGap: 12,
    subGap: 10,
    capsuleTopGap: 24,
    footerSize: 30,
    taglineSize: 24,
    footerGap: 24,
  },
  landscape: {
    width: SHARE_CARD_SIZES.landscape.width,
    height: SHARE_CARD_SIZES.landscape.height,
    visual: 640,
    // 线上横版右列起点 x=672，主视觉宽 640 → 左内边距 32；右边距 36
    columnLeft: 32,
    columnRight: 36,
    columnTop: 34,
    columnBottom: 14,
    padding: 36,
    nameSize: 40,
    nameLines: 1,
    nameGap: 12,
    animeSize: 26,
    animeGap: 12,
    addressSize: 24,
    addressGap: 10,
    noteSize: 22,
    noteLines: 2,
    capsuleRadius: 16,
    capsulePadV: 14,
    capsulePadH: 16,
    capsuleGap: 14,
    outlineSize: 100,
    qrSize: 100,
    qrPad: 4,
    qrRadius: 8,
    titleSize: 22,
    coordSize: 19,
    subSize: 15,
    titleGap: 8,
    subGap: 6,
    capsuleTopGap: 16,
    footerSize: 20,
    taglineSize: 16,
    footerGap: 16,
  },
}

/** 会破坏 HTML 结构的五个字符；卡片文本全部来自数据库与用户上传，一律过这道 */
export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * anitabi 的 `s` 是场景出现的秒数；纯数字时格式化为 mm:ss（超过一小时为
 * h:mm:ss），否则原样返回。行为与下线前的
 * components/share/PointShareCard.tsx:209-218 完全一致。
 */
export function formatSceneTime(scene: string): string {
  const raw = String(scene).trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) return raw
  const total = Math.floor(Number(raw))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 作品行：《作品名》 · 第 N 集 · mm:ss，缺哪段就少哪段（同 PointShareCard.tsx:188-205） */
export function buildAnimeMetaLine(input: {
  locale: SupportedLocale
  animeTitle: string
  episode: string | null
  /** 场景时间：纯数字秒数会先过 formatSceneTime，已格式化的值原样保留 */
  scene: string | null
}): string {
  const parts: string[] = []
  const title = String(input.animeTitle || '').trim()
  if (title) {
    parts.push(input.locale === 'en' ? title : input.locale === 'ja' ? `『${title}』` : `《${title}》`)
  }
  if (input.episode) {
    parts.push(
      input.locale === 'en'
        ? `EP ${input.episode}`
        : input.locale === 'ja'
          ? `第${input.episode}話`
          : `第 ${input.episode} 集`,
    )
  }
  if (input.scene) parts.push(formatSceneTime(input.scene))
  return parts.join(' · ')
}
