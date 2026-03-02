import { useState, useEffect, useCallback } from 'react'
import type { MapMode } from '../types'

const DESKTOP_BREAKPOINT = 1024
const STORAGE_KEY = 'map-mode'

type UseMapModeReturn = {
  mode: MapMode
  setMode: (mode: MapMode) => void
  isComplete: boolean
  isSimple: boolean
}

/**
 * Hook for managing map mode (complete vs simple) with priority chain:
 * URL param > localStorage > device default
 */
export function useMapMode(): UseMapModeReturn {
  const [mode, setModeState] = useState<MapMode>(() => {
    // Priority 1: URL param
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const urlMode = params.get('mode')
      if (urlMode === 'complete' || urlMode === 'simple') {
        return urlMode
      }

      // Priority 2: localStorage
      const storedMode = localStorage.getItem(STORAGE_KEY)
      if (storedMode === 'complete' || storedMode === 'simple') {
        return storedMode
      }

      // Priority 3: device default
      return window.innerWidth >= DESKTOP_BREAKPOINT ? 'complete' : 'simple'
    }

    return 'complete'
  })

  const setMode = useCallback((newMode: MapMode) => {
    setModeState(newMode)

    // Update localStorage
    localStorage.setItem(STORAGE_KEY, newMode)

    // Update URL without reload
    const url = new URL(window.location.href)
    url.searchParams.set('mode', newMode)
    window.history.replaceState(null, '', url.toString())
  }, [])

  // Listen for browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search)
      const urlMode = params.get('mode')
      if (urlMode === 'complete' || urlMode === 'simple') {
        setModeState(urlMode)
        localStorage.setItem(STORAGE_KEY, urlMode)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  return {
    mode,
    setMode,
    isComplete: mode === 'complete',
    isSimple: mode === 'simple',
  }
}
