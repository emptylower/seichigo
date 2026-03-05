'use client'

import { useEffect, useState } from 'react'

type MapLoadingProgressProps = {
  percent: number
  visible: boolean
  title?: string
  detail?: string
  className?: string
}

export default function MapLoadingProgress({
  percent,
  visible,
  title,
  detail,
  className,
}: MapLoadingProgressProps) {
  const [isComplete, setIsComplete] = useState(false)
  const [shouldRender, setShouldRender] = useState(visible)

  useEffect(() => {
    if (visible) {
      setShouldRender(true)
      setIsComplete(false)
    } else {
      setShouldRender(false)
      setIsComplete(false)
    }
  }, [visible])

  useEffect(() => {
    if (percent >= 100 && visible) {
      setIsComplete(true)
      const timer = setTimeout(() => {
        setShouldRender(false)
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [percent, visible])

  if (!shouldRender) {
    return null
  }

  const width = Math.min(Math.max(percent, 0), 100)
  const displayPercent = width >= 100 ? 100 : Math.floor(width)
  const label = title?.trim() || '地图预加载'
  const hint = detail?.trim() || ''

  return (
    <div
      className={className || 'pointer-events-none absolute left-4 top-[72px] z-30 w-[min(320px,calc(100%-1rem))]'}
      role="progressbar"
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${label} ${displayPercent}%${hint ? `，${hint}` : ''}`}
    >
      <div className="relative overflow-hidden rounded-2xl border border-white/30 bg-slate-900/75 px-3.5 py-3 shadow-[0_14px_38px_rgba(15,23,42,0.38)] backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-slate-900/60">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_0%,rgba(255,255,255,0.24),rgba(255,255,255,0)_52%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/40" />
        <div className="relative">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-white">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-300 shadow-[0_0_0_3px_rgba(244,114,182,0.24)]" />
              <span className="line-clamp-1">{label}</span>
            </span>
            <span className="rounded-full border border-white/40 bg-black/25 px-2 py-0.5 text-[11px] text-white">
              {displayPercent}%
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full border border-white/20 bg-black/30">
            <div
              className={`h-full rounded-full bg-gradient-to-r from-brand-200 via-brand-400 to-brand-500 shadow-[0_0_0_1px_rgba(255,255,255,0.22),0_2px_12px_rgba(236,72,153,0.55)] transition-[width,opacity] duration-300 ease-out ${
                isComplete ? 'opacity-0' : 'opacity-100'
              }`}
              style={{ width: `${width}%` }}
            />
          </div>
          {hint ? (
            <div className="mt-2 rounded-md border border-white/20 bg-black/20 px-2 py-1 text-[11px] text-white/90">
              <div className="line-clamp-1">{hint}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
