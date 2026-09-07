'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BookOpen, ChevronRight, Film, MapPin } from 'lucide-react'
import type { Map as MaplibreMap, MapOptions } from 'maplibre-gl'
// 不引 maplibre-gl 的 CSS：这块地图 interactive=false、无控件无 Popup，
// 那份样式表只会白白进首屏 CSS（沿用旧 HomeMapTeaser 的结论）。
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { getRouteMapStyleCandidates } from '@/components/route/mapStyleFailover'
import type { HomeMapCell, HomeMapClusters, HomeMapLabel, HomeStats } from '@/lib/home/types'
import { t } from '@/lib/i18n'
import type { HomeHeroDemoLike } from './heroDemoShape'
import {
  estimateMapLabelWidth,
  formatRoundedTotal,
  formatStatNumber,
  mapDbSubtitle,
  MAP_LABEL_GAP,
  placeMapLabels,
  zoomForWidth,
} from './homeMapDatabaseUtils'

/** maplibre-gl 打包成 UMD：动态 import 后按 interop 形状取实际命名空间 */
type MaplibreModule = { Map: new (options: MapOptions) => MaplibreMap }

function readMaplibreModule(mod: unknown): MaplibreModule | null {
  const ns = mod as { default?: MaplibreModule } & Partial<MaplibreModule>
  if (ns?.default?.Map) return ns.default
  if (typeof ns?.Map === 'function') return ns as MaplibreModule
  return null
}

export const HOME_MAPDB_SOURCE_ID = 'home-mapdb-cells'
export const HOME_MAPDB_GLOW_LAYER_ID = 'home-mapdb-glow'
export const HOME_MAPDB_MID_LAYER_ID = 'home-mapdb-mid'
export const HOME_MAPDB_CORE_LAYER_ID = 'home-mapdb-core'
/** 品牌粉，与首屏同色 */
const CELL_COLOR = '#ec4899'
/**
 * 世界视野中心 [138, 28]：日本略偏中上，下方留出东南亚与澳大利亚，
 * 左侧欧洲、右侧北美西岸都在画面内（配合 renderWorldCopies + zoomForWidth）。
 */
const WORLD_CENTER: [number, number] = [138, 28]

function toCellCollection(cells: HomeMapCell[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: cells.map((cell, index) => ({
      type: 'Feature',
      id: index,
      properties: { count: cell.count },
      geometry: { type: 'Point', coordinates: [cell.lng, cell.lat] },
    })),
  }
}

type LabelChip = { key: string; x: number; y: number; name: string; count: string }

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
 * 第二屏「全球圣地点位数据库」：超大数字 + 世界视角的只读点位地图。
 *
 * 地图沿用旧 HomeMapTeaser 的接入方式（动态 import、interactive=false、
 * WebGL 失败静默降级、卸载 remove），但不再 fitBounds 到日本：
 * 初始就是世界视野，点位用三层 circle（光晕/中间/核心）叠出热力光斑感；
 * 城市名不走 maplibre symbol，而是 load/move/resize 后用 project() 换算成
 * 像素坐标，绝对定位白色小胶囊，按 count 降序做矩形碰撞规避。
 *
 * 性能：IntersectionObserver（rootMargin 400px）进入视口附近才初始化地图，
 * 首屏 chunk 不含 maplibre。cells 为空时整段不渲染。
 */
