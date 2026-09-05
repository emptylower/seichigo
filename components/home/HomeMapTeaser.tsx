'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import type { LngLatBoundsLike, Map as MaplibreMap, MapOptions } from 'maplibre-gl'
// 不引 maplibre-gl 的 CSS：这块预览 interactive=false、无控件无 Popup，
// 那份样式表只会白白进首屏 CSS（高-2）。
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { getRouteMapStyleCandidates } from '@/components/route/mapStyleFailover'
import { computeCoreBounds } from '@/components/home/mapTeaserBounds'
import type { HomeMapCell, HomeMapClusters } from '@/lib/home/types'
import { t } from '@/lib/i18n'

/** maplibre-gl 打包成 UMD：动态 import 后按 interop 形状取实际命名空间 */
type MaplibreModule = { Map: new (options: MapOptions) => MaplibreMap }

function readMaplibreModule(mod: unknown): MaplibreModule | null {
  const ns = mod as { default?: MaplibreModule } & Partial<MaplibreModule>
  if (ns?.default?.Map) return ns.default
  if (typeof ns?.Map === 'function') return ns as MaplibreModule
  return null
}

const JAPAN_CENTER: [number, number] = [138.2, 37.6]
const JAPAN_ZOOM = 3.6
const NUMBER_LOCALE: Record<SiteLocale, string> = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP' }

export const HOME_MAP_CELL_SOURCE_ID = 'home-map-cells'
export const HOME_MAP_CELL_CIRCLE_LAYER_ID = 'home-map-cell-circles'
export const HOME_MAP_LABEL_SOURCE_ID = 'home-map-labels'
export const HOME_MAP_LABEL_LAYER_ID = 'home-map-label-symbols'
/** 品牌粉，与首屏点阵同色 */
const CELL_COLOR = '#ec4899'

/**
 * §0 契约里的城市标签（A3 生成，最多 8 条）。`HomeMapClusters` 里是可选字段，
 * A 部分尚未落盘时这里读到 undefined，按空数组处理、不建标签图层。
 */
export type HomeMapLabel = {
  name: { zh: string; en: string; ja: string }
  lng: number
  lat: number
  count: number
}

export function readHomeMapLabels(clusters: HomeMapClusters): HomeMapLabel[] {
  const raw = (clusters as { labels?: unknown }).labels
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is HomeMapLabel => {
    const label = item as Partial<HomeMapLabel>
    return (
      Number.isFinite(label?.lng) &&
      Number.isFinite(label?.lat) &&
      Number.isFinite(label?.count) &&
      typeof label?.name?.zh === 'string'
    )
  })
}

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

function toLabelCollection(labels: HomeMapLabel[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: labels.map((label, index) => ({
      type: 'Feature',
      id: index,
      properties: { zh: label.name.zh, en: label.name.en ?? label.name.zh, ja: label.name.ja ?? label.name.zh, count: label.count },
      geometry: { type: 'Point', coordinates: [label.lng, label.lat] },
    })),
  }
}

/**
 * 首页地图预览：只读（interactive=false、无控件）的点位图，数据是预生成的
 * 0.1° 网格（content/generated/home-map-clusters.json），不碰主地图那条重链路。
 *
 * 呈现口径（第十二轮第二批）：**不聚类、不标数字**——每个格子只画一个细点，
 * 密度自己会显形；城市名另起一个 symbol 图层，靠它读出"这是哪儿"。
 * 初始视野走 `computeCoreBounds(cells)`：预生成的 bbox 被少数海外格子撑成全球范围，
 * 直接用会把预览缩到整个地球；这里只框覆盖 97% 点位的核心区，并关掉世界重复渲染。
 */
