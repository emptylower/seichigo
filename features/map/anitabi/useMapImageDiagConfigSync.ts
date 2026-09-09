import { useEffect } from 'react'
import { runAfterBasemapFirstLoad } from './basemapFirstLoadGate'

// 地图图片诊断配置同步：内部诊断绝不能挡首屏 —— 等到底图首次 load 之后，
// 再借浏览器空闲窗口发首次拉取，之后每 30s 轮询。
// 配置未拿到前 forceCaptureConfigRef 保持默认 false，诊断管理器按默认配置先跑，
// 不丢 map_shell_ready / bootstrap_ready 等锚点埋点。
export function useMapImageDiagConfigSync(ctx: {
  forceCaptureConfigRef: { current: boolean }
}) {
  const { forceCaptureConfigRef } = ctx

  useEffect(() => {
    let cancelled = false
    let intervalId: number | null = null
    let idleId: number | null = null
    let fallbackTimerId: number | null = null
    const syncCaptureConfig = () => {
      void fetch('/api/map-image-diagnostics/config', { method: 'GET' })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
          if (cancelled) return
          forceCaptureConfigRef.current = Boolean((data as { config?: { fullCaptureEnabled?: unknown } })?.config?.fullCaptureEnabled)
        })
        .catch(() => null)
    }

    const startPolling = () => {
      if (cancelled || intervalId != null) return
      syncCaptureConfig()
      intervalId = window.setInterval(syncCaptureConfig, 30_000)
    }

    const scheduleAfterIdle = () => {
      const win = window as Window & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
        cancelIdleCallback?: (handle: number) => void
      }
      if (typeof win.requestIdleCallback === 'function') {
        idleId = win.requestIdleCallback(() => startPolling(), { timeout: 3000 })
      } else {
        fallbackTimerId = window.setTimeout(() => startPolling(), 1500)
      }
    }

    runAfterBasemapFirstLoad(scheduleAfterIdle)
    return () => {
      cancelled = true
      if (intervalId != null) window.clearInterval(intervalId)
      if (idleId != null) {
        const win = window as Window & { cancelIdleCallback?: (handle: number) => void }
        win.cancelIdleCallback?.(idleId)
      }
      if (fallbackTimerId != null) window.clearTimeout(fallbackTimerId)
    }
  }, [forceCaptureConfigRef])
}
