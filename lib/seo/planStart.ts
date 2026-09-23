import type { Metadata } from 'next'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { buildHreflangAlternates } from '@/lib/seo/alternates'
import { getSiteOrigin } from '@/lib/seo/site'
import { pageCardImage } from '@/lib/og/pageCardUrl'
import { t } from '@/lib/i18n'

const PATHS: Record<SiteLocale, string> = {
  zh: '/plan/start',
  en: '/en/plan/start',
  ja: '/ja/plan/start',
}

/**
 * 三语起始页共用 metadata：title/description/OG/Twitter 取当前语言文案；
 * canonical 与 OG URL 是当前语言的干净路径（不带 draft/locale）；hreflang
 * 三语互返、x-default 指中文。不写 robots——继承根 layout 的公开配置。
 */
export function buildPlanStartMetadata(locale: SiteLocale): Metadata {
  const title = t('pages.planStart.metaTitle', locale)
  const description = t('pages.planStart.metaDescription', locale)
  const path = PATHS[locale]
  const url = new URL(path, getSiteOrigin()).toString()
  return {
    title,
    description,
    alternates: buildHreflangAlternates({
      canonicalPath: path,
      zhPath: PATHS.zh,
      enPath: PATHS.en,
      jaPath: PATHS.ja,
    }),
    openGraph: {
      type: 'website',
      url,
      title,
      description,
      images: [pageCardImage('site', 'home', locale, title)],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [pageCardImage('site', 'home', locale, title)],
    },
  }
}
