import { MapImageSessionManager, readMapImageDiagForceOverride } from './mapImageSessionManager'

export type ImagePreviewState = {
  src: string
  name: string
  saveUrl: string
  fallbackSrc?: string | null
  diagnosticSurface?: 'map' | 'nearby'
  diagnosticSlotKey?: string | null
}

export function createMapImageDiagManager(input: {
  warmupMetricRef: { current: Record<string, unknown> }
  forceCaptureConfigRef: { current: boolean }
}) {
  return new MapImageSessionManager({
    getSessionSeed: () => {
      const seeded = input.warmupMetricRef.current.first_view_session_id
      return typeof seeded === 'string' && seeded.trim() ? seeded : null
    },
    getRouteContext: () => {
      if (typeof window === 'undefined') return null
      return `${window.location.pathname}${window.location.search}`
    },
    getForceCapture: () => {
      if (readMapImageDiagForceOverride()) return true
      if (typeof window === 'undefined') return false
      const value = String(new URL(window.location.href).searchParams.get('diag') || '').trim().toLowerCase()
      return value === '1' || value === 'true' || value === 'yes' || value === 'force' || input.forceCaptureConfigRef.current
    },
  })
}
