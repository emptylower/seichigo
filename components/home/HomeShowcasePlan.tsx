'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { preload } from 'react-dom'
import {
  ArrowRight,
  BedDouble,
  CalendarDays,
  Film,
  Footprints,
  MapPin,
  Route,
  Sparkles,
  Ticket,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import { getSchedule } from '@/app/(authed)/plan/[id]/components/itemPayload'
import { useDayAutoRotate } from '@/app/(authed)/plan/[id]/hooks/useDayAutoRotate'
import { heroDemoItems } from './heroData'
import {
  cityDisplayName,
  defaultDayIndex,
  showcaseCitySlugs,
  showcaseDayDate,
  showcaseItemImage,
  showcaseLodging,
  showcaseOverviewImage,
  showcasePointCount,
  showcaseShortTitle,
  showcaseWorks,
  transitLineText,
  visibleDayTimeline,
} from './homeShowcase'
import { planStartHref } from './planStartHref'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomeShowcase } from '@/lib/home/types'
import type { TripPlanItemView } from '@/lib/tripPlan/view'
import { t } from '@/lib/i18n'

/** 时间轴左列（图标 + 小字）与条目卡右侧浅色胶囊的标签口径：meal 两处不同（用餐 / 美食推荐） */
const TYPE_META: Record<string, { icon: LucideIcon; labelKey: string; tagKey: string }> = {
  point: { icon: MapPin, labelKey: 'planTypePoint', tagKey: 'planTypePoint' },
  meal: { icon: Utensils, labelKey: 'planTypeMeal', tagKey: 'planTagMeal' },
  lodging: { icon: BedDouble, labelKey: 'planTypeLodging', tagKey: 'planTypeLodging' },
  attraction: { icon: Ticket, labelKey: 'planTypeAttraction', tagKey: 'planTypeAttraction' },
  free: { icon: Footprints, labelKey: 'planTypeFree', tagKey: 'planTypeFree' },
}

function typeMeta(item: TripPlanItemView) {
  return TYPE_META[item.type] ?? { icon: Footprints, labelKey: 'planTypeFree', tagKey: 'planTypeFree' }
}

/** 作品名连接符按语言走（zh/ja 的枚举逗号是顿号） */
function joinWorks(works: string[], locale: SiteLocale): string {
  return works.join(locale === 'en' ? ', ' : '、')
}

/**
 * 两行大标题，与 HomeHero 的 heroTitle 同一套 {accent} 模板做法；
 * 额外支持 {br}：桌面固定在这里断行，移动端按容器宽度自然折行。
 */
function PlanTitle({ locale }: { locale: SiteLocale }) {
  const [before = '', after = ''] = t('pages.home.v2.planTitle', locale).split('{accent}')
  const lines = before.split('{br}')
  return (
    <h2 className="text-balance text-3xl font-extrabold leading-snug tracking-tight text-gray-900 lg:text-5xl lg:leading-[1.18]">
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 ? <br className="hidden lg:block" /> : null}
          {line}
        </Fragment>
      ))}
      <span className="text-brand-600">{t('pages.home.v2.planTitleAccent', locale)}</span>
      {after}
    </h2>
  )
}

/** 条目卡左侧缩略图；无图用浅灰占位块。Google 照片署名是使用条款的一部分，不能省 */
function ItemThumb({ item, eager }: { item: TripPlanItemView; eager: boolean }) {
  const { src, attribution } = showcaseItemImage(item)
  if (!src) return <span className="h-16 w-16 shrink-0 rounded-xl bg-gray-100" aria-hidden="true" />
  return (
    <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={64}
        height={64}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className="h-full w-full object-cover"
      />
      {attribution ? (
        <span
          title={attribution}
          className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/45 px-1 text-right text-[8px] leading-tight text-white/95"
        >
          {attribution}
        </span>
      ) : null}
    </span>
  )
}

/**
 * 第三屏：「规划师做出来的行程」逐天展示（content/generated/home-showcase.json 真实数据）。
 * 左栏行程概览（天数/城市/作品/点位/住宿 + 大图 + CTA），右栏 Day 标签 + 时间轴；
 * transit 不做成卡片，只在相邻卡片之间显示一行极小灰字。Day 标签自动轮播，
 * 用户一动就停，reduced-motion 下不转。所有数字/名字都来自 showcase 数据本身。
 */
