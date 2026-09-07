import Link from 'next/link'
import { ArrowRight, BookOpen, ChevronRight, Film, MapPin, MousePointerClick } from 'lucide-react'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomeMapWorld, HomeStats } from '@/lib/home/types'
import { t } from '@/lib/i18n'
import type { HomeHeroDemoLike } from './heroDemoShape'
import {
  formatRoundedTotal,
  formatStatNumber,
  mapDbSubtitle,
  mapInsetPointTitle,
  MAP_LABEL_ANCHOR_TRANSFORM,
  placeWorldMapLabels,
} from './homeMapDatabaseUtils'

/** 品牌粉，与首屏同色 */
const MARKER_COLOR = '#ec4899'

/**
 * 「放大预览」小卡里的装饰性圆点：原型允许小卡图像不写实，所以除了
 * demo.map.markers 的真实点位外再撒 8 个假点让画面更像「密密麻麻的数据库」。
 * 坐标写死在 demo.map 的 viewBox（320×240）里，纯装饰、aria-hidden。
 */
const MAP_INSET_DECOR_DOTS: ReadonlyArray<readonly [number, number]> = [
  [24, 48],
  [56, 168],
  [92, 120],
  [140, 196],
  [176, 36],
  [214, 132],
  [258, 200],
  [298, 108],
]

function StatCapsule({ icon: Icon, label, value }: { icon: typeof Film; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/95 px-3 py-2 shadow-lg sm:px-4 sm:py-3">
      <p className="flex items-center gap-1.5 text-[11px] text-gray-500 sm:text-xs">
        <Icon className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-0.5 text-base font-extrabold tracking-tight text-gray-900 sm:text-lg">{value}</p>
    </div>
  )
}

/**
 * 第二屏「全球圣地点位数据库」：超大数字 + 预渲染静态世界地图。
 *
 * 地图不再加载任何瓦片与地图运行库：底图是 A 部分脚本烘焙好的 webp
 * （陆地白、海洋淡蓝、粉色热力点位），城市标签是 HTML 白胶囊，
 * 位置由 `placeWorldMapLabels` 按图片 bounds 换算成百分比并做碰撞规避。
 * 右上角挂「放大预览」小卡（首屏演示数据，< lg 隐藏）。
 *
 * 无任何客户端交互，刻意不标 'use client'：这一段不进首屏 JS。
 * world 为 null（A 部分未落盘）时整段不渲染。
 */
