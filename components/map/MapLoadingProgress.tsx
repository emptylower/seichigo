'use client'

import { useEffect, useState } from 'react'

type MapLoadingProgressProps = {
  percent: number
  visible: boolean
  title?: string
  detail?: string
}

export default function MapLoadingProgress({ percent, visible, title, detail }: MapLoadingProgressProps) {
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

  return (
    <>
      <div
        className="fixed left-0 right-0 top-0 z-30 h-1 overflow-hidden"
        role="progressbar"
        aria-valuenow={width}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full bg-brand-500 shadow-[0_0_10px_rgba(236,72,153,0.5)] transition-all duration-300 ease-out ${
            isComplete ? 'opacity-0' : 'opacity-100'
          }`}
          style={{ width: `${width}%` }}
        >
          <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        </div>
      </div>

      <div className="pointer-events-none fixed left-1/2 top-4 z-40 w-[min(92vw,24rem)] -translate-x-1/2 rounded-xl border border-slate-200 bg-white/92 px-3 py-2 shadow-xl backdrop-blur lg:left-4 lg:translate-x-0">
        <div className="flex items-center justify-between gap-2">
          <div className="line-clamp-1 text-[11px] font-semibold text-slate-700">
            {title || 'Loading map data'}
          </div>
          <div className="shrink-0 text-[11px] font-medium text-slate-500">{width}%</div>
        </div>
        {detail ? <div className="mt-1 line-clamp-1 text-[11px] text-slate-500">{detail}</div> : null}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-brand-500 transition-[width] duration-300 ease-out"
            style={{ width: `${width}%` }}
          />
        </div>
      </div>
    </>
  )
}
