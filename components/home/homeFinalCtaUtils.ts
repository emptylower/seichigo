import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomeStats } from '@/lib/home/types'
import { t } from '@/lib/i18n'

/**
 * 收尾行动区（HomeFinalCta）的纯函数：点位取整、标题模板拆段、底部统计行。
 * 组件只做渲染与表单提交，这里的一切都能在 node 里直接单测。
 */

/**
 * 点位数取整到万位（en 取整到千位加 k）。
 * 口径与 HomeHero.tsx 的 roundedPoints 一致——HomeHero 本轮不许改，
 * 所以同样逻辑在这里放一份，不 import 它。
 */
export function roundedPoints(points: number | undefined, locale: SiteLocale): string {
  if (!points || points <= 0) return ''
  if (locale === 'en') return `${Math.round(points / 1000)}k`
  return locale === 'ja' ? `${Math.round(points / 10000)}万` : `${Math.round(points / 10000)} 万`
}

/** finalCtaTitle 模板的一段：原文或 {a1}/{a2}/{a3} 对应的 accent 片段 */
export type FinalCtaTitleSegment = { kind: 'text' | 'accent'; text: string }

/** 把「说出{a1}和{a2}，{a3}帮你排好」这类模板拆成文本/粉色片段序列，保持出现顺序 */
export function finalCtaTitleSegments(
  template: string,
  accents: readonly [string, string, string],
): FinalCtaTitleSegment[] {
  const out: FinalCtaTitleSegment[] = []
  const pattern = /\{a([123])\}/g
  let last = 0
  for (let match = pattern.exec(template); match; match = pattern.exec(template)) {
    if (match.index > last) out.push({ kind: 'text', text: template.slice(last, match.index) })
    out.push({ kind: 'accent', text: accents[Number(match[1]) - 1] ?? '' })
    last = match.index + match[0].length
  }
  if (last < template.length) out.push({ kind: 'text', text: template.slice(last) })
  return out
}

/**
 * 底部小字：「全球 {points}+ 巡礼点位 · {works}+ 动漫作品 · 你的专属行程」。
 * points 按 roundedPoints 取整、works 用真实值；stats 缺失（或 points 无效）时
 * 只显示「你的专属行程」这一小节，不把占位符漏到页面上。
 */
export function finalCtaStatsLine(locale: SiteLocale, stats?: HomeStats): string {
  const points = roundedPoints(stats?.points, locale)
  if (!stats || !points) return t('pages.home.v2.finalCtaStatsTail', locale)
  return t('pages.home.v2.finalCtaStatsLine', locale)
    .replace('{points}', points)
    .replace('{works}', String(stats.works))
}
