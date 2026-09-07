'use client'

import { useState } from 'react'
import { preload } from 'react-dom'
import { useRouter } from 'next/navigation'
import { ArrowRight, ChevronDown } from 'lucide-react'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomeStats } from '@/lib/home/types'
import HeroLaurel from './HeroLaurel'
import HomeEntryCards from './HomeEntryCards'
import HomeHeroBackground from './HomeHeroBackground'
import HomeHeroPhone from './HomeHeroPhone'
import HomeHeroRoute from './HomeHeroRoute'
import HomeWorksTicker from './HomeWorksTicker'
import type { HomeHeroDemoLike } from './heroDemoShape'
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

/**
 * 标题是带 `{accent}` 的两段式模板（第十四轮）：占位前是普通字重、占位处用品牌色。
 * `<br>` 只在 `lg` 生效——桌面固定断在「，」/「、」/「, 」之后成两行，
 * 移动端仍按容器宽度自然折行。
 */
function HeroTitle({ locale }: { locale: SiteLocale }) {
  const [prefix = '', suffix = ''] = t('pages.home.v2.heroTitle', locale).split('{accent}')
  return (
    <h1 className="text-balance text-2xl font-extrabold leading-snug tracking-tight text-gray-900 sm:text-3xl md:text-4xl lg:text-5xl lg:leading-[1.18]">
      {prefix}
      <br className="hidden lg:block" />
      <span data-hero-accent className="text-brand-600">
        {t('pages.home.v2.heroTitleAccent', locale)}
      </span>
      {suffix}
    </h1>
  )
}

function heroSubtitle(locale: SiteLocale, points: number | undefined): string {
  const raw = t('pages.home.v2.heroSubtitle', locale)
  const rounded = roundedPoints(points, locale)
  // 拿不到 stats 时整句去掉第一小节，而不是把 `{points}` 原样漏到页面上
  if (!rounded) return raw.split(' · ').slice(1).join(' · ')
  return raw.replace('{points}', rounded)
}

/**
 * 首屏：本质是 AI 规划师的输入框，几个元素让它"活"起来——打字机占位、
 * 右栏手机里的规划师演示、整屏插画背景 + 压在插画上的巡礼路线、下方作品名滚动条。
 *
 * 第十三轮起首屏在 `lg` 以上锁一整屏（视口高减页眉）：主体网格垂直居中，
 * 三个入口卡收进底部当收尾行，下面一句 slogan，再加一个指向第二屏的滚动提示；
 * 移动端不锁高，按内容流式排。第十四轮把点阵与光斑换成一张插画背景
 * （`HomeHeroBackground`），入口卡改成压在插画上的半透明毛玻璃。
 *
 * 数据全部来自页面已有的 HomePortalData（演示计划 / 热门作品），首屏不额外发请求；
 * 所有动效都尊重 `prefers-reduced-motion`。
 */
export default function HomeHero({
  locale,
  points,
  works = [],
  demo,
  stats,
}: {
  locale: SiteLocale
  points?: number
  works?: string[]
  demo?: HomeHeroDemoLike
  stats?: HomeStats
}) {
  const router = useRouter()
  const reduced = usePrefersReducedMotion()
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)

  // LCP 预载（写法同 HomeShowcasePlan）：移动端首屏两张关键图——竖版背景插画与
  // 手机演示里的静态地图。桌面已达标，且 preload 无法按 media 区分横竖，只预载竖版。
  // 与 HomeHeroBackground 的 PORTRAIT 基名保持一致。
  preload('/images/home/hero-bg-portrait.avif', { as: 'image', fetchPriority: 'high' })
  if (demo?.map) preload(demo.map.src, { as: 'image', fetchPriority: 'high' })

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
    <section className="relative flex flex-col overflow-hidden pt-8 lg:min-h-[calc(100svh-var(--site-header-h))]">
      <HomeHeroBackground />
      <HomeHeroRoute />

      {/* `grid-cols-1` 不是装饰：默认的 auto 轨道会被作品名滚动条的 max-content 撑到 1100+px，
          首屏通栏后没有外层 max-width 兜底，移动端标题与输入框会被 overflow-hidden 切掉 */}
      <div
        data-hero-main
        className="relative mx-auto my-auto grid w-full max-w-5xl grid-cols-1 gap-6 px-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-10"
      >
        <div className="min-w-0 space-y-4">
          <p className="text-xs font-semibold tracking-wide text-brand-600">{t('pages.home.v2.heroBrandLine', locale)}</p>
          <HeroTitle locale={locale} />
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
                className="shrink-0 rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-xs text-gray-600 backdrop-blur-sm transition-colors hover:border-brand-300 hover:bg-white hover:text-brand-600"
              >
                {example}
              </button>
            ))}
          </div>

          <HomeWorksTicker names={works} label={t('pages.home.v2.heroWorksLabel', locale)} />
        </div>

        <HomeHeroPhone locale={locale} demo={demo} />
      </div>

      {/* 首屏收尾行：三个入口卡 + 指向第二屏的滚动提示，让折叠线正好落在这里 */}
      <div data-hero-footer className="relative mx-auto mt-auto w-full max-w-5xl px-4 pb-4 pt-5">
        <HomeEntryCards locale={locale} stats={stats} />
        <style>{`
          @keyframes seichigo-hero-scroll-hint {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(4px); }
          }
          .seichigo-hero-scroll-hint { animation: seichigo-hero-scroll-hint 2s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .seichigo-hero-scroll-hint { animation: none; } }
        `}</style>
        {/* 一句 slogan 压在入口卡下，两侧各一枝月桂枝：桌面首屏才有，移动端首屏本来就不锁一屏 */}
        <p
          data-hero-slogan
          className="mt-5 hidden items-center justify-center gap-3 text-center text-sm tracking-wide text-gray-500 lg:flex"
        >
          <HeroLaurel className="shrink-0 text-gray-400" />
          {t('pages.home.v2.heroSlogan', locale)}
          <HeroLaurel className="shrink-0 text-gray-400" mirrored />
        </p>
        <a
          href="#home-showcase"
          aria-label={t('pages.home.v2.heroScrollHint', locale)}
          className="mx-auto mt-3 hidden h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-brand-600 lg:flex"
        >
          <ChevronDown className="seichigo-hero-scroll-hint h-5 w-5" aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}
