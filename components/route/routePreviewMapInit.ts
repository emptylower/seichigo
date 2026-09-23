/**
 * RoutePreviewMap 的 maplibre Map 构造：inline 嵌入态（interactive=false）启用
 * cooperativeGestures 防滚动劫持（Ctrl/⌘+滚轮缩放、单指拖动归页面），并禁用
 * 与页面/缩放冲突的手势（boxZoom/doubleClickZoom/keyboard）；全交互态保持原生手势。
 * 两种模式都给 ± 缩放按钮。WebGL 不可用时构造会同步抛出（调用方 catch 降级占位）。
 */
import maplibregl from 'maplibre-gl'

export function createRoutePreviewMap(options: {
  container: HTMLDivElement
  style: string | maplibregl.StyleSpecification
  center: [number, number]
  interactive: boolean
}): maplibregl.Map {
  const { container, style, center, interactive } = options
  const map = new maplibregl.Map({
    container,
    style,
    center,
    zoom: 5,
    interactive: true,
    attributionControl: false,
    dragRotate: false,
    touchPitch: false,
    pitchWithRotate: false,
    ...(interactive
      ? {}
      : {
          cooperativeGestures: true,
          locale: {
            'CooperativeGesturesHandler.WindowsHelpText': '按住 Ctrl 并滚动可缩放地图',
            'CooperativeGesturesHandler.MacHelpText': '按住 ⌘ 并滚动可缩放地图',
            'CooperativeGesturesHandler.MobileHelpText': '双指操作地图',
          },
        }),
  })

  if (!interactive) {
    map.boxZoom.disable()
    map.doubleClickZoom.disable()
    map.keyboard.disable()
  }

  map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right')
  return map
}
