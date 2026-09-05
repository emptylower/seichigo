/**
 * RoutePreviewMap 的 Popup 生命周期（M4）：同一时刻最多一个 Popup；
 * marker 重建/切天/卸载时必须关闭，避免悬空 Popup 指向已移除的 marker。
 * 抽成独立 helper 以便 node 环境单测（RoutePreviewMap 本体需 WebGL，无法直测）。
 */

export type PreviewPopupHandle = { remove: () => void }

export type PreviewPopupLifecycle = {
  /** 打开新 Popup（自动关闭旧的）并记录其目标点 */
  open: (popup: PreviewPopupHandle, pointId: string) => void
  /** 关闭当前 Popup（幂等：无 Popup 时不动作） */
  close: () => void
  /** 当前 Popup 指向的点；未打开时为 null */
  currentPointId: () => string | null
  /** H3：Popup 被地图自己关掉（原生关闭按钮/点击空白）后同步记录，不再 remove 一次 */
  noteMapClosed: (pointId: string) => void
}

/**
 * @param onClosed 当前 Popup 关闭后的通知（被顶掉、主动 close、地图自行关闭都发一次），
 * 调用方据此撤掉自定义内容宿主（React portal 容器）。
 */
export function createPreviewPopupLifecycle(onClosed?: (pointId: string) => void): PreviewPopupLifecycle {
  let current: { popup: PreviewPopupHandle; pointId: string } | null = null

  /** 清记录并通知；removePopup=false 用于地图已自行移除 Popup 的场景（避免重复 remove） */
  const detach = (removePopup: boolean) => {
    const entry = current
    current = null
    if (!entry) return
    if (removePopup) entry.popup.remove()
    onClosed?.(entry.pointId)
  }

  return {
    open(popup, pointId) {
      detach(true)
      current = { popup, pointId }
    },
    close() {
      detach(true)
    },
    currentPointId() {
      return current?.pointId ?? null
    },
    noteMapClosed(pointId) {
      if (current?.pointId !== pointId) return
      detach(false)
    },
  }
}

/** 能订阅 close 事件的 Popup（maplibre Popup 子集），供 bindPopupClose 使用 */
export type ClosablePopupHandle = PreviewPopupHandle & {
  on: (type: 'close', listener: () => void) => void
}

/** 点位卡右上角「关闭」等调用方侧入口：由 RoutePreviewMap 在挂载时写入 ref */
export type PreviewPopupControls = { close: () => void }

/**
 * H3：订阅 Popup 的 close 事件。maplibre 自带的关闭按钮（以及点击地图空白）
 * 会直接移除 Popup 而不经过生命周期对象，若不同步，currentPointId 仍停在刚
 * 关掉的点上，再次点同一 marker 时 `currentPointId !== id` 不成立 → 不重开。
 */
export function bindPopupClose(lifecycle: PreviewPopupLifecycle, popup: ClosablePopupHandle, pointId: string): void {
  popup.on('close', () => {
    lifecycle.noteMapClosed(pointId)
  })
}

/**
 * 「在地图上看」后 Popup 补开判定：activePointId 在场、地图与 marker 都已
 * 就绪、且当前 Popup 指向的不是它时才需要 openPopupFor。地图未 ready
 * （DayMap 刚挂载、未 load）或 marker 未构建时不算——那时提前开 Popup 会被
 * 后续 rebuildMarkers 关掉且不再打开；此场景由 rebuild 完成后的兜底调用
 * （syncActivePopup）补开。
 */
export function needsActivePopupSync(input: {
  activePointId: string | null
  currentPopupPointId: string | null
  mapReady: boolean
  markersReady: boolean
  /** 调用方是否启用了 Popup（onPointSelect/renderPopup 任一在场） */
  popupEnabled: boolean
}): boolean {
  if (!input.activePointId || !input.popupEnabled) return false
  if (!input.mapReady || !input.markersReady) return false
  return input.currentPopupPointId !== input.activePointId
}
