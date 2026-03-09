'use client'

import type { CSSProperties } from 'react'
import { ExternalLink, Layers3, MapPinned, X } from 'lucide-react'
import type { AnitabiPointDTO } from '@/lib/anitabi/types'

export type PointPopupAnchor = {
  x: number
  y: number
  placement: 'top' | 'bottom'
  tipOffsetX: number
}

type ResolvePointPopupAnchorOptions = {
  x: number
  y: number
  viewportWidth: number
  viewportHeight: number
  cardWidth?: number
  edgePadding?: number
}

type PointPopupCardLabels = {
  pointDetail: string
  workDetail: string
  openInGoogle: string
  enterPanorama: string
  close: string
}

export type PointPopupCardProps = {
  point: AnitabiPointDTO
  anchor: PointPopupAnchor
  imageUrl: string | null
  distanceLabel?: string | null
  googleHref?: string | null
  labels: PointPopupCardLabels
  onShowWorkDetail: () => void
  onEnterPanorama: () => void
  onClose: () => void
  panoramaAvailable: boolean
  panoramaUnavailableLabel?: string
}

export function resolvePointPopupAnchor({
  x,
  y,
  viewportWidth,
  viewportHeight,
  cardWidth = 248,
  edgePadding = 16,
}: ResolvePointPopupAnchorOptions): PointPopupAnchor {
  const halfWidth = cardWidth / 2
  const minCenterX = halfWidth + edgePadding
  const maxCenterX = Math.max(minCenterX, viewportWidth - halfWidth - edgePadding)
  const centerX = Math.min(Math.max(x, minCenterX), maxCenterX)
  const placement = y > viewportHeight * 0.42 ? 'top' : 'bottom'
  const maxTipOffset = Math.max(0, halfWidth - 26)
  const tipOffsetX = Math.min(Math.max(x - centerX, -maxTipOffset), maxTipOffset)

  return {
    x: centerX,
    y,
    placement,
    tipOffsetX,
  }
}

function buildMetaChips(point: AnitabiPointDTO, distanceLabel?: string | null): string[] {
  const chips: string[] = []
  if (point.origin) chips.push(point.origin)
  if (distanceLabel) chips.push(distanceLabel)
  return chips
}

export function PointPopupCard({
  point,
  anchor,
  imageUrl,
  distanceLabel,
  googleHref,
  labels,
  onShowWorkDetail,
  onEnterPanorama,
  onClose,
  panoramaAvailable,
  panoramaUnavailableLabel,
}: PointPopupCardProps) {
  const displayName = point.nameZh || point.name
  const metaChips = buildMetaChips(point, distanceLabel)
  const imageSrc = String(imageUrl || '').trim()
  const floatingStyle: CSSProperties = {
    left: `${anchor.x}px`,
    top: `${anchor.y + (anchor.placement === 'top' ? -18 : 18)}px`,
    transform: anchor.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div
        className="pointer-events-auto absolute w-[248px] max-w-[calc(100%-1.5rem)]"
        style={floatingStyle}
      >
        <div className="relative overflow-hidden rounded-[22px] border border-white/80 bg-white/95 shadow-[0_24px_64px_rgba(15,23,42,0.3)] backdrop-blur-md">
          <div
            className={`absolute h-4 w-4 rotate-45 border border-white/80 bg-white/95 ${
              anchor.placement === 'top' ? '-bottom-2' : '-top-2'
            }`}
            style={{ left: `calc(50% + ${anchor.tipOffsetX}px - 8px)` }}
            aria-hidden="true"
          />

          <div className="relative aspect-[16/10] overflow-hidden bg-slate-200">
            {imageSrc ? (
              <img
                src={imageSrc}
                alt={displayName}
                width={496}
                height={310}
                className="h-full w-full object-cover"
                loading="eager"
                decoding="async"
              />
            ) : (
              <div className="grid h-full w-full place-items-center bg-slate-200 text-xs font-medium text-slate-500">
                {labels.pointDetail}
              </div>
            )}

            <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
              <span className="rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/90 backdrop-blur-sm">
                {labels.pointDetail}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-black/40 text-white/90 backdrop-blur-sm hover:bg-black/55"
                aria-label={labels.close}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {(point.ep || point.s) ? (
              <div className="absolute inset-x-3 bottom-3 flex items-center justify-end gap-1.5">
                {point.ep ? (
                  <span className="rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                    EP {point.ep}
                  </span>
                ) : null}
                {point.s ? (
                  <span className="rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                    {point.s}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-3 px-3 pb-3 pt-2.5">
            <div className="space-y-2">
              <div className="line-clamp-2 text-[15px] font-semibold leading-5 text-slate-900">
                {displayName}
              </div>

              {metaChips.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {metaChips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              ) : null}

              {point.note ? (
                <p className="line-clamp-2 text-[11px] leading-4 text-slate-600">
                  {point.note}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onShowWorkDetail}
                className="inline-flex min-w-[90px] flex-1 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
              >
                <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
                {labels.workDetail}
              </button>

              {googleHref ? (
                <a
                  href={googleHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-[90px] flex-1 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-slate-900 px-3 py-2 text-[11px] font-medium text-white no-underline hover:bg-slate-700"
                >
                  <MapPinned className="h-3.5 w-3.5" aria-hidden="true" />
                  {labels.openInGoogle}
                </a>
              ) : null}

              <button
                type="button"
                onClick={onEnterPanorama}
                disabled={!panoramaAvailable}
                title={panoramaAvailable ? undefined : panoramaUnavailableLabel}
                className="inline-flex min-w-[90px] flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-500 px-3 py-2 text-[11px] font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-300"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                {labels.enterPanorama}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
