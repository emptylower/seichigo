import { describe, it, expect, vi } from 'vitest'
import { bindPopupClose, createPreviewPopupLifecycle, needsActivePopupSync } from '@/components/route/routePreviewPopup'

function makePopup() {
  return { remove: vi.fn() }
}

describe('routePreviewPopup（M4：Popup 生命周期）', () => {
  it('open 记录目标点；再次 open 自动关闭旧 Popup', () => {
    const lifecycle = createPreviewPopupLifecycle()
    const first = makePopup()
    const second = makePopup()
    lifecycle.open(first, 'a')
    expect(lifecycle.currentPointId()).toBe('a')

    lifecycle.open(second, 'b')
    expect(first.remove).toHaveBeenCalledTimes(1)
    expect(lifecycle.currentPointId()).toBe('b')
  })

  it('close 移除 Popup 并清空目标点（marker 重建/切天/卸载时调用）', () => {
    const lifecycle = createPreviewPopupLifecycle()
    const popup = makePopup()
    lifecycle.open(popup, 'a')
    lifecycle.close()
    expect(popup.remove).toHaveBeenCalledTimes(1)
    expect(lifecycle.currentPointId()).toBeNull()
  })

  it('close 幂等：无 Popup 时不动作、不抛错', () => {
    const lifecycle = createPreviewPopupLifecycle()
    expect(() => lifecycle.close()).not.toThrow()
    expect(lifecycle.currentPointId()).toBeNull()
  })
})

describe('needsActivePopupSync（「在地图上看」后 Popup 补开判定）', () => {
  it('地图与 marker 都就绪、Popup 未对齐 active 点时需要补开', () => {
    expect(
      needsActivePopupSync({ activePointId: 'a', currentPopupPointId: null, mapReady: true, markersReady: true, popupEnabled: true }),
    ).toBe(true)
    expect(
      needsActivePopupSync({ activePointId: 'a', currentPopupPointId: 'other', mapReady: true, markersReady: true, popupEnabled: true }),
    ).toBe(true)
  })

  it('Popup 已指向 active 点时不重复开', () => {
    expect(
      needsActivePopupSync({ activePointId: 'a', currentPopupPointId: 'a', mapReady: true, markersReady: true, popupEnabled: true }),
    ).toBe(false)
  })

  it('DayMap 刚挂载（地图未 load / marker 未构建）时不补开——由 rebuildMarkers 完成后的兜底负责', () => {
    expect(
      needsActivePopupSync({ activePointId: 'a', currentPopupPointId: null, mapReady: true, markersReady: false, popupEnabled: true }),
    ).toBe(false)
    expect(
      needsActivePopupSync({ activePointId: 'a', currentPopupPointId: null, mapReady: false, markersReady: false, popupEnabled: true }),
    ).toBe(false)
  })

  it('无 active 点或调用方未启用 Popup 时不补开', () => {
    expect(
      needsActivePopupSync({ activePointId: null, currentPopupPointId: null, mapReady: true, markersReady: true, popupEnabled: true }),
    ).toBe(false)
    expect(
      needsActivePopupSync({ activePointId: 'a', currentPopupPointId: null, mapReady: true, markersReady: true, popupEnabled: false }),
    ).toBe(false)
  })
})

/** 贴近 maplibre Popup 的假件：remove()/关闭按钮都只在仍挂在地图上时发一次 close */
function makeClosablePopup() {
  const listeners: Array<() => void> = []
  let attached = true
  const fire = () => {
    if (!attached) return
    attached = false
    listeners.slice().forEach((fn) => fn())
  }
  return {
    remove: vi.fn(fire),
    on: (_type: 'close', listener: () => void) => {
      listeners.push(listener)
    },
    /** 用户点 maplibre 自带的关闭按钮 */
    clickCloseButton: fire,
  }
}

describe('bindPopupClose（H3：Popup 被地图关掉后同一 marker 要能再次打开）', () => {
  it('原生关闭按钮关掉当前 Popup：currentPointId 归零并通知调用方，同一 id 可再次 open', () => {
    const onClosed = vi.fn()
    const lifecycle = createPreviewPopupLifecycle(onClosed)
    const popup = makeClosablePopup()
    lifecycle.open(popup, 'a')
    bindPopupClose(lifecycle, popup, 'a')

    popup.clickCloseButton()
    expect(lifecycle.currentPointId()).toBeNull()
    expect(onClosed).toHaveBeenCalledWith('a')
    // 地图已自行移除，生命周期不再 remove 一次
    expect(popup.remove).not.toHaveBeenCalled()

    // 再次点同一 marker：currentPointId 已归零，调用方据此重新创建 Popup
    const reopened = makeClosablePopup()
    lifecycle.open(reopened, 'a')
    expect(lifecycle.currentPointId()).toBe('a')
  })

  it('lifecycle.close()（marker 重建/切天/卸载）通知一次调用方，且只 remove 一次', () => {
    const onClosed = vi.fn()
    const lifecycle = createPreviewPopupLifecycle(onClosed)
    const popup = makeClosablePopup()
    lifecycle.open(popup, 'a')
    bindPopupClose(lifecycle, popup, 'a')

    lifecycle.close()
    expect(onClosed).toHaveBeenCalledTimes(1)
    expect(onClosed).toHaveBeenCalledWith('a')
    expect(lifecycle.currentPointId()).toBeNull()
    expect(popup.remove).toHaveBeenCalledTimes(1)
  })

  it('旧 Popup 被新 Popup 顶掉：只通知旧 id，新 Popup 的记录不被清', () => {
    const onClosed = vi.fn()
    const lifecycle = createPreviewPopupLifecycle(onClosed)
    const first = makeClosablePopup()
    lifecycle.open(first, 'a')
    bindPopupClose(lifecycle, first, 'a')

    const second = makeClosablePopup()
    lifecycle.open(second, 'b')
    bindPopupClose(lifecycle, second, 'b')

    expect(onClosed).toHaveBeenCalledTimes(1)
    expect(onClosed).toHaveBeenCalledWith('a')
    expect(lifecycle.currentPointId()).toBe('b')
  })

  it('close 事件迟到（Popup 已不是当前那个）时不误清当前 Popup', () => {
    const onClosed = vi.fn()
    const lifecycle = createPreviewPopupLifecycle(onClosed)
    const stale = makeClosablePopup()
    bindPopupClose(lifecycle, stale, 'a')
    lifecycle.open(makeClosablePopup(), 'b')

    stale.clickCloseButton()
    expect(lifecycle.currentPointId()).toBe('b')
    expect(onClosed).not.toHaveBeenCalled()
  })
})
