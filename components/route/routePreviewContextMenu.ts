/**
 * RoutePreviewMap 的右键 / 触屏长按 500ms 绑定：触发 onMapContextMenu 回调
 * （行程本 B2 自定义点创建入口）。返回解绑函数。
 */
import type maplibregl from 'maplibre-gl'

export type MapContextMenuPayload = { lat: number; lng: number; x: number; y: number }

export function bindMapContextMenu(
  map: maplibregl.Map,
  getCallback: () => ((pos: MapContextMenuPayload) => void) | undefined,
  isDisposed: () => boolean,
): () => void {
  const onContextMenu = (event: maplibregl.MapMouseEvent) => {
    const callback = getCallback()
    if (!callback) return
    event.preventDefault()
    callback({ lat: event.lngLat.lat, lng: event.lngLat.lng, x: event.point.x, y: event.point.y })
  }
  map.on('contextmenu', onContextMenu)

  let longPressTimer: number | null = null
  let longPressPoint: { x: number; y: number } | null = null
  const cancelLongPress = () => {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer)
      longPressTimer = null
    }
    longPressPoint = null
  }
  const onTouchStart = (event: maplibregl.MapTouchEvent) => {
    if (!getCallback()) return
    if (event.points.length !== 1) {
      cancelLongPress()
      return
    }
    longPressPoint = { x: event.point.x, y: event.point.y }
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null
      if (!longPressPoint || isDisposed()) return
      const lngLat = map.unproject([longPressPoint.x, longPressPoint.y])
      getCallback()?.({ lat: lngLat.lat, lng: lngLat.lng, x: longPressPoint.x, y: longPressPoint.y })
      longPressPoint = null
    }, 500)
  }
  map.on('touchstart', onTouchStart)
  map.on('touchmove', cancelLongPress)
  map.on('touchend', cancelLongPress)
  map.on('touchcancel', cancelLongPress)

  return () => {
    cancelLongPress()
    map.off('contextmenu', onContextMenu)
    map.off('touchstart', onTouchStart)
    map.off('touchmove', cancelLongPress)
    map.off('touchend', cancelLongPress)
    map.off('touchcancel', cancelLongPress)
  }
}