export default function HomeShowcasePlan({ locale, showcase }: { locale: SiteLocale; showcase: HomeShowcase }) {
  const reduced = usePrefersReducedMotion()
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const days = showcase.days
  // 默认天 = 第一个含 point 条目的天（Day 1 可能没有圣地）；轮播从这天开始往后循环
  const fallbackDayIndex = defaultDayIndex(days)
  const defaultPos = days.findIndex((day) => day.dayIndex === fallbackDayIndex)
  const orderedDays = defaultPos > 0 ? [...days.slice(defaultPos), ...days.slice(0, defaultPos)] : days
  const rotation = useDayAutoRotate({
    enabled: !reduced && days.length > 1,
    dayIndexes: orderedDays.map((day) => day.dayIndex),
    onRotate: setSelectedDay,
  })

  if (!days.length) return null

  // 首帧就要出图：把默认天前 4 张缩略图交给浏览器提前拿，渲染时命中缓存不再空白
  for (const item of heroDemoItems(orderedDays, 4)) preload(item.image, { as: 'image' })

  const active =
    days.find((day) => day.dayIndex === selectedDay) ?? days.find((day) => day.dayIndex === fallbackDayIndex) ?? days[0]!
  const title = showcaseShortTitle(showcase.title)
  const works = showcaseWorks(days)
  const cities = showcaseCitySlugs(days).map((slug) => cityDisplayName(slug, locale))
  const pointCount = showcasePointCount(days)
  const lodging = showcaseLodging(days)
  const dayCountText = t('pages.home.v2.planDays', locale).replace('{n}', String(days.length))
  const overviewImage = showcaseOverviewImage(days)
  const { rows, hiddenCount } = visibleDayTimeline(active.items)

  const infoRows: Array<{ icon: LucideIcon; label: string; value: string }> = [
    { icon: CalendarDays, label: t('pages.home.v2.planDaysLabel', locale), value: dayCountText },
    {
      icon: MapPin,
      label: t('pages.home.v2.planSpots', locale),
      value: t('pages.home.v2.planSpotsValue', locale).replace('{n}', String(pointCount)),
    },
  ]
  if (works.length) infoRows.push({ icon: Film, label: t('pages.home.v2.planWorks', locale), value: joinWorks(works, locale) })
  if (lodging) infoRows.push({ icon: BedDouble, label: t('pages.home.v2.planLodging', locale), value: lodging })

  return (
    <section id="home-plan" className="scroll-mt-6">
      <div className="text-center">
        <p className="text-xs font-semibold tracking-wide text-brand-600">{t('pages.home.v2.planEyebrow', locale)}</p>
        <div className="mt-3">
          <PlanTitle locale={locale} />
        </div>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-gray-600 sm:text-base">
          {t('pages.home.v2.planSubtitle', locale)}
        </p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* 左栏：行程概览 */}
        <div className="self-start rounded-3xl border border-gray-200 bg-white p-6 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.12)]">
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Route className="h-4 w-4 text-brand-600" aria-hidden="true" />
            {t('pages.home.v2.planOverview', locale)}
          </p>
          <p className="mt-3 text-lg font-bold leading-snug tracking-tight text-gray-900 line-clamp-2">{title}</p>
          <p className="mt-1 text-xs text-gray-500">
            {dayCountText}
            {cities.length ? ` · ${cities.join(' · ')}` : ''}
          </p>
          {works.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {works.map((work) => (
                <span key={work} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-700">
                  {work}
                </span>
              ))}
            </div>
          ) : null}
          <dl className="mt-4 space-y-2.5">
            {infoRows.map((row) => (
              <div key={row.label} className="flex items-start gap-2">
                <row.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                <dt className="shrink-0 text-xs text-gray-500">{row.label}</dt>
                <dd className="min-w-0 flex-1 text-right text-xs font-semibold text-gray-900">{row.value}</dd>
              </div>
            ))}
          </dl>
          {overviewImage ? (
            <div className="relative mt-4 hidden overflow-hidden rounded-2xl lg:block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={overviewImage} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2.5 pt-8 text-left">
                <p className="truncate text-sm font-semibold text-white">{title}</p>
                <p className="text-[11px] text-white/80">
                  {dayCountText} · {t('pages.home.v2.planGenerated', locale)}
                </p>
              </div>
            </div>
          ) : null}
          <Link
            href={planStartHref(locale)}
            className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            {t('pages.home.v2.showcaseCta', locale)}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        {/* 右栏：逐天 */}
        <div ref={rotation.containerRef} className="rounded-3xl border border-gray-200 bg-white p-5 shadow-lg lg:p-6">
          <div className="flex items-start gap-3">
            {/* 标签区独立横向滚动（隐藏滚动条），「查看完整行程」固定在行右侧不被挤压 */}
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {days.map((day) => {
                const selected = day.dayIndex === active.dayIndex
                const date = showcaseDayDate(day.date)
                return (
                  <button
                    key={day.dayIndex}
                    type="button"
                    onClick={() => {
                      rotation.stop()
                      setSelectedDay(day.dayIndex)
                    }}
                    className={
                      selected
                        ? 'shrink-0 rounded-full bg-brand-600 px-3.5 py-1.5 text-white'
                        : 'shrink-0 rounded-full bg-gray-100 px-3.5 py-1.5 text-gray-700 transition-colors hover:bg-gray-200'
                    }
                  >
                    <span className="block text-xs font-semibold sm:text-sm">Day {day.dayIndex}</span>
                    {date ? <span className="block text-[10px] tabular-nums opacity-80">{date}</span> : null}
                  </button>
                )
              })}
            </div>
            <Link
              href={planStartHref(locale)}
              className="shrink-0 rounded-full border border-gray-200 px-3.5 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-600"
            >
              {t('pages.home.v2.planViewFull', locale)}
            </Link>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
            <span className="shrink-0 text-sm font-bold text-gray-900">Day {active.dayIndex}</span>
            {active.summary ? (
              <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{active.summary}</span>
            ) : null}
          </div>

          <ol className="mt-4 list-none">
            {rows.map((item, index) => {
              const showLine = index < rows.length - 1
              if (item.type === 'transit') {
                return (
                  <li key={item.id} className="flex gap-3">
                    <div className="w-16 shrink-0" />
                    <div className="relative flex w-4 shrink-0 justify-center">
                      {showLine ? <span aria-hidden="true" className="absolute inset-y-0 w-px bg-gray-200" /> : null}
                    </div>
                    <p className="py-1 text-[11px] text-gray-400">{transitLineText(item, locale)}</p>
                  </li>
                )
              }
              const meta = typeMeta(item)
              const schedule = getSchedule(item)
              return (
                <li key={item.id} className="flex gap-3 pb-3">
                  <div className="w-16 shrink-0 pt-3 text-right">
                    {schedule ? (
                      <p className="text-xs tabular-nums text-gray-500">{schedule.start}</p>
                    ) : null}
                    <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-gray-400">
                      <meta.icon className="h-3 w-3" aria-hidden="true" />
                      {t(`pages.home.v2.${meta.labelKey}`, locale)}
                    </p>
                  </div>
                  <div className="relative flex w-4 shrink-0 justify-center">
                    {showLine ? <span aria-hidden="true" className="absolute inset-y-0 w-px bg-gray-200" /> : null}
                    <span
                      aria-hidden="true"
                      className="relative z-10 mt-4 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3">
                      <ItemThumb item={item} eager={index < 4} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
                        {item.note ? <p className="mt-0.5 truncate text-xs text-gray-500">{item.note}</p> : null}
                      </div>
                      <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">
                        {t(`pages.home.v2.${meta.tagKey}`, locale)}
                      </span>
                    </div>
                  </div>
                </li>
              )
            })}
            {hiddenCount > 0 ? (
              <li className="pt-1 text-center">
                <Link
                  href={planStartHref(locale)}
                  className="text-xs text-gray-500 transition-colors hover:text-brand-600"
                >
                  {t('pages.home.v2.planMore', locale).replace('{n}', String(hiddenCount))} ·{' '}
                  {t('pages.home.v2.planViewFull', locale)}
                </Link>
              </li>
            ) : null}
          </ol>
        </div>
      </div>
    </section>
  )
}
