'use client'

import type { MapMode } from '@/components/map/types'

interface MapModeToggleProps {
  mode: MapMode
  onModeChange: (mode: MapMode) => void
}

export function MapModeToggle({ mode, onModeChange }: MapModeToggleProps) {
  return (
    <div className="absolute bottom-6 right-4 z-10 flex gap-1 rounded-full bg-white/90 p-1 shadow-sm backdrop-blur-sm md:bottom-8 md:right-6">
      <button
        type="button"
        onClick={() => onModeChange('complete')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onModeChange('complete')
          }
        }}
        className={`
          rounded-full px-3 py-1.5 text-sm font-medium transition-colors
          md:px-4 md:py-2 md:text-base
          ${
            mode === 'complete'
              ? 'bg-brand-500 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }
        `}
        aria-pressed={mode === 'complete'}
      >
        完整
      </button>
      <button
        type="button"
        onClick={() => onModeChange('simple')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onModeChange('simple')
          }
        }}
        className={`
          rounded-full px-3 py-1.5 text-sm font-medium transition-colors
          md:px-4 md:py-2 md:text-base
          ${
            mode === 'simple'
              ? 'bg-brand-500 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }
        `}
        aria-pressed={mode === 'simple'}
      >
        精简
      </button>
    </div>
  )
}
