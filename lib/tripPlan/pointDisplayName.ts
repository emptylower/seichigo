import type { SupportedLocale } from '@/lib/i18n/types'

/**
 * §0.4 点位显示名：zh → 中文译名（无则原名）；ja → 日文原名；en → 英文
 * 译名（无则日文原名，不显示中译名——巡礼导航时原名比中译名更有用）。
 * 空串按无处理。
 */
export function pointDisplayName(
  point: { name: string; nameZh?: string | null; nameEn?: string | null },
  locale: SupportedLocale,
): string {
  if (locale === 'zh') return point.nameZh || point.name
  if (locale === 'en') return point.nameEn || point.name
  return point.name
}
