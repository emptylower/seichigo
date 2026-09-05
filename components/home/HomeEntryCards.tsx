import Link from 'next/link'
import { Map as MapIcon, BookOpen, Sparkles } from 'lucide-react'
import { prefixPath } from '@/components/layout/prefixPath'
import { planStartHref } from './planStartHref'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomeStats } from '@/lib/home/types'
import { t } from '@/lib/i18n'

const NUMBER_LOCALE: Record<SiteLocale, string> = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP' }

function formatStat(count: number, label: string, locale: SiteLocale): string {
  return `${new Intl.NumberFormat(NUMBER_LOCALE[locale]).format(count)} ${label}`
}

/**
 * 三个入口：AI 规划（主）、地图探索、巡礼攻略。数字来自库里的真实计数
 * （A 部分 getHomeStats）；stats 缺失时只隐藏数字，入口本身照常可用。
 */
export default function HomeEntryCards({ locale, stats }: { locale: SiteLocale; stats?: HomeStats }) {
  const cards = [
    {
      key: 'plan',
      href: planStartHref(locale),
      Icon: Sparkles,
      title: t('pages.home.v2.entryPlanTitle', locale),
      desc: t('pages.home.v2.entryPlanDesc', locale),
      stats: stats ? [formatStat(stats.points, t('pages.home.v2.statPoints', locale), locale)] : [],
      primary: true,
    },
    {
      key: 'map',
      href: prefixPath('/map', locale),
      Icon: MapIcon,
      title: t('pages.home.v2.entryMapTitle', locale),
      desc: t('pages.home.v2.entryMapDesc', locale),
      stats: stats
        ? [
            formatStat(stats.works, t('pages.home.v2.statWorks', locale), locale),
            formatStat(stats.cities, t('pages.home.v2.statCities', locale), locale),
          ]
        : [],
      primary: false,
    },
    {
      key: 'guides',
      href: prefixPath('/posts', locale),
      Icon: BookOpen,
      title: t('pages.home.v2.entryGuidesTitle', locale),
      desc: t('pages.home.v2.entryGuidesDesc', locale),
      stats: stats ? [formatStat(stats.posts, t('pages.home.v2.statPosts', locale), locale)] : [],
      primary: false,
    },
  ]

  return (
    <section className="mx-auto max-w-5xl px-4 sm:px-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map(({ key, href, Icon, title, desc, stats: statLines, primary }) => (
          <Link
            key={key}
            href={href}
            className={
              primary
                ? 'flex flex-col gap-2 rounded-2xl border border-brand-200 bg-brand-50/60 p-4 no-underline transition-colors hover:border-brand-300'
                : 'flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-4 no-underline transition-colors hover:border-brand-300'
            }
          >
            <span className={primary ? 'inline-flex items-center gap-2 text-brand-600' : 'inline-flex items-center gap-2 text-gray-500'}>
              <Icon className="h-4 w-4" />
              <span className="text-sm font-semibold text-gray-900">{title}</span>
            </span>
            <span className="text-xs leading-relaxed text-gray-600">{desc}</span>
            {statLines.length ? (
              <span className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs font-medium tabular-nums text-brand-600">
                {statLines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  )
}
