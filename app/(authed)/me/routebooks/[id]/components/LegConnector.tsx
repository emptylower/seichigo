'use client'

import { Car, Footprints, TrainFront } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { DayLeg } from '../types'
import { tr } from '../../i18n'

const MODE_ICON = {
  walking: Footprints,
  transit: TrainFront,
  driving: Car,
} as const

function formatDuration(durationSec: number, locale: SupportedLocale): string {
  const minutes = Math.round(durationSec / 60)
  if (minutes < 60) return tr('routebook.leg.minutes', locale, { n: minutes })
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0
    ? tr('routebook.leg.hoursMinutes', locale, { h: hours, m: rest })
    : tr('routebook.leg.hours', locale, { h: hours })
}

function formatDistance(distanceM: number): string {
  if (distanceM >= 1000) return `${(Math.round(distanceM / 100) / 10).toFixed(1)} km`
  return `${Math.round(distanceM)} m`
}

/** 两条有坐标条目之间的连接行；B1 只显示，不可点 */
export function LegConnector({
  leg,
  routeVisible,
  locale = 'zh',
}: {
  leg: DayLeg | null
  routeVisible: boolean
  locale?: SupportedLocale
}) {
  const Icon = leg ? MODE_ICON[leg.mode] : null
  const heuristic = leg?.source === 'heuristic'

  return (
    <div className="flex items-stretch gap-3 py-0.5 pl-5" aria-hidden={!leg}>
      <div className="flex w-5 justify-center">
        <span className={`w-px ${leg ? 'bg-brand-200' : 'bg-slate-200'}`} />
      </div>
      {routeVisible && leg && Icon ? (
        <div
          className={`my-1 inline-flex flex-wrap items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            heuristic ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-pink-100 bg-pink-50/70 text-slate-600'
          }`}
        >
          <Icon className={`h-3.5 w-3.5 ${heuristic ? 'text-slate-400' : 'text-brand-500'}`} />
          <span>{formatDuration(leg.durationSec, locale)}</span>
          <span className="text-slate-400">·</span>
          <span>{formatDistance(leg.distanceM)}</span>
          {heuristic ? <span className="rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[10px] text-slate-500">{tr('routebook.leg.estimated', locale)}</span> : null}
        </div>
      ) : (
        <div className="my-1 h-4" />
      )}
    </div>
  )
}
