'use client'

import type { ReactNode, RefObject } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'

type MapShellProps = {
  warmupOverlay: ReactNode
  isDesktop: boolean
  explorerPanelContent: ReactNode
  detailPanelInner: ReactNode
  mapRootRef: RefObject<HTMLDivElement | null>
  isMapView: boolean
  mapLoadingIndicator: ReactNode
  mapModeToggle: ReactNode
  panoramaContent: ReactNode
  topBarLeading: ReactNode
  topBarCenter: ReactNode
  topBarActions: ReactNode
  locateHint: string | null
  desktopWindowExcerptOverlay: ReactNode
  mobileVisualCenterOverlay: ReactNode
  mobilePointPopup: ReactNode
  mobilePanelButtonLabel: string | null
  onOpenMobilePanel: () => void
  mobilePanelOpen: boolean
  setMobilePanelOpen: (open: boolean) => void
  panelTitle: string
  hidePanelLabel: string
  mobileSheetDescription: string
  children?: ReactNode
}

export default function MapShell(props: MapShellProps) {
  const {
    warmupOverlay,
    isDesktop,
    explorerPanelContent,
    detailPanelInner,
    mapRootRef,
    isMapView,
    mapLoadingIndicator,
    mapModeToggle,
    panoramaContent,
    topBarLeading,
    topBarCenter,
    topBarActions,
    locateHint,
    desktopWindowExcerptOverlay,
    mobileVisualCenterOverlay,
    mobilePointPopup,
    mobilePanelButtonLabel,
    onOpenMobilePanel,
    mobilePanelOpen,
    setMobilePanelOpen,
    panelTitle,
    hidePanelLabel,
    mobileSheetDescription,
    children,
  } = props

  return (
    <div data-layout-wide="true" className="relative h-[calc(100dvh-84px)] w-full overflow-hidden bg-slate-50">
      {warmupOverlay}
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] lg:grid-rows-1">
        {isDesktop ? (
          <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-white">
            {explorerPanelContent}
          </aside>
        ) : null}

        <section className="relative h-full min-h-0">
          <div className="absolute inset-0">
            <div
              ref={mapRootRef}
              className={`absolute inset-0 ${isMapView ? '' : 'hidden'}`}
            />
            {mapLoadingIndicator}
            {mapModeToggle}
            {panoramaContent}
          </div>

          <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex items-center gap-2">
            <div className="pointer-events-auto shrink-0">{topBarLeading}</div>
            {topBarCenter}
            <div className="pointer-events-auto flex shrink-0 items-center gap-2">
              {topBarActions}
            </div>
          </div>

          {locateHint ? (
            <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-4">
              <div className="rounded-full bg-black/65 px-3 py-1 text-[11px] text-white shadow-lg backdrop-blur-sm">
                {locateHint}
              </div>
            </div>
          ) : null}

          {desktopWindowExcerptOverlay}
          {mobileVisualCenterOverlay}
          {mobilePointPopup}

          {!isDesktop && mobilePanelButtonLabel ? (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 z-30 flex justify-center mobile-safe-bottom">
              <button
                type="button"
                onClick={onOpenMobilePanel}
                className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 text-sm font-medium text-slate-700 shadow-lg backdrop-blur hover:bg-white"
              >
                <span>{mobilePanelButtonLabel}</span>
              </button>
            </div>
          ) : null}

          {isDesktop && detailPanelInner ? (
            <div className="absolute right-4 top-14 z-20 max-h-[calc(100%-80px)] w-[340px] overflow-x-hidden overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
              {detailPanelInner}
            </div>
          ) : null}
        </section>
      </div>

      {!isDesktop ? (
        <Sheet open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
          <SheetContent side="bottom" hideClose className="h-[84dvh] rounded-t-2xl border border-slate-200 bg-white p-0">
            <SheetTitle className="sr-only">{panelTitle}</SheetTitle>
            <SheetDescription className="sr-only">
              {mobileSheetDescription}
            </SheetDescription>
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-slate-200 px-4 py-3">
                <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-300" />
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">{panelTitle}</h2>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    onClick={() => setMobilePanelOpen(false)}
                  >
                    {hidePanelLabel}
                  </button>
                </div>
              </div>

              {explorerPanelContent}
              {detailPanelInner ? (
                <div className="mx-4 mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  {detailPanelInner}
                </div>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
      {children}
    </div>
  )
}
