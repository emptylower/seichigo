'use client'

import { useEffect, useState } from 'react'

type MapLoadingProgressProps = {
  percent: number
  visible: boolean
}

export default function MapLoadingProgress({ percent, visible }: MapLoadingProgressProps) {
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
  )
}
