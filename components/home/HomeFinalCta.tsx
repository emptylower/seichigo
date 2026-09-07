'use client'

import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import HeroLaurel from './HeroLaurel'
import { finalCtaStatsLine, finalCtaTitleSegments } from './homeFinalCtaUtils'
import { planStartHref } from './planStartHref'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomeStats } from '@/lib/home/types'
import { t } from '@/lib/i18n'

/**
 * 四片花瓣：与 HomeHeroBackground 同一套写法——位置/大小/时长全部写死（SSR 与
 * 客户端输出一致），只动 transform/opacity；横幅高度远小于视口，所以位移改用 px
 * 贴合 ~340px 高的卡片，不再用 vh。只在 lg 显示，prefers-reduced-motion 下静止隐藏。
 */
const PETALS = [
  { left: '7%', top: '-10%', size: 16, anim: 1, duration: 12, delay: 0 },
  { left: '28%', top: '-16%', size: 12, anim: 2, duration: 15, delay: 3 },
  { left: '64%', top: '-8%', size: 14, anim: 1, duration: 13, delay: 1.5 },
  { left: '87%', top: '-14%', size: 11, anim: 2, duration: 16, delay: 5 },
] as const

/**
 * 首页收尾行动区（最后一屏）：第一屏插画的横幅卡 + 三个粉色词的大标题 +
 * 与首屏同款式的输入框（提交跳规划师起始页，空输入不提交、输入法组词中的回车不提交）
 * + 底部真实统计小字（两侧各一枝月桂枝）。
 */
export default function HomeFinalCta({ locale, stats }: { locale: SiteLocale; stats?: HomeStats }) {
  const router = useRouter()
  const [text, setText] = useState('')

  const submitLabel = t('pages.home.v2.composerSubmit', locale)
  const segments = finalCtaTitleSegments(t('pages.home.v2.finalCtaTitle', locale), [
    t('pages.home.v2.finalCtaAccent1', locale),
    t('pages.home.v2.finalCtaAccent2', locale),
    t('pages.home.v2.finalCtaAccent3', locale),
  ] as const)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const draft = text.trim()
    if (!draft) return
    router.push(planStartHref(locale, draft))
  }

  return (
    <section>
      <div className="relative h-[300px] overflow-hidden rounded-3xl border border-gray-200 shadow-lg lg:h-[340px]">
        <style>{`
          .seichigo-final-petal { opacity: 0.75; }
          @keyframes seichigo-final-petal-1 {
            from { transform: translate3d(0, -40px, 0) rotate(0deg); }
            to { transform: translate3d(-5vw, 400px, 0) rotate(220deg); }
          }
          @keyframes seichigo-final-petal-2 {
            from { transform: translate3d(0, -40px, 0) rotate(20deg); }
            to { transform: translate3d(4vw, 400px, 0) rotate(-180deg); }
          }
          @media (prefers-reduced-motion: reduce) {
            .seichigo-final-petal { animation: none; opacity: 0; }
          }
        `}</style>

        {/* 背景：复用第一屏的横版插画，压一层白色渐变让中间文案区可读 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/home/hero-bg-landscape.webp"
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-white/75 to-white/55" />

        <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden select-none overflow-hidden lg:block">
          {PETALS.map((petal, index) => (
            <svg
              key={index}
              data-final-cta-petal={index + 1}
              className="seichigo-final-petal absolute"
              style={{
                left: petal.left,
                top: petal.top,
                width: petal.size,
                height: petal.size,
                animation: `seichigo-final-petal-${petal.anim} ${petal.duration}s linear ${petal.delay}s infinite`,
              }}
              viewBox="0 0 24 24"
              focusable="false"
            >
              <path d="M12 1 C17 6 20 12 12 23 C4 12 7 6 12 1 Z" fill="#f9a8d4" opacity="0.85" />
            </svg>
          ))}
        </div>

        {/* 居中内容 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          <p className="text-xs font-semibold tracking-wide text-brand-600">{t('pages.home.v2.finalCtaEyebrow', locale)}</p>
          <h2 className="mt-2 text-balance text-3xl font-extrabold leading-snug tracking-tight text-gray-900 lg:text-5xl">
            {segments.map((segment, index) =>
              segment.kind === 'accent' ? (
                <span key={index} data-final-cta-accent className="text-brand-600">
                  {segment.text}
                </span>
              ) : (
                <Fragment key={index}>{segment.text}</Fragment>
              ),
            )}
          </h2>

          <form
            aria-label={submitLabel}
            onSubmit={handleSubmit}
            className="mt-5 flex w-full max-w-xl flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-lg focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-200 sm:flex-row sm:items-center"
          >
            <input
              type="text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              // 输入法组词期间的回车是「上屏」，不能触发表单提交（与首屏 composer 同一处理）
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
              }}
              placeholder={t('pages.home.v2.composerExample1', locale)}
              className="w-full flex-1 rounded-xl px-3 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              {submitLabel}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>

          <p className="mt-4 flex items-center justify-center gap-3 text-xs tracking-wide text-gray-500 sm:text-sm">
            <HeroLaurel className="shrink-0 text-gray-400" />
            {finalCtaStatsLine(locale, stats)}
            <HeroLaurel className="shrink-0 text-gray-400" mirrored />
          </p>
        </div>
      </div>
    </section>
  )
}
