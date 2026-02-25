'use client'

import { useEffect, useState } from 'react'

/**
 * SSR-safe hook for CSS media query matching.
 * Returns false during SSR (no window), then syncs with actual match on client.
 *
 * @param query - CSS media query string (e.g., '(max-width: 768px)')
 * @returns boolean indicating if the media query matches
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    
    // Set initial value
    setMatches(mediaQuery.matches)

    // Listen for changes
    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches)
    }

    mediaQuery.addEventListener('change', handler)

    return () => {
      mediaQuery.removeEventListener('change', handler)
    }
  }, [query])

  return matches
}

/**
 * Convenience hook for mobile detection (max-width: 768px).
 * Returns false during SSR, then syncs with actual viewport on client.
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 768px)')
}
