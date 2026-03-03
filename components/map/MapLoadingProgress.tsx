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
  const label = title?.trim() || '地图预加载'
  const hint = detail?.trim() || ''

  return (
    <div
      className={className || 'pointer-events-none absolute left-4 top-[72px] z-30 w-[min(320px,calc(100%-1rem))]'}
      role="progressbar"
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-slate-700">
          <span className="line-clamp-1">{label}</span>
          <span>{Math.round(width)}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200/90">
          <div
            className={`h-full rounded-full bg-brand-500 transition-all duration-300 ease-out ${
              isComplete ? 'opacity-0' : 'opacity-100'
            }`}
            style={{ width: `${width}%` }}
          />
        </div>
        {hint ? (
          <div className="mt-1.5 line-clamp-1 text-[11px] text-slate-600">{hint}</div>
        ) : null}
      </div>
    </div>
  )
}