export default function HomeMapTeaser({ locale, clusters }: { locale: SiteLocale; clusters: HomeMapClusters }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cells = clusters?.cells ?? []
  const labels = readHomeMapLabels(clusters)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !cells.length) return

    let disposed = false
    let map: MaplibreMap | null = null
    const cellData = toCellCollection(cells)
    const labelData = labels.length ? toLabelCollection(labels) : null

    void (async () => {
      // 动态载入：MapLibre 只在这块预览真的挂载时才进包，不压首屏 JS
      let maplibregl: MaplibreModule | null = null
      try {
        maplibregl = readMaplibreModule(await import('maplibre-gl'))
      } catch {
        return
      }
      if (!maplibregl || disposed) return

      let instance: MaplibreMap
      try {
        instance = new maplibregl.Map({
          container,
          style: getRouteMapStyleCandidates()[0]!.style,
          center: JAPAN_CENTER,
          zoom: JAPAN_ZOOM,
          interactive: false,
          attributionControl: false,
          // 世界不左右重复画：否则细点被复制成好几份，读不出密度
          renderWorldCopies: false,
        })
      } catch {
        // WebGL 不可用（老设备/无头环境）：静默降级为纯标题卡片
        return
      }
      if (disposed) {
        instance.remove()
        return
      }
      map = instance

      const core = computeCoreBounds(cells)
      const bounds: LngLatBoundsLike = [
        [core[0], core[1]],
        [core[2], core[3]],
      ]
      instance.fitBounds(bounds, { padding: 24, maxZoom: 6, animate: false })

      // 中-3：**不**开 MapLibre 的 cluster——预生成的 0.1° 网格本身就是聚合
      // 结果，再聚一次会按屏幕半径合并、给不出 point_count 的孤立格子会被
      // 有 `has point_count` 过滤的图层整个吃掉。
      const attach = () => {
        if (!instance.getSource(HOME_MAP_CELL_SOURCE_ID)) {
          instance.addSource(HOME_MAP_CELL_SOURCE_ID, { type: 'geojson', data: cellData })
        }
        if (!instance.getLayer(HOME_MAP_CELL_CIRCLE_LAYER_ID)) {
          instance.addLayer({
            id: HOME_MAP_CELL_CIRCLE_LAYER_ID,
            type: 'circle',
            source: HOME_MAP_CELL_SOURCE_ID,
            paint: {
              'circle-color': CELL_COLOR,
              'circle-radius': ['step', ['get', 'count'], 1.5, 100, 2.5, 1000, 3.5],
              'circle-opacity': 0.7,
            },
          } as Parameters<MaplibreMap['addLayer']>[0])
        }
        if (!labelData) return
        if (!instance.getSource(HOME_MAP_LABEL_SOURCE_ID)) {
          instance.addSource(HOME_MAP_LABEL_SOURCE_ID, { type: 'geojson', data: labelData })
        }
        if (!instance.getLayer(HOME_MAP_LABEL_LAYER_ID)) {
          instance.addLayer({
            id: HOME_MAP_LABEL_LAYER_ID,
            type: 'symbol',
            source: HOME_MAP_LABEL_SOURCE_ID,
            layout: {
              'text-field': ['get', locale],
              'text-size': 11,
              'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
              'text-anchor': 'top',
              'text-offset': [0, 0.6],
              // count 越大越优先留在屏幕上（MapLibre 按 sort-key 升序取舍）
              'symbol-sort-key': ['-', 0, ['get', 'count']],
              // 碰撞时让位而不是强行叠压：东京先占位，其余城市挤得下就显示
              'text-allow-overlap': false,
            },
            paint: { 'text-color': '#374151', 'text-halo-color': '#ffffff', 'text-halo-width': 1 },
          } as Parameters<MaplibreMap['addLayer']>[0])
        }
      }
      instance.on('load', attach)
      instance.on('style.load', attach)
    })()

    return () => {
      disposed = true
      map?.remove()
      map = null
    }
    // cells/labels 是预生成静态数据，按长度足以判定变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells.length, labels.length, locale])

  if (!cells.length) return null

  const total = new Intl.NumberFormat(NUMBER_LOCALE[locale]).format(clusters.totalPoints)
  // 低-7：整句在 locale 文件里，`{count}` 占位——空格该不该有由各语言自己决定
  const title = t('pages.home.v2.mapTeaserTitle', locale).replace('{count}', total)

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <Link
        href={prefixPath('/map', locale)}
        className="block overflow-hidden rounded-2xl border border-gray-200 bg-white no-underline transition-colors hover:border-brand-300"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">{title}</h2>
            <p className="truncate text-xs text-gray-500">{t('pages.home.v2.mapTeaserSubtitle', locale)}</p>
          </div>
          <span className="shrink-0 text-sm font-medium text-brand-600">{t('pages.home.v2.mapTeaserCta', locale)}</span>
        </div>
        <div ref={containerRef} aria-hidden="true" className="pointer-events-none h-56 w-full bg-gray-50 sm:h-72" />
      </Link>
    </section>
  )
}
