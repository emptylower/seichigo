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
 *
 * 第十三轮起它不再自成一段，而是由 `HomeHero` 渲染在首屏底部当收尾行，
 * 所以外层是 `div`（不是 `section`）、也不再自带左右内边距，宽度跟首屏网格一样是 `max-w-5xl`。
 * 第十四轮首屏换成插画背景后，卡片改成半透明毛玻璃压在插画上（主次差别只留在图标色）。
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
    <div className="mx-auto w-full max-w-5xl">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map(({ key, href, Icon, title, desc, stats: statLines, primary }) => (
          <Link
            key={key}
            href={href}
            // 首屏性能（2026-09-07）：/plan/start、/map、/posts 改为悬停预取，
            // 避免进视口即预取 RSC payload 与 LCP 图抢带宽
            prefetch={false}
            // 第十四轮：卡片压在插画背景上，统一半透明毛玻璃，hover 时变实
            className={
              primary
                ? 'flex flex-col gap-2 rounded-2xl border border-white/60 bg-white/75 p-4 no-underline shadow-sm backdrop-blur-sm transition-colors hover:border-brand-300 hover:bg-white/90'
                : 'flex flex-col gap-2 rounded-2xl border border-white/60 bg-white/75 p-4 no-underline shadow-sm backdrop-blur-sm transition-colors hover:border-brand-300 hover:bg-white/90'
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
      <div className="mt-2 text-center">
        <Link href={prefixPath('/pricing', locale)} className="text-xs font-medium text-gray-600 no-underline hover:text-brand-600">
          {t('pages.home.v2.entryPricingLink', locale)}
        </Link>
      </div>
    </div>
  )
}
