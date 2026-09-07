'use client'

// 这里的 09:41、步行 34 分钟 等文本会被 iOS 数据探测器包成 <a>，破坏 React 水合，
// 所以根布局 app/layout.tsx 的 metadata.formatDetection 全部关掉。

import { useEffect, useState } from 'react'
import { Check, Footprints } from 'lucide-react'
import type { SiteLocale } from '@/components/layout/SiteShell'
import {
  heroDemoMarkers,
  heroDemoTransits,
  heroWalkMinutes,
  type HeroDemoMarker,
  type HomeHeroDemoLike,
} from './heroDemoShape'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import { t } from '@/lib/i18n'

/** 一步 700ms，共 4 步；t0 是挂载那一刻（chip1 已亮），跑完停住不循环 */
export const PHONE_STEP_MS = 700
export const PHONE_STEP_COUNT = 4

/** 三个图钉每 250ms 弹一个；地图路线 1.2s 画完；条目 150ms 逐条淡入 */
const PIN_STEP_MS = 250
const ROUTE_DRAW_MS = 1200
const ROW_FADE_MS = 150

/**
 * 演示进度只切这两组 class：`HIDDEN_CLASS` 保留占位（visibility 而不是 display），
 * 行高从首帧起就固定，元素露出来时不会有跳动。
 */
const HIDDEN_CLASS = 'invisible opacity-0'
const ROW_IN_CLASS = 'seichigo-phone-row'

/** 状态栏时间写死：读 `new Date()` 会让 SSR 与客户端不同串 */
const STATUS_TIME = '09:41'

/** 演示里固定显示 Day 1，与来源计划的实际天序无关（§0） */
const DEMO_DAY_LABEL = 1

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** 相邻两个图钉之间一段二次贝塞尔，控制点取中点再往上抬一点，避免压住图钉 */
function mapRoutePath(markers: readonly HeroDemoMarker[]): string {
  const [first, ...rest] = markers
  if (!first) return ''
  let d = `M ${first.x} ${first.y}`
  let prev = first
  for (const marker of rest) {
    d += ` Q ${round((prev.x + marker.x) / 2)} ${round((prev.y + marker.y) / 2 - 18)} ${marker.x} ${marker.y}`
    prev = marker
  }
  return d
}

function StatusBar() {
  return (
    <div className="flex items-center justify-between px-4 pt-[30px] text-[10px] font-semibold text-gray-800">
      <span className="tabular-nums">{STATUS_TIME}</span>
      <span aria-hidden="true" className="flex items-end gap-[3px]">
        {/* 信号 / Wi-Fi / 电量都是纯 CSS 方块，不引图标库 */}
        <span className="flex items-end gap-[1px]">
          {[3, 5, 7, 9].map((h) => (
            <span key={h} style={{ height: h }} className="w-[2px] rounded-sm bg-gray-800" />
          ))}
        </span>
        <span className="h-[7px] w-[9px] rounded-t-full border-[2px] border-b-0 border-gray-800" />
        <span className="relative h-[8px] w-[16px] rounded-[3px] border border-gray-800">
          <span className="absolute inset-[1.5px] right-[5px] rounded-[1px] bg-gray-800" />
        </span>
      </span>
    </div>
  )
}

/**
 * 首屏右侧的手机演示（第十四轮，替换 `HomeHeroDemo`）：
 * 一台 300×550 的手机壳，屏里跑一遍真实数据的规划过程——
 * 4 个步骤 chip 依次点亮，地图上的编号图钉逐个弹出、路线一笔画出来，
 * 下面的 Day 列表从骨架填成三条条目，最后补上两条交通行与步行总时长，然后停住。
 *
 * 地图是我们自己地图的**静态截图**（`map.src`）加一层 SVG 叠加，
 * 首屏不加载任何地图库、不发额外请求；图片全走站内静态路径。
 * `map` 缺省（A 泳道尚未落盘）时整块地图不渲染，退化成纯列表演示。
 *
 * ## 为什么整棵子树是静态的（2026-09-05 线上崩溃的根因修复）
 *
 * iPhone Chrome 打开 /ja 会自动翻译整页：Google 翻译把文本节点包进 `<font>` 并搬走节点。
 * 之前这里按演示进度**挂载/卸载**骨架行、条目行、交通行和图钉，React 随后调
 * `insertBefore` 时参照节点已经不在原父节点下，抛 `NotFoundError`，整页崩到错误页。
 *
 * 所以现在：**首帧就把所有元素渲染进 DOM，演示进度只切 class**——骨架与条目叠在同一个
 * `<li>` 的两个层里互相顶替，交通行与图钉一直在，靠 `invisible/opacity` 与 `opacity` 属性
 * 控制可见性；`key` 全部取稳定的 `item.id` / 下标。任何时刻都不新增或移除节点，
 * 翻译插件怎么搬都不会让 React 的 DOM 操作落空（全站还有 `TranslateGuard` 兜底）。
 * 壳根节点另外标了 `translate="no"`：演示内容本来就按 locale 出三语，不需要再被翻译一遍。
 *
 * 计时与 `HomeHeroDemo` 同一种写法：计数放在 effect 内部，不靠 state 触发下一棒——
 * 链式定时器要等 React 重渲染才排下一个，节奏会被渲染时机带偏。
 * `prefers-reduced-motion` 下不排定时器，直接渲染终态。
 */
