'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomeHeroDemo as HomeHeroDemoData, HomeMapCell } from '@/lib/home/types'
import HomeHeroDemo from './HomeHeroDemo'
import HomeHeroDots from './HomeHeroDots'
import HomeWorksTicker from './HomeWorksTicker'
import { planStartHref } from './planStartHref'
import { useTypewriterPlaceholder } from './HomeHeroTypewriter'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import { t } from '@/lib/i18n'

/** 副标题里的点位数取整到万位（en 取整到千位加 k），不要精确数字压住这句话 */
function roundedPoints(points: number | undefined, locale: SiteLocale): string {
  if (!points || points <= 0) return ''
  if (locale === 'en') return `${Math.round(points / 1000)}k`
  return locale === 'ja' ? `${Math.round(points / 10000)}万` : `${Math.round(points / 10000)} 万`
}

function heroSubtitle(locale: SiteLocale, points: number | undefined): string {
  const raw = t('pages.home.v2.heroSubtitle', locale)
  const rounded = roundedPoints(points, locale)
  // 拿不到 stats 时整句去掉第一小节，而不是把 `{points}` 原样漏到页面上
  if (!rounded) return raw.split(' · ').slice(1).join(' · ')
  return raw.replace('{points}', rounded)
}

/**
 * 首屏：本质是 AI 规划师的输入框，四个元素让它"活"起来——打字机占位、
 * 右栏规划师微演示、右上角点阵地图背景、下方作品名滚动条。
 * 数据全部来自页面已有的 HomePortalData（展示计划 / 地图网格 / 热门作品），
 * 首屏不额外发请求；所有动效都尊重 `prefers-reduced-motion`。
 */
export default function HomeHero({
  locale,
  points,
  works = [],
  demo,
  dots,
}: {
  locale: SiteLocale
  points?: number
  works?: string[]
  demo?: HomeHeroDemoData
  dots?: { cells: HomeMapCell[]; bbox?: [number, number, number, number] }
}) {
  const router = useRouter()
  const reduced = usePrefersReducedMotion()
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)

  const submitLabel = t('pages.home.v2.composerSubmit', locale)
  const staticPlaceholder = t('pages.home.v2.composerPlaceholder', locale)
  const examples = [
    t('pages.home.v2.composerExample1', locale),
    t('pages.home.v2.composerExample2', locale),
    t('pages.home.v2.composerExample3', locale),
  ]

  // 用户一聚焦或输入就停下打字机，交回静态占位；reduced-motion 下直接显示第一条
  const typed = useTypewriterPlaceholder(examples, { enabled: !reduced && !focused && !text })
  const placeholder = reduced ? examples[0]! : typed || staticPlaceholder

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const draft = text.trim()
    if (!draft) return
    router.push(planStartHref(locale, draft))
  }

  return (
    <section className="relative overflow-hidden px-4 pt-10 sm:px-6 sm:pt-14">
      {dots?.cells.length ? (
        <div className="pointer-events-none absolute -right-20 -top-8 h-56 w-56 select-none sm:-right-8 sm:h-80 sm:w-80 lg:right-4">
          <HomeHeroDots cells={dots.cells} bbox={dots.bbox} />
        </div>
      ) : null}

      <div className="relative mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-10">
        <div className="space-y-4">
          <p className="text-xs font-semibold tracking-wide text-brand-600">{t('pages.home.v2.heroBrandLine', locale)}</p>
          <h1 className="text-balance text-2xl font-extrabold leading-snug tracking-tight text-gray-900 sm:text-3xl md:text-4xl">
            {t('pages.home.v2.heroTitle', locale)}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-gray-600">{heroSubtitle(locale, points)}</p>

          <form
            aria-label={submitLabel}
            onSubmit={handleSubmit}
            className="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-lg focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-200 sm:flex-row sm:items-center"
          >
            <input
              type="text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              // 中-2：输入法组词期间的回车是「上屏」，不能让它触发表单提交
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
              }}
              placeholder={placeholder}
              className="w-full flex-1 rounded-xl px-3 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              {submitLabel}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {/* 移动端优先：chip 横向滚动，不换行挤压输入框 */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setText(example)}
                className="shrink-0 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-600"
              >
                {example}
              </button>
            ))}
          </div>

          <HomeWorksTicker names={works} label={t('pages.home.v2.heroWorksLabel', locale)} />
        </div>

        <HomeHeroDemo locale={locale} demo={demo} />
      </div>
    </section>
  )
}