export default function HomeMapDatabase({
  locale,
  clusters,
  stats,
  demo,
}: {
  locale: SiteLocale
  clusters: HomeMapClusters
  stats?: HomeStats
  demo?: HomeHeroDemoLike
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [labelChips, setLabelChips] = useState<LabelChip[]>([])
  const cells = clusters?.cells ?? []
  const labels = clusters?.labels ?? []

  useEffect(() => {
    const wrap = wrapRef.current
    const container = containerRef.current
    if (!wrap || !container || !cells.length) return

    let disposed = false
    let map: MaplibreMap | null = null
    let started = false
    let cleanupResize: (() => void) | null = null
    const cellData = toCellCollection(cells)

    const start = () => {
      if (started) return
      started = true
      void (async () => {
        // 动态载入：MapLibre 只在这段真的进视口才进包，不压首屏 JS
        let maplibregl: MaplibreModule | null = null
        try {
          maplibregl = readMaplibreModule(await import('maplibre-gl'))
        } catch {
          return
        }
        if (!maplibregl || disposed) return

        const candidate = getRouteMapStyleCandidates()[0]!
        let instance: MaplibreMap
        try {
          instance = new maplibregl.Map({
            container,
            style: candidate.style,
            center: WORLD_CENTER,
            zoom: zoomForWidth(container.clientWidth),
            interactive: false,
            attributionControl: false,
            // 世界左右重复铺满：zoom 1.x 时世界比容器窄，不重复画 MapLibre 就无法把
            // 中心放到日本（会被迫居中在非洲/欧洲）。点位 source 不变，
            // 副本只会在极窄容器时出现，可接受。
            renderWorldCopies: true,
          })
        } catch {
          // WebGL 不可用（老设备/无头环境）：静默降级为纯数字卡片
          return
        }
        if (disposed) {
          instance.remove()
          return
        }
        map = instance

        /** 极简化：把底图的地名文字全部藏起来，画面只剩陆地/水面/国界；raster 兜底样式无 symbol 可隐 */
        const hideSymbolLayers = () => {
          if (candidate.provider === 'raster') return
          try {
            const style = instance.getStyle()
            for (const layer of style?.layers ?? []) {
              if (layer?.type !== 'symbol' || typeof layer.id !== 'string') continue
              try {
                instance.setLayoutProperty(layer.id, 'visibility', 'none')
              } catch {
                // 单层设置失败不阻塞其余图层
              }
            }
          } catch {
            // style 未就绪：跳过，下一次 style.load 再试
          }
        }

        const reposition = () => {
          if (disposed || !labels.length) return
          const candidates = [...labels]
            .sort((a, b) => b.count - a.count)
            .map((label: HomeMapLabel, index) => {
              const point = instance.project([label.lng, label.lat])
              const name = label.name[locale] ?? label.name.zh
              const count = formatStatNumber(label.count, locale)
              return {
                key: `label-${index}`,
                x: point.x,
                y: point.y,
                width: estimateMapLabelWidth(`${name} ${count}`),
                name,
                count,
              }
            })
          setLabelChips(placeMapLabels(candidates))
        }

        const attach = () => {
          hideSymbolLayers()
          if (!instance.getSource(HOME_MAPDB_SOURCE_ID)) {
            instance.addSource(HOME_MAPDB_SOURCE_ID, { type: 'geojson', data: cellData })
          }
          // 三层叠加出「热力光斑」：大半径低透明光晕 + 中间层 + 高透核心点
          const layers: Array<{ id: string; paint: Record<string, unknown> }> = [
            {
              id: HOME_MAPDB_GLOW_LAYER_ID,
              paint: {
                'circle-color': CELL_COLOR,
                'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 2, 6, 100, 12, 1000, 18, 10000, 22],
                'circle-opacity': 0.12,
                'circle-blur': 1,
              },
            },
            {
              id: HOME_MAPDB_MID_LAYER_ID,
              paint: {
                'circle-color': CELL_COLOR,
                'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 2, 2, 100, 4, 1000, 6, 10000, 8],
                'circle-opacity': 0.35,
                'circle-blur': 0.6,
              },
            },
            {
              id: HOME_MAPDB_CORE_LAYER_ID,
              paint: {
                'circle-color': CELL_COLOR,
                'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 2, 1.2, 100, 2, 1000, 3, 10000, 3.5],
                'circle-opacity': 0.9,
                'circle-blur': 0,
              },
            },
          ]
          for (const layer of layers) {
            if (!instance.getLayer(layer.id)) {
              instance.addLayer({
                id: layer.id,
                type: 'circle',
                source: HOME_MAPDB_SOURCE_ID,
                paint: layer.paint,
              } as Parameters<MaplibreMap['addLayer']>[0])
            }
          }
          reposition()
        }

        instance.on('load', attach)
        instance.on('style.load', attach)
        instance.on('move', reposition)
        // idle：初次渲染 settle 后再算一次，兜底 load 时 glyph/sprite 未齐导致的投影偏差
        instance.on('idle', reposition)
        const onWindowResize = () => reposition()
        window.addEventListener('resize', onWindowResize)
        cleanupResize = () => window.removeEventListener('resize', onWindowResize)
      })()
    }

    // 只在进入视口附近后才初始化地图；没有 IntersectionObserver 的环境直接初始化
    if (typeof IntersectionObserver === 'undefined') {
      start()
      return () => {
        disposed = true
        cleanupResize?.()
        map?.remove()
        map = null
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          start()
        }
      },
      { rootMargin: '400px' },
    )
    observer.observe(wrap)

    return () => {
      disposed = true
      observer.disconnect()
      cleanupResize?.()
      map?.remove()
      map = null
    }
    // cells/labels 是预生成静态数据，按长度足以判定变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells.length, labels.length, locale])

  if (!cells.length) return null

  const capsules = stats
    ? [
        { icon: Film, label: t('pages.home.v2.mapDbStatWorks', locale), value: formatStatNumber(stats.works, locale) },
        // 「巡礼点位」用 totalPoints 精确值（City 表条数太少，放这里拖后腿）
        { icon: MapPin, label: t('pages.home.v2.mapDbStatPoints', locale), value: formatStatNumber(clusters.totalPoints, locale) },
        { icon: BookOpen, label: t('pages.home.v2.mapDbStatPosts', locale), value: formatStatNumber(stats.posts, locale) },
      ]
    : null
  const demoItem = demo?.day?.items?.[0] ?? null
  const demoMap = demo?.map ?? null

  return (
    <section id="home-showcase" className="scroll-mt-6">
      <div className="text-center">
        <p className="text-xs font-semibold tracking-wide text-brand-600">{t('pages.home.v2.mapDbEyebrow', locale)}</p>
        <p className="mt-4 text-6xl font-black tracking-tight text-gray-900 sm:text-7xl lg:text-8xl">
          <span className="tabular-nums">{formatRoundedTotal(clusters.totalPoints, locale)}</span>
          <span className="text-brand-600">+</span>
        </p>
        <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl lg:text-4xl">
          {t('pages.home.v2.mapDbTitle', locale)}
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-gray-600 sm:text-base">{mapDbSubtitle(locale, stats)}</p>
      </div>

      {/* 卡片比其它段的 max-w-5xl 略宽（max-w-6xl）：lg 起按视口宽破框，移动端仍是容器全宽不横向溢出 */}
      <div
        ref={wrapRef}
        className="relative mt-8 h-[420px] overflow-hidden rounded-3xl border border-gray-200 bg-gray-50 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.12)] sm:h-[520px] lg:left-1/2 lg:h-[560px] lg:w-[calc(100vw-2rem)] lg:max-w-6xl lg:-translate-x-1/2"
      >
        <div ref={containerRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />

        {/* 城市标签：HTML 胶囊浮层（project 像素坐标 + 碰撞规避），比 symbol 图层更贴合卡片风格 */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {labelChips.map((chip) => (
            <span
              key={chip.key}
              data-map-label={chip.name}
              style={{ left: chip.x, top: chip.y, transform: `translate(-50%, calc(-100% - ${MAP_LABEL_GAP}px))` }}
              className="absolute whitespace-nowrap rounded-full bg-white/95 px-2.5 py-1 text-xs text-gray-700 shadow"
            >
              {chip.name} <span className="font-semibold text-brand-600">{chip.count}</span>
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

        {/* 放大预览小卡：静态截图 + 点位圆点 + 点位条目，全部来自首屏演示数据 */}
        {demoMap && demoItem ? (
          <div className="absolute right-4 top-4 hidden w-72 rounded-2xl bg-white p-2 shadow-xl lg:block">
            <div className="relative overflow-hidden rounded-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={demoMap.src}
                alt=""
                width={demoMap.width}
                height={demoMap.height}
                loading="lazy"
                decoding="async"
                className="block h-auto w-full object-cover"
              />
              <svg
                viewBox={`0 0 ${demoMap.width} ${demoMap.height}`}
                aria-hidden="true"
                focusable="false"
                className="absolute inset-0 h-full w-full"
              >
                {demoMap.markers.map((marker) => (
                  <circle
                    key={marker.itemId}
                    cx={marker.x}
                    cy={marker.y}
                    r={4}
                    fill="#ec4899"
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                ))}
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
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-900">
                {demoItem.titles?.[locale] ?? demoItem.title}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            </div>
            <p className="px-1 pb-1 pt-2 text-[11px] text-gray-500">{t('pages.home.v2.mapInsetHint', locale)}</p>
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