export default function HomeHeroPhone({ locale, demo }: { locale: SiteLocale; demo?: HomeHeroDemoLike }) {
  const reduced = usePrefersReducedMotion()
  const [lit, setLit] = useState(1)

  useEffect(() => {
    if (reduced) return
    let current = 1
    const timer = setInterval(() => {
      current += 1
      setLit(current)
      if (current >= PHONE_STEP_COUNT) clearInterval(timer)
    }, PHONE_STEP_MS)
    return () => clearInterval(timer)
  }, [reduced])

  const items = demo?.day.items ?? []
  if (!items.length) return null

  const step = reduced ? PHONE_STEP_COUNT : lit
  const showPins = step >= 2
  const showItems = step >= 3
  const showTransits = step >= PHONE_STEP_COUNT
  const drawing = !reduced && step >= 3

  const steps = Array.from({ length: PHONE_STEP_COUNT }, (_, i) => t(`pages.home.v2.heroDemoStep${i + 1}`, locale))
  const transits = heroDemoTransits(demo)
  const markers = heroDemoMarkers(demo)
  const map = demo?.map && markers.length ? demo.map : null
  const walkMinutes = heroWalkMinutes(transits)

  const summary = t('pages.home.v2.heroDemoSummary', locale)
    .replace('{day}', String(DEMO_DAY_LABEL))
    .replace('{count}', String(items.length))
  const walkTotal =
    showTransits && walkMinutes > 0
      ? t('pages.home.v2.heroDemoWalkTotal', locale).replace('{minutes}', String(walkMinutes))
      : ''

  return (
    <div
      data-testid="hero-phone"
      data-hero-phone
      // 演示文案已经按 locale 出三语，再让浏览器翻一遍只会搬乱 DOM
      translate="no"
      role="group"
      aria-label={t('pages.home.v2.heroDemoLabel', locale)}
      className="mx-auto h-[550px] w-[300px] shrink-0 rounded-[44px] border-[10px] border-gray-900 bg-gray-900 shadow-2xl"
    >
      <style>{`
        .seichigo-phone-row { animation: seichigo-phone-row ${ROW_FADE_MS}ms ease-out both; }
        @keyframes seichigo-phone-row { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        .seichigo-phone-pin { animation: seichigo-phone-pin 320ms cubic-bezier(0.2, 1.4, 0.4, 1) both; transform-box: fill-box; transform-origin: center; }
        @keyframes seichigo-phone-pin { from { opacity: 0; transform: scale(0.3); } to { opacity: 1; transform: scale(1); } }
        .seichigo-phone-route { stroke-dasharray: 1; stroke-dashoffset: 1; animation: seichigo-phone-route ${ROUTE_DRAW_MS}ms ease-in-out forwards; }
        @keyframes seichigo-phone-route { to { stroke-dashoffset: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .seichigo-phone-row, .seichigo-phone-pin { animation: none; opacity: 1; transform: none; }
          .seichigo-phone-route { animation: none; stroke-dashoffset: 0; }
        }
      `}</style>

      {/* 屏内是纵向 flex：条目列表占剩余高度并自己裁切，
          内容再长也不会把手机壳撑高（首屏在 lg 以上锁一整屏，壳一涨折叠线就跑了） */}
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[34px] bg-white">
        {/* 灵动岛 */}
        <div aria-hidden="true" className="absolute left-1/2 top-[9px] h-[22px] w-[86px] -translate-x-1/2 rounded-full bg-gray-900" />
        <StatusBar />

        {/* 2×2 网格而不是 flex-wrap：四条 chip 文案长短不一，换行后最后一行只剩一个很难看 */}
        <div className="grid grid-cols-2 gap-1.5 px-3 pt-2.5">
          {steps.map((label, index) => {
            const on = index < step
            return (
              <span
                key={`chip-${index}`}
                data-phone-chip={index + 1}
                data-lit={on ? 'true' : 'false'}
                className={
                  on
                    ? 'inline-flex items-center justify-center gap-1 truncate rounded-full border border-brand-300 bg-brand-50 px-2 py-[3px] text-[10px] font-medium text-brand-700 transition-colors'
                    : 'inline-flex items-center justify-center gap-1 truncate rounded-full border border-gray-200 px-2 py-[3px] text-[10px] text-gray-400 transition-colors'
                }
              >
                {/* 勾一直在，只切 display——从前这里是条件渲染，点亮时的 insertBefore
                    正好撞上被翻译搬走的 label 文本节点 */}
                <Check aria-hidden="true" className={on ? 'h-2.5 w-2.5' : 'hidden'} />
                {label}
              </span>
            )
          })}
        </div>

        {map ? (
          <div data-testid="hero-phone-map" className="relative mx-3 mt-2.5 overflow-hidden rounded-xl border border-gray-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={map.src}
              alt=""
              width={map.width}
              height={map.height}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="block h-auto w-full"
            />
            <svg
              viewBox={`0 0 ${map.width} ${map.height}`}
              aria-hidden="true"
              focusable="false"
              className="absolute inset-0 h-full w-full"
            >
              <path
                data-phone-route
                data-shown={showItems ? 'true' : 'false'}
                data-drawing={drawing ? 'true' : 'false'}
                className={drawing ? 'seichigo-phone-route' : undefined}
                d={mapRoutePath(markers)}
                pathLength={1}
                fill="none"
                stroke="#ec4899"
                strokeWidth={3}
                strokeLinecap="round"
                opacity={showItems ? 0.9 : 0}
              />
              {markers.map((marker, index) => (
                <g
                  key={marker.itemId}
                  data-phone-pin={index + 1}
                  data-shown={showPins ? 'true' : 'false'}
                  data-x={marker.x}
                  data-y={marker.y}
                  className={showPins ? 'seichigo-phone-pin' : undefined}
                  style={{ animationDelay: `${index * PIN_STEP_MS}ms` }}
                  opacity={showPins ? 1 : 0}
                >
                  <circle cx={marker.x} cy={marker.y} r={11} fill="#ec4899" stroke="#ffffff" strokeWidth={2.5} />
                  <text
                    x={marker.x}
                    y={marker.y + 4}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={700}
                    fill="#ffffff"
                  >
                    {index + 1}
                  </text>
                </g>
              ))}
            </svg>
            <span className="absolute bottom-0 right-0 bg-white/70 px-1 text-[9px] leading-[13px] text-gray-500">
              {map.attribution}
            </span>
          </div>
        ) : null}

        <p data-testid="hero-phone-summary" className="px-3 pt-2.5 text-[11px] font-medium text-gray-500">
          {walkTotal ? `${summary} · ${walkTotal}` : summary}
        </p>

        <ul className="mt-1.5 min-h-0 flex-1 space-y-1.5 overflow-hidden px-3 pb-3">
          {items.map((item, index) => {
            const transit = transits[index]
            // 三语标题由 A 泳道生成；缺 titles（或缺某个语种）时退回单串 title
            const title = item.titles?.[locale] ?? item.title
            return (
              <li key={item.id}>
                {/* 骨架与条目叠在同一格里互相顶替：不新增/移除节点，行高也从首帧就固定 */}
                <span className="grid">
                  <span
                    data-phone-skeleton
                    data-shown={showItems ? 'false' : 'true'}
                    aria-hidden="true"
                    className={`col-start-1 row-start-1 flex items-center gap-2 ${showItems ? HIDDEN_CLASS : ''}`}
                  >
                    <span className="h-10 w-10 shrink-0 rounded-lg bg-gray-200/80" />
                    <span className="h-2.5 flex-1 rounded bg-gray-200/80" />
                  </span>
                  <span
                    data-phone-item={index + 1}
                    data-shown={showItems ? 'true' : 'false'}
                    aria-hidden={showItems ? undefined : 'true'}
                    className={`col-start-1 row-start-1 flex items-center gap-2 ${showItems ? ROW_IN_CLASS : HIDDEN_CLASS}`}
                    style={{ animationDelay: `${index * ROW_FADE_MS}ms` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.imageUrl}
                      alt=""
                      width={40}
                      height={40}
                      loading="eager"
                      decoding="async"
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                    <span data-phone-title className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-900">
                      {title}
                    </span>
                    {item.time ? (
                      <span className="shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[10px] tabular-nums text-gray-500">
                        {item.time}
                      </span>
                    ) : null}
                  </span>
                </span>
                {transit ? (
                  <span
                    data-phone-transit={index + 1}
                    data-shown={showTransits ? 'true' : 'false'}
                    aria-hidden={showTransits ? undefined : 'true'}
                    className={`ml-5 mt-1 flex items-center gap-1 text-[10px] text-gray-400 ${
                      showTransits ? ROW_IN_CLASS : HIDDEN_CLASS
                    }`}
                  >
                    <Footprints className="h-2.5 w-2.5" />
                    {transit.label}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