export default function HomeMapDatabase({
  locale,
  world,
  stats,
  demo,
}: {
  locale: SiteLocale
  world: HomeMapWorld | null
  stats?: HomeStats
  demo?: HomeHeroDemoLike
}) {
  if (!world) return null

  const { image } = world
  const labels = placeWorldMapLabels(world.labels, image.bounds, image.width, image.height, locale)
  const capsules = stats
    ? [
        { icon: Film, label: t('pages.home.v2.mapDbStatWorks', locale), value: formatStatNumber(stats.works, locale) },
        // 「巡礼点位」用 totalPoints 精确值（City 表条数太少，放这里拖后腿）
        { icon: MapPin, label: t('pages.home.v2.mapDbStatPoints', locale), value: formatStatNumber(world.totalPoints, locale) },
        { icon: BookOpen, label: t('pages.home.v2.mapDbStatPosts', locale), value: formatStatNumber(stats.posts, locale) },
      ]
    : null
  const demoItem = demo?.day?.items?.[0] ?? null
  const demoMap = demo?.map ?? null
  const demoPointTitle = demoItem ? mapInsetPointTitle(demoItem.title) : null

  return (
    <section id="home-showcase" className="scroll-mt-6">
      <div className="text-center">
        <p className="text-xs font-semibold tracking-wide text-brand-600">{t('pages.home.v2.mapDbEyebrow', locale)}</p>
        <p className="mt-4 text-6xl font-black tracking-tight text-gray-900 sm:text-7xl lg:text-8xl">
          <span className="tabular-nums">{formatRoundedTotal(world.totalPoints, locale)}</span>
          <span className="text-brand-600">+</span>
        </p>
        <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl lg:text-4xl">
          {t('pages.home.v2.mapDbTitle', locale)}
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-gray-600 sm:text-base">{mapDbSubtitle(locale, stats)}</p>
      </div>

      {/* 外层 wrapper 负责 lg 破框且不能 overflow-hidden：「放大预览」小卡要溢出卡片右上边缘，
          所以小卡是卡片的兄弟节点；卡片自己的 overflow-hidden 只裁图片。 */}
      <div className="relative mt-8 lg:left-1/2 lg:w-[calc(100vw-2rem)] lg:max-w-6xl lg:-translate-x-1/2">
        <div className="relative overflow-hidden rounded-3xl border border-gray-200 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.12)]">
          {/* 预渲染世界地图：width/height 写死避免 CLS；移动端 h-72 object-cover 居中裁切，桌面等比全显 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.src}
            srcSet={`${image.src2x} 2x`}
            width={image.width}
            height={image.height}
            loading="lazy"
            decoding="async"
            alt=""
            aria-hidden="true"
            className="h-72 w-full object-cover object-center md:h-auto"
          />

          {/* 城市标签：HTML 胶囊浮层（百分比定位 + 四方位碰撞规避），lg 以下不显示
              （碰撞矩形按桌面 1208px 基准计算，更窄视口下胶囊不等比缩小会失真） */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden lg:block">
            {labels.map((label) => (
              <span
                key={label.key}
                data-map-label={label.name}
                data-map-anchor={label.anchor}
                style={{
                  left: `${label.xPct}%`,
                  top: `${label.yPct}%`,
                  transform: MAP_LABEL_ANCHOR_TRANSFORM[label.anchor],
                }}
                className={`absolute whitespace-nowrap rounded-full bg-white/95 py-1 text-gray-700 shadow ${
                  label.primary ? 'px-3 text-[13px]' : 'px-2.5 text-xs'
                }`}
              >
                {label.name}{' '}
                <span className={label.primary ? 'font-bold text-brand-600' : 'font-semibold text-gray-900'}>
                  {label.countText}
                </span>
              </span>
            ))}
          </div>

          {capsules ? (
            <div className="absolute bottom-4 left-4 hidden gap-3 lg:flex">
              {capsules.map((capsule) => (
                <StatCapsule key={capsule.label} icon={capsule.icon} label={capsule.label} value={capsule.value} />
              ))}
            </div>
          ) : null}

          {/* 底图许可要求的署名（CC BY-SA 3.0） */}
          <p className="absolute bottom-2 right-3 rounded bg-white/75 px-1.5 py-0.5 text-[10px] text-gray-400">
            {image.attribution}
          </p>
        </div>

        {/* 放大预览小卡：静态缩略图 + 点位圆点 + 点位条目，全部来自首屏演示数据；< lg 隐藏 */}
        {demoMap && demoItem && demoPointTitle ? (
          <div className="absolute -right-6 -top-8 hidden w-[300px] rounded-2xl border border-gray-100 bg-white p-3 shadow-xl lg:block">
            <div className="relative overflow-hidden rounded-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={demoMap.src}
                alt=""
                width={demoMap.width}
                height={demoMap.height}
                loading="lazy"
                decoding="async"
                className="h-40 w-full object-cover"
              />
              {/* 点位叠层：slice 与 img 的 object-cover 同口径裁切；markers[0] 是「选中」大点，其余小点，再撒装饰点 */}
              <svg
                viewBox={`0 0 ${demoMap.width} ${demoMap.height}`}
                preserveAspectRatio="xMidYMid slice"
                aria-hidden="true"
                focusable="false"
                className="absolute inset-0 h-full w-full"
              >
                {MAP_INSET_DECOR_DOTS.map(([cx, cy], index) => (
                  <circle key={`decor-${index}`} cx={cx} cy={cy} r={2.5} fill={MARKER_COLOR} opacity={0.55} />
                ))}
                {demoMap.markers.map((marker, index) =>
                  index === 0 ? (
                    <circle
                      key={marker.itemId}
                      cx={marker.x}
                      cy={marker.y}
                      r={6.5}
                      fill={MARKER_COLOR}
                      stroke="#ffffff"
                      strokeWidth={2.5}
                    />
                  ) : (
                    <circle
                      key={marker.itemId}
                      cx={marker.x}
                      cy={marker.y}
                      r={4}
                      fill={MARKER_COLOR}
                      stroke="#ffffff"
                      strokeWidth={1.5}
                    />
                  ),
                )}
              </svg>
              <span className="absolute right-2 top-2 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-gray-700 shadow">
                {t('pages.home.v2.mapInsetArea', locale)}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-gray-100 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={demoItem.imageUrl}
                alt=""
                width={48}
                height={48}
                loading="lazy"
                decoding="async"
                className="h-12 w-12 shrink-0 rounded-lg object-cover"
              />
              <span className="min-w-0 flex-1 line-clamp-1 text-xs font-medium text-gray-900">
                {demoPointTitle.pointName}
                {demoPointTitle.workName ? (
                  <span className="font-normal text-gray-500"> · 《{demoPointTitle.workName}》</span>
                ) : null}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            </div>
            <p className="flex items-center gap-1 px-1 pb-1 pt-2 text-[11px] text-gray-500">
              <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" />
              {t('pages.home.v2.mapInsetHint', locale)}
            </p>
          </div>
        ) : null}
      </div>

      {/* 移动端：统计胶囊改到地图卡片下方横排三格 */}
      {capsules ? (
        <div className="mt-4 grid grid-cols-3 gap-2 lg:hidden">
          {capsules.map((capsule) => (
            <StatCapsule key={capsule.label} icon={capsule.icon} label={capsule.label} value={capsule.value} />
          ))}
        </div>
      ) : null}

      <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-3">
        <Link
          href={prefixPath('/map', locale)}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          {t('pages.home.v2.mapDbCta', locale)}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <p className="text-xs text-gray-500">{t('pages.home.v2.mapDbCtaNote', locale)}</p>
      </div>
    </section>
  )
}
