'use client'

import { useState } from 'react'
import { Car, Footprints, RotateCcw, TrainFront } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { DayLeg, TravelMode } from '../types'
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

type Props = {
  leg: DayLeg | null
  routeVisible: boolean
  /** 目标条目的 legMode 覆盖（null = 用当天默认），菜单高亮用 */
  itemLegMode?: TravelMode | null
  /** B2：点击连接行改方式；缺省则纯展示 */
  onChangeLegMode?: (mode: TravelMode | null) => void
  locale?: SupportedLocale
}

/** 两条有坐标条目之间的连接行；可点时弹菜单改本段交通方式 */
export function LegConnector({
  leg,
  routeVisible,
  itemLegMode = null,
  onChangeLegMode,
  locale = 'zh',
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const Icon = leg ? MODE_ICON[leg.mode] : null
  const heuristic = leg?.source === 'heuristic'
  const agent = leg?.source === 'agent'
  const clickable = Boolean(leg && onChangeLegMode)

  const menuItems: { mode: TravelMode | null; label: string; Icon: typeof Footprints | null }[] = [
    { mode: 'walking', label: tr('routebook.travelMode.walking', locale), Icon: Footprints },
    { mode: 'transit', label: tr('routebook.travelMode.transit', locale), Icon: TrainFront },
    { mode: 'driving', label: tr('routebook.travelMode.driving', locale), Icon: Car },
    { mode: null, label: tr('routebook.leg.useDayDefault', locale), Icon: RotateCcw },
  ]

  const pill = routeVisible && leg && Icon ? (
    <div className="relative my-1">
      <button
        type="button"
        disabled={!clickable}
        aria-haspopup={clickable ? 'menu' : undefined}
        aria-expanded={clickable ? menuOpen : undefined}
        aria-label={tr('routebook.leg.changeMode', locale)}
        className={`inline-flex flex-wrap items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
          heuristic
            ? 'border-dashed border-slate-300 bg-slate-50 text-slate-500'
            : 'border-pink-100 bg-pink-50/70 text-slate-600'
        } ${clickable ? 'cursor-pointer hover:border-brand-300 hover:bg-pink-50' : 'cursor-default'}`}
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        <Icon className={`h-3.5 w-3.5 ${heuristic ? 'text-slate-400' : 'text-brand-500'}`} />
        <span>{formatDuration(leg.durationSec, locale)}</span>
        <span className="text-slate-400">·</span>
        <span>{formatDistance(leg.distanceM)}</span>
        {heuristic ? (
          <span className="rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[10px] text-slate-500">
            {tr('routebook.leg.estimated', locale)}
          </span>
        ) : null}
        {agent ? (
          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600">
            {tr('routebook.leg.agentChecked', locale)}
          </span>
        ) : null}
      </button>
      {menuOpen && clickable ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-44 rounded-2xl border border-pink-100 bg-white py-1 shadow-lg">
            {agent ? (
              <div className="border-b border-pink-50 px-3 py-1.5 text-[10px] leading-4 text-slate-400">
                {tr('routebook.leg.overrideAgent', locale)}
              </div>
            ) : null}
            {menuItems.map(({ mode, label, Icon: MenuIcon }) => {
              const active = itemLegMode === mode
              return (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-pink-50 ${
                    active ? 'font-semibold text-brand-600' : 'text-slate-600'
                  }`}
                  onClick={() => {
                    setMenuOpen(false)
                    onChangeLegMode?.(mode)
                  }}
                >
                  {MenuIcon ? <MenuIcon className="h-3.5 w-3.5" /> : null}
                  {label}
                  {active ? <span className="ml-auto text-brand-500">✓</span> : null}
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  ) : (
    <div className="my-1 h-4" />
  )

  return (
    <div className="flex items-stretch gap-3 py-0.5 pl-5" aria-hidden={!leg}>
      <div className="flex w-5 justify-center">
        <span className={`w-px ${leg ? 'bg-brand-200' : 'bg-slate-200'}`} />
      </div>
      {pill}
    </div>
  )
}
