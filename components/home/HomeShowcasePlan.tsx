'use client'

import Link from 'next/link'
import { preload } from 'react-dom'
import { DaymapCard } from '@/app/(authed)/plan/[id]/components/DayCards'
import { heroDemoItems } from './heroData'
import { planStartHref } from './planStartHref'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomeShowcase } from '@/lib/home/types'
import { t } from '@/lib/i18n'

/**
 * 第二屏：真实生成的行程快照（content/generated/home-showcase.json）。
 * 用计划页同一套 DaymapCard 渲染，但走 static：不预取路网、不显示保存/调整
 * 入口、图片只用公开路径；Day 标签自动轮播，用户一动就停。
 */
export default function HomeShowcasePlan({ locale, showcase }: { locale: SiteLocale; showcase: HomeShowcase }) {
  if (!showcase.days.length) return null

  // 首帧就要出图：把 Day 1 前 4 张缩略图交给浏览器提前拿，渲染时命中缓存不再空白
  for (const item of heroDemoItems(showcase.days, 4)) preload(item.image, { as: 'image' })

  return (
    <section className="mx-auto max-w-3xl space-y-3 px-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-l-4 border-brand-500 pl-3">
        <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">{t('pages.home.v2.showcaseTitle', locale)}</h2>
        <Link
          href={planStartHref(locale)}
          className="shrink-0 rounded-full bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
        >
          {t('pages.home.v2.showcaseCta', locale)}
        </Link>
      </div>
      <p className="pl-3 text-sm text-gray-600">{showcase.summary || t('pages.home.v2.showcaseSubtitle', locale)}</p>
      <DaymapCard
        planId="home-showcase"
        daymap={{
          type: 'daymap',
          revisionId: showcase.revisionId,
          savedAt: showcase.savedAt,
          days: showcase.days,
        }}
        static
        autoRotate
      />
    </section>
  )
}
