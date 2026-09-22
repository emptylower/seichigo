import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRef, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import MapShell from '@/features/map/anitabi/MapShell'

const vendorCss = readFileSync(path.join(process.cwd(), 'node_modules/maplibre-gl/dist/maplibre-gl.css'), 'utf8')
const styles: HTMLStyleElement[] = []

afterEach(() => {
  for (const style of styles.splice(0)) style.remove()
})

function addStyle(css: string) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  styles.push(style)
}

describe('MapShell 地图容器定位', () => {
  it.each(['vendor-first', 'vendor-last'] as const)('%s：地图保持绝对定位，切换全景时仍可隐藏', (order) => {
    const utilities = '.absolute { position: absolute } .hidden { display: none }'
    if (order === 'vendor-first') addStyle(vendorCss)
    addStyle(utilities)
    if (order === 'vendor-last') addStyle(vendorCss)

    const mapRootRef = createRef<HTMLDivElement>()
    const props: ComponentProps<typeof MapShell> = {
      warmupOverlay: null,
      isDesktop: true,
      explorerPanelContent: null,
      detailPanelInner: null,
      mapRootRef,
      isMapView: true,
      mapLoadingIndicator: null,
      mapModeToggle: null,
      panoramaContent: null,
      topBarLeading: null,
      topBarCenter: null,
      topBarActions: null,
      locateHint: null,
      desktopWindowExcerptOverlay: null,
      mobileVisualCenterOverlay: null,
      mobilePointPopup: null,
      mobilePanelButtonLabel: null,
      onOpenMobilePanel: vi.fn(),
      mobilePanelOpen: false,
      setMobilePanelOpen: vi.fn(),
      panelTitle: '',
      hidePanelLabel: '',
      mobileSheetDescription: '',
    }
    const view = render(<MapShell {...props} />)
    const root = mapRootRef.current!
    // MapLibre 构造时会在 React 提供的 root 上加这个类。
    root.classList.add('maplibregl-map')
    expect(getComputedStyle(root).position).toBe('absolute')

    view.rerender(<MapShell {...props} isMapView={false} />)
    expect(getComputedStyle(root).display).toBe('none')
    view.rerender(<MapShell {...props} />)
    expect(getComputedStyle(root).position).toBe('absolute')
    expect(getComputedStyle(root).display).not.toBe('none')
  })
})
