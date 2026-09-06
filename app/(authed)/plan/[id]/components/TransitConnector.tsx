'use client'

import { useState } from 'react'
import { Bus, Car, ChevronDown, Footprints, type LucideIcon } from 'lucide-react'
import type { TripPlanItemView } from '@/lib/tripPlan/view'
import type { SupportedLocale } from '@/lib/i18n/types'
import { TierHint } from '@/components/billing/TierHint'
import { planTextFor, type PlanTextFn } from '../lib/planText'
import { formatTransportText, getTransport, type TransportLeg, type TransportPayload } from './itemPayload'

/** 起终点坐标（由 DayCards 从前后最近带坐标条目取）：无 mapsUrl 时拼 Google 导航链接 */
export type TransitEndpoint = { lat: number; lng: number }

type LegKind = 'walk' | 'ride' | 'drive'

const KIND_KEY: Record<LegKind, string> = { walk: 'transit.walk', ride: 'transit.ride', drive: 'transit.drive' }
const KIND_ICON: Record<LegKind, LucideIcon> = { walk: Footprints, ride: Bus, drive: Car }

function legKind(leg: TransportLeg): LegKind {
  if (leg.mode === 'walk') return 'walk'
  if (leg.mode === 'drive' || leg.mode === 'driving') return 'drive'
  return 'ride'
}

function legIcon(leg: TransportLeg): LucideIcon {
  return KIND_ICON[legKind(leg)]
}

function mainModeIcon(mode: string | undefined): LucideIcon {
  if (mode === 'walk') return Footprints
  if (mode === 'driving' || mode === 'drive') return Car
  return Bus
}

