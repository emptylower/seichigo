'use client'

import { useEffect, useState } from 'react'
import { Check, Footprints } from 'lucide-react'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomeHeroDemo as HomeHeroDemoData } from '@/lib/home/types'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import { t } from '@/lib/i18n'

const STEP_MS = 900
const STEP_COUNT = 4

/**
 * 规划师微演示：结果卡壳（Day 徽标 + 空行骨架）一开始就在，四个步骤 chip 每 900ms
 * 依次点亮，每点亮一步就把 Day 1 的下一条条目淡入填进壳里（骨架同步减少），
 * 第 4 步点亮后再出现交通线。只跑一轮就停在填满状态，`prefers-reduced-motion`
 * 下直接显示终态。数据来自单独落盘的 home-hero-demo.json（与第二屏展示计划不同
 * 的一份计划），图片是静态化后的站内路径，首屏不发请求。
 */
export default function HomeHeroDemo({ locale, demo }: { locale: SiteLocale; demo?: HomeHeroDemoData }) {
  const reduced = usePrefersReducedMotion()
  const [step, setStep] = useState(0)
  const steps = Array.from({ length: STEP_COUNT }, (_, i) => t(`pages.home.v2.heroDemoStep${i + 1}`, locale))

  // 计数放在 effect 内部而不是靠 step 触发下一个 setTimeout：
  // 链式定时器要等 React 重渲染才排下一棒，节奏会被渲染时机带偏
  useEffect(() => {
    if (reduced) return
    let current = 0
    const timer = setInterval(() => {
      current += 1
      setStep(current)
      if (current >= STEP_COUNT) clearInterval(timer)
    }, STEP_MS)
    return () => clearInterval(timer)
  }, [reduced])

  const items = demo?.day.items ?? []
  if (!items.length) return null

  const lit = reduced ? STEP_COUNT : step
  // 步骤 1/2/3 各填一条；步骤 4 只负责交通线，条目在此之前已填满
  const filled = items.slice(0, Math.min(lit, items.length))
  const skeletons = items.length - filled.length
  const showTransit = lit >= STEP_COUNT && items.length > 1
  const transitLabel = demo?.day.transit.label?.trim() || t('pages.home.v2.heroDemoTransit', locale)

  return (
    <div
      role="group"
      aria-label={t('pages.home.v2.heroDemoLabel', locale)}
      className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm"
    >
      <style>{`
        @keyframes seichigo-demo-row { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        .seichigo-demo-row { animation: seichigo-demo-row 150ms ease-out; }
        @media (prefers-reduced-motion: reduce) { .seichigo-demo-row { animation: none; } }
      `}</style>
      <div className="flex flex-wrap gap-1.5">
        {steps.map((label, index) => {
          const on = index < lit
          return (
            <span
              key={label}
              data-lit={on ? 'true' : 'false'}
              className={
                on
                  ? 'inline-flex items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 transition-colors'
                  : 'inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-400 transition-colors'
              }
            >
              {on ? <Check className="h-3 w-3" /> : null}
              {label}
            </span>
          )
        })}
      </div>

      <div data-testid="hero-demo-card" className="mt-3 rounded-xl border border-gray-100 bg-gray-50/70 p-2.5">
        <span className="inline-flex rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white">
          {t('pages.home.v2.heroDemoDayBadge', locale)}
        </span>
        <ul className="mt-2 space-y-2">
          {filled.map((item, index) => (
            <li key={item.id} data-demo-item className="seichigo-demo-row">
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl}
                  alt=""
                  width={48}
                  height={48}
                  loading="eager"
                  decoding="async"
                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-900">{item.title}</span>
                {item.time ? (
                  <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] tabular-nums text-gray-500">
                    {item.time}
                  </span>
                ) : null}
              </div>
              {index === 0 && showTransit ? (
                <div className="seichigo-demo-row ml-6 mt-2 flex items-center gap-1 text-[11px] text-gray-400">
                  <Footprints className="h-3 w-3" />
                  {transitLabel}
                </div>
              ) : null}
            </li>
          ))}
          {/* 还没填到的行留一条同高的灰骨架，卡片高度从一开始就稳定，不会整体弹出 */}
          {Array.from({ length: skeletons }, (_, index) => (
            <li key={`skeleton-${index}`} data-demo-skeleton aria-hidden="true" className="flex items-center gap-2">
              <span className="h-12 w-12 shrink-0 rounded-lg bg-gray-200/70" />
              <span className="h-3 flex-1 rounded bg-gray-200/70" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
