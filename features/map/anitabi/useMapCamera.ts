import { useCallback } from 'react'
import { buildBounds } from './geo'
import { DESKTOP_BREAKPOINT, DETAIL_PANEL_WIDTH } from './shared'

export function useMapCamera(ctx: any) {
  const {
    mapRef,
    isDesktop,
    focusTimerRef,
  } = ctx

  const getCameraPadding = useCallback((withDetailPanel: boolean) => {
    const map = mapRef.current
    const defaultTop = 56

    if (!map) {
      const sidePadding = withDetailPanel && isDesktop ? DETAIL_PANEL_WIDTH + 24 : 40
      return {
        top: defaultTop,
        right: sidePadding,
        bottom: withDetailPanel ? (isDesktop ? 120 : 220) : defaultTop,
        left: 40,
      }
    }

    const container = map.getContainer()
    const width = container.clientWidth
    const height = container.clientHeight
    const desktopViewport = width >= DESKTOP_BREAKPOINT

    if (!desktopViewport) {
      const top = Math.max(22, Math.round(height * 0.06))
      return {
        top,
        right: 22,
        left: 22,
        bottom: withDetailPanel ? Math.max(220, Math.round(height * 0.4)) : Math.max(88, Math.round(height * 0.16)),
      }
    }

    const rightPanel = withDetailPanel ? Math.min(Math.round(width * 0.42), DETAIL_PANEL_WIDTH + 24) : 28
    const top = Math.max(28, Math.round(height * 0.08))
    const bottom = withDetailPanel ? Math.max(82, Math.round(height * 0.24)) : top
    const left = Math.max(28, Math.round(width * 0.07))

    return {
      top,
      right: rightPanel,
      bottom,
      left,
    }
  }, [isDesktop, mapRef])

  const getCameraOffset = useCallback(
    (withDetailPanel: boolean): [number, number] => {
      const padding = getCameraPadding(withDetailPanel)
      return [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2]
    },
    [getCameraPadding]
  )

  const focusGeo = useCallback(
    (geo: [number, number], zoom: number, withDetailPanel: boolean) => {
      const map = mapRef.current
      if (!map) return false

      if (focusTimerRef.current != null) {
        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = null
      }

      map.resize()
      map.stop()
      const offset = getCameraOffset(withDetailPanel)
      const targetCenter: [number, number] = [geo[1], geo[0]]
      map.flyTo({
        center: targetCenter,
        zoom,
        offset,
        essential: true,
        duration: 260,
      })

      // A second short recenter solves occasional visual drift while map canvas is still settling.
      focusTimerRef.current = window.setTimeout(() => {
        const activeMap = mapRef.current
        if (!activeMap) return
        activeMap.easeTo({
          center: targetCenter,
          zoom: Math.max(activeMap.getZoom(), zoom),
          offset,
          essential: true,
          duration: 120,
        })
        focusTimerRef.current = null
      }, 180)

      return true
    },
    [focusTimerRef, getCameraOffset, mapRef]
  )

  const fitBangumiBounds = useCallback(
    (points: Array<[number, number]>) => {
      const map = mapRef.current
      if (!map || points.length < 2) return false

      const bounds = buildBounds(points)
      if (!bounds) return false

      if (focusTimerRef.current != null) {
        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = null
      }

      map.resize()
      map.fitBounds(bounds, {
        padding: getCameraPadding(true),
        maxZoom: 12.8,
        duration: 280,
        essential: true,
      })
      return true
    },
    [focusTimerRef, getCameraPadding, mapRef]
  )

  return {
    getCameraPadding,
    getCameraOffset,
    focusGeo,
    fitBangumiBounds,
  }
}