/** 带空格的距离格式（抽屉详晴用）：900 m / 5.4 km */
function formatDistanceSpaced(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

type MergedSegment = { kind: LegKind; durationMin: number | null }

/** 连续同类步骤归并成一段；时长缺失的段不强行归零（未知即 null） */
function mergeLegsIntoSegments(legs: TransportLeg[]): MergedSegment[] {
  const segments: MergedSegment[] = []
  for (const leg of legs) {
    const kind = legKind(leg)
    const duration = typeof leg.durationMin === 'number' ? Math.max(0, Math.round(leg.durationMin)) : null
    const last = segments[segments.length - 1]
    if (last && last.kind === kind) {
      if (duration !== null) last.durationMin = (last.durationMin ?? 0) + duration
    } else {
      segments.push({ kind, durationMin: duration })
    }
  }
  return segments
}

function segmentText(segment: MergedSegment, tx: PlanTextFn): string {
  const label = tx(KIND_KEY[segment.kind])
  if (segment.durationMin === null) return label
  return `${label} ${tx('transit.durationMin', { minutes: segment.durationMin })}`
}

/** 换乘次数：优先 transport.transfers；否则按乘车段数 - 1 推导 */
function transferCount(transport: TransportPayload): number {
  if (typeof transport.transfers === 'number' && transport.transfers >= 0) return transport.transfers
  const rideLegs = (transport.legs ?? []).filter((leg) => legKind(leg) === 'ride').length
  return Math.max(0, rideLegs - 1)
}

function sumSegmentDurations(segments: MergedSegment[]): number | null {
  let total = 0
  let seen = false
  for (const segment of segments) {
    if (segment.durationMin === null) continue
    total += segment.durationMin
    seen = true
  }
  return seen ? total : null
}

/**
 * 折叠态摘要（legs 归并连续同类步骤）：
 * 全步行 → 步行 12 分钟；全乘车 → 乘车 25 分钟（换乘 1 次）；
 * 混合（≤3 段）→ 先步行 5 分钟，再乘车 18 分钟，最后步行 3 分钟；
 * 更多段 → 乘车 xx 分钟，含换乘 n 次。无 legs 返回 null（调用方走兜底文案）。
 */
export function summarizeTransportLegs(transport: TransportPayload, locale: SupportedLocale = 'zh'): string | null {
  const legs = transport.legs ?? []
  if (!legs.length) return null
  const tx = planTextFor(locale)
  const segments = mergeLegsIntoSegments(legs)
  if (segments.length === 1) {
    const only = segments[0]!
    const text = segmentText(only, tx)
    if (only.kind !== 'ride') return text
    const transfers = transferCount(transport)
    return transfers > 0 ? tx('transit.withTransfers', { text, count: transfers }) : text
  }
  if (segments.length <= 3) {
    const keys =
      segments.length === 2
        ? ['transit.prefixFirst', 'transit.prefixThen']
        : ['transit.prefixFirst', 'transit.prefixThen', 'transit.prefixLast']
    return segments
      .map((segment, index) => tx(keys[index]!, { text: segmentText(segment, tx) }))
      .join(tx('transit.mixJoin'))
  }
  const rideMin = sumSegmentDurations(segments.filter((s) => s.kind === 'ride'))
  const transfers = transferCount(transport)
  const ride =
    rideMin !== null
      ? `${tx('transit.ride')} ${tx('transit.durationMin', { minutes: rideMin })}`
      : tx('transit.multipleRides')
  return tx('transit.rideWithTransfers', { ride, count: transfers })
}

/** 展开态单步文案：步行/自驾 `步行 5 分钟（400 m） · 指示`；乘车含方向/上下车站/站数/时刻 */
function legStepText(leg: TransportLeg, tx: PlanTextFn): string {
  const kind = legKind(leg)
  const minutes =
    typeof leg.durationMin === 'number' ? tx('transit.durationMin', { minutes: Math.round(leg.durationMin) }) : null
  if (kind === 'ride') {
    const line = tx('transit.rideLine', { line: leg.line || tx('transit.publicTransport') })
    const parts = [`${line}${leg.headsign ? tx('transit.towards', { headsign: leg.headsign }) : ''}`]
    if (leg.fromStop || leg.toStop) {
      parts.push(`${leg.fromStop ?? tx('transit.fromStop')} → ${leg.toStop ?? tx('transit.toStop')}`)
    }
    if (typeof leg.numStops === 'number' && leg.numStops > 0) parts.push(tx('transit.stops', { count: leg.numStops }))
    if (minutes) parts.push(minutes)
    if (leg.departureTime || leg.arrivalTime) {
      parts.push(
        tx('transit.departArrive', {
          departure: leg.departureTime ?? tx('transit.unknownTime'),
          arrival: leg.arrivalTime ?? tx('transit.unknownTime'),
        }),
      )
    }
    return parts.join(' · ')
  }
  const distance = typeof leg.distanceKm === 'number' && leg.distanceKm > 0 ? `（${formatDistanceSpaced(leg.distanceKm)}）` : ''
  const head = `${tx(KIND_KEY[kind])}${minutes ? ` ${minutes}` : ''}${distance}`
  return leg.instruction ? `${head} · ${leg.instruction}` : head
}

/** 总计行：`总计 26 分钟 · 5.4 km`；时长/距离优先根字段，缺省按 legs 求和 */
function totalLine(transport: TransportPayload, tx: PlanTextFn): string | null {
  let minutes = typeof transport.durationMin === 'number' ? Math.round(transport.durationMin) : null
  if (minutes === null) minutes = sumSegmentDurations(mergeLegsIntoSegments(transport.legs ?? []))
  let km = typeof transport.distanceKm === 'number' && transport.distanceKm > 0 ? transport.distanceKm : null
  if (km === null && transport.legs?.length) {
    let sum = 0
    let seen = false
    for (const leg of transport.legs) {
      if (typeof leg.distanceKm === 'number' && leg.distanceKm > 0) {
        sum += leg.distanceKm
        seen = true
      }
    }
    if (seen) km = Math.round(sum * 10) / 10
  }
  const parts: string[] = []
  if (minutes !== null) parts.push(tx('transit.total', { minutes }))
  if (km !== null) parts.push(formatDistanceSpaced(km))
  return parts.length ? parts.join(' · ') : null
}

function resolveMapsUrl(
  transport: TransportPayload,
  origin: TransitEndpoint | null,
  destination: TransitEndpoint | null,
): string | null {
  if (transport.mapsUrl) return transport.mapsUrl
  if (origin && destination) {
    return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=transit`
  }
  return null
}

/**
 * 交通连接段抽屉：折叠态一行归并摘要（整行可点，右侧小箭头），展开态逐步
 * 导航指引 + 总计 + Google 地图链接。估算/兜底载荷展开给 note 与当地查询提示。
 * 展开状态仅保留在组件实例内（同一天内记住，卸载即忘），默认折叠。
 */
export function TransitConnector(props: {
  item: TripPlanItemView
  origin?: TransitEndpoint | null
  destination?: TransitEndpoint | null
  /** 免费档：估算行下方给一条指向定价页的升级提示（设计 §4） */
  showEstimateUpgradeHint?: boolean
  locale?: SupportedLocale
}) {
  const { item } = props
  const locale = props.locale ?? 'zh'
  const tx = planTextFor(locale)
  const [expanded, setExpanded] = useState(false)
  const transport = getTransport(item)
  const legs = transport?.legs ?? []
  const isEstimate = Boolean(transport?.estimated) || transport?.provider === 'estimate'

  // 折叠摘要：legs 归并摘要 → 估算"约 xx 分钟 · 参考估算" → 旧主文案 → title/note 兜底
  let summary: string
  if (legs.length && transport) {
    summary = summarizeTransportLegs(transport, locale) ?? formatTransportText(transport, locale)
  } else if (isEstimate && transport) {
    const minutes =
      typeof transport.durationMin === 'number'
        ? `${tx('transit.approxMinutes', { minutes: Math.round(transport.durationMin) })} · `
        : ''
    summary = `${minutes}${tx('transit.estimateLabel')}`
  } else if (transport) {
    summary = formatTransportText(transport, locale) || [item.title, item.note].filter(Boolean).join(' · ')
  } else {
    // 旧数据/LLM 未按 schema 写 payload 时兜底用 title/note，绝不空行
    summary = [item.title, item.note].filter(Boolean).join(' · ')
  }

  const total = transport ? totalLine(transport, tx) : null
  const mapsUrl = transport ? resolveMapsUrl(transport, props.origin ?? null, props.destination ?? null) : null
  const hasDetails = legs.length > 0 || Boolean(transport?.note) || Boolean(total) || Boolean(mapsUrl)
  const Icon = transport ? mainModeIcon(transport.mode) : Bus

  return (
    <li className="py-1 pl-9 text-xs text-gray-400">
      <button
        type="button"
        aria-expanded={hasDetails ? expanded : undefined}
        disabled={!hasDetails}
        onClick={() => setExpanded((value) => !value)}
        className={`flex w-full items-start gap-2 text-left ${hasDetails ? 'cursor-pointer rounded-lg transition hover:bg-gray-50' : 'cursor-default'}`}
      >
        <span className="mt-0.5">
          <Icon className="h-3.5 w-3.5 shrink-0" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{summary}</span>
        </span>
        {hasDetails ? (
          <ChevronDown
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        ) : null}
      </button>

      {/* 摘要行是个 button，链接不能嵌在里面：提示另起一行挂在按钮下方 */}
      {isEstimate && props.showEstimateUpgradeHint ? (
        <div className="ml-6 mt-1">
          <TierHint kind="transit" locale={locale} />
        </div>
      ) : null}

      {expanded && hasDetails ? (
        <div className="ml-6 mt-1.5 space-y-1.5 rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2">
          {legs.length ? (
            <ol className="space-y-1">
              {legs.map((leg, index) => {
                const StepIcon = legIcon(leg)
                return (
                  <li key={index} className="flex items-start gap-1.5">
                    <StepIcon className="mt-0.5 h-3 w-3 shrink-0 text-gray-300" />
                    <span className="min-w-0 flex-1 text-gray-500">{legStepText(leg, tx)}</span>
                  </li>
                )
              })}
            </ol>
          ) : null}
          {!legs.length && isEstimate ? (
            <>
              {transport?.note ? <p className="text-gray-500">{transport.note}</p> : null}
              <p className="text-gray-400">{tx('transit.localHint')}</p>
            </>
          ) : null}
          {total ? <p className="tabular-nums text-gray-500">{total}</p> : null}
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-[11px] text-brand-500 underline decoration-brand-200 underline-offset-2"
            >
              {tx('transit.openInGoogleMaps')}
            </a>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
