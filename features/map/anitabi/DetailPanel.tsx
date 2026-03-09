'use client'

import type { ReactNode } from 'react'
import type { AnitabiBangumiDTO, AnitabiPointDTO } from '@/lib/anitabi/types'
import { L } from './shared'

type DetailPointItem = {
  point: AnitabiPointDTO
  distanceMeters: number | null
}

type DetailPanelProps = {
  label: (typeof L)['zh']
  detail: AnitabiBangumiDTO | null
  detailCardMode: 'bangumi' | 'point'
  selectedPoint: AnitabiPointDTO | null
  selectedPointState: string | null
  selectedPointDistanceMeters: number | null
  selectedPointPanoramaAvailable: boolean
  detailLoading: boolean
  workDetailExpanded: boolean
  quickPilgrimageProgress: { checked: number; total: number }
  viewFilter: 'all' | 'marked'
  stateFilter: string[]
  detailPoints: DetailPointItem[]
  selectedPointImage: ReactNode
  showWantToGoAction: boolean
  checkedInSelectedPoint: boolean
  formatDistance: (meters: number) => string
  geoHref: string | null
  onCloseWorkDetail: () => void
  onSwitchToBangumiDetail: () => void
  onToggleWorkDetailExpanded: () => void
  onShowQuickPilgrimage: () => void
  onChangeViewFilter: (value: 'all' | 'marked') => void
  onToggleStateFilter: (value: 'want_to_go' | 'planned' | 'checked_in') => void
  onSelectPoint: (point: AnitabiPointDTO) => void
  onAddSelectedPointToPool: () => void
  onShowCheckInCard: () => void
  onEnterPanorama: () => void
  onAddPointToPool: (pointId: string) => void
  getPointState: (pointId: string) => string
}

export default function DetailPanel(props: DetailPanelProps) {
  const {
    label,
    detail,
    detailCardMode,
    selectedPoint,
    selectedPointState,
    selectedPointDistanceMeters,
    selectedPointPanoramaAvailable,
    detailLoading,
    workDetailExpanded,
    quickPilgrimageProgress,
    viewFilter,
    stateFilter,
    detailPoints,
    selectedPointImage,
    showWantToGoAction,
    checkedInSelectedPoint,
    formatDistance,
    geoHref,
    onCloseWorkDetail,
    onSwitchToBangumiDetail,
    onToggleWorkDetailExpanded,
    onShowQuickPilgrimage,
    onChangeViewFilter,
    onToggleStateFilter,
    onSelectPoint,
    onAddSelectedPointToPool,
    onShowCheckInCard,
    onEnterPanorama,
    onAddPointToPool,
    getPointState,
  } = props

  if (!detail) return null

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-xs font-medium text-slate-500">
          {detailCardMode === 'point' ? label.pointDetail : label.workDetail}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
            onClick={onCloseWorkDetail}
          >
            {label.close}
          </button>
        </div>
      </div>

      {detailCardMode === 'point' && selectedPoint ? (
        <div className="space-y-2 border-b border-slate-200 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label.pointDetail}</div>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
              onClick={onSwitchToBangumiDetail}
            >
              {label.backToWorkDetail}
            </button>
          </div>
          <div className="text-sm font-medium text-slate-900">{selectedPoint.name}</div>
          {selectedPointImage}
          <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
            {selectedPoint.ep ? <span>EP {selectedPoint.ep}</span> : null}
            {selectedPoint.s ? <span>· {selectedPoint.s}</span> : null}
            {selectedPoint.origin ? <span>· {selectedPoint.origin}</span> : null}
            {selectedPointDistanceMeters != null ? <span>· ~{formatDistance(selectedPointDistanceMeters)}</span> : null}
          </div>
          {selectedPoint.note ? (
            <div className="rounded-md bg-slate-50 px-2 py-1 text-xs leading-relaxed text-slate-700">
              {selectedPoint.note}
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
            <div className="text-[11px] text-slate-600">{label.stateAutoHint}</div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              {(['want_to_go', 'planned', 'checked_in'] as const).map((state) => (
                <span
                  key={state}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    selectedPointState === state
                      ? state === 'checked_in'
                        ? 'bg-green-500 text-white'
                        : state === 'planned'
                          ? 'bg-orange-500 text-white'
                          : 'bg-blue-500 text-white'
                      : 'bg-white text-slate-500 ring-1 ring-slate-200'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {state === 'checked_in' ? label.checkedIn : state === 'planned' ? label.planned : label.wantToGo}
                </span>
              ))}
            </div>
            {selectedPointState === 'want_to_go' ? (
              <div className="mt-2 text-[11px] text-blue-600">{label.pointAlreadyInPoolHint}</div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {geoHref ? (
              <a className="inline-flex min-w-[92px] items-center justify-center rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white no-underline hover:bg-slate-700" href={geoHref} target="_blank" rel="noreferrer">
                {label.openInGoogle}
              </a>
            ) : null}
            <button
              type="button"
              className="inline-flex min-w-[92px] items-center justify-center rounded bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-55"
              onClick={onEnterPanorama}
              disabled={!selectedPointPanoramaAvailable}
              title={selectedPointPanoramaAvailable ? undefined : label.panoramaUnavailable}
            >
              {label.enterPanorama}
            </button>
            {showWantToGoAction ? (
              <button
                type="button"
                className="inline-flex min-w-[108px] items-center justify-center rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                onClick={onAddSelectedPointToPool}
              >
                {label.addToPointPool}
              </button>
            ) : null}
            {checkedInSelectedPoint ? (
              <button
                type="button"
                className="inline-flex min-w-[92px] items-center justify-center rounded border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
                onClick={onShowCheckInCard}
              >
                打卡卡片
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-3 border-b border-slate-200 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label.workDetail}</div>
            <div className="flex items-start gap-3">
              <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                {detail.card.cover ? (
                  <img
                    src={detail.card.cover}
                    alt={detail.card.title}
                    width={96}
                    height={144}
                    className="h-full w-full object-cover"
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-slate-200 text-base font-semibold text-slate-600">
                    {detail.card.title.slice(0, 1)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="line-clamp-1 text-sm font-semibold text-slate-900">{detail.card.title}</div>
                <div className="text-[11px] text-slate-500">
                  {detail.card.city || '-'} · {detailLoading ? (
                    <span className="inline-block h-3 w-8 animate-pulse rounded bg-slate-100 align-middle" />
                  ) : (
                    detail.points.length
                  )} {label.points}
                </div>
                {detailLoading ? (
                  <div className="space-y-1 py-1">
                    <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
                  </div>
                ) : detail.description ? (
                  <div className="space-y-1">
                    <div className={workDetailExpanded ? 'max-h-40 overflow-y-auto pr-1' : ''}>
                      <p className={`text-xs leading-relaxed text-slate-700 ${workDetailExpanded ? '' : 'line-clamp-6'}`}>
                        {detail.description}
                      </p>
                    </div>
                    {detail.description.length > 140 ? (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                        onClick={onToggleWorkDetailExpanded}
                      >
                        {workDetailExpanded ? label.collapseWorkDetail : label.expandWorkDetail}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-slate-500">{label.noData}</p>
                )}
              </div>
            </div>
            {detailLoading ? (
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3].map((index) => (
                  <div key={index} className="h-4 w-12 animate-pulse rounded-full bg-slate-100" />
                ))}
              </div>
            ) : detail.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {detail.tags.slice(0, 8).map((tag) => (
                  <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="rounded-lg border border-brand-100 bg-brand-50/70 px-2 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-brand-700">{label.quickPilgrimage}</div>
                  <div className="line-clamp-2 text-[11px] text-brand-600">{label.quickPilgrimageHint}</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded bg-brand-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-brand-600"
                  onClick={onShowQuickPilgrimage}
                >
                  {label.quickPilgrimage}
                </button>
              </div>
              <div className="mt-1 text-[11px] text-brand-700">
                {label.quickPilgrimageProgressPrefix} {quickPilgrimageProgress.checked}/{quickPilgrimageProgress.total}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex rounded bg-slate-200/50 p-0.5">
              <button
                type="button"
                onClick={() => onChangeViewFilter('all')}
                className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                  viewFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label.allPoints}
              </button>
              <button
                type="button"
                onClick={() => onChangeViewFilter('marked')}
                className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                  viewFilter === 'marked' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label.onlyMarked}
              </button>
            </div>

            {viewFilter === 'marked' ? (
              <div className="flex w-full flex-wrap items-center justify-center gap-1.5">
                {(['want_to_go', 'planned', 'checked_in'] as const).map((state) => (
                  <button
                    key={state}
                    type="button"
                    onClick={() => onToggleStateFilter(state)}
                    className={`flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-medium transition ${
                      stateFilter.includes(state) || stateFilter.length === 0
                        ? state === 'checked_in'
                          ? 'bg-green-500 text-white'
                          : state === 'planned'
                            ? 'bg-orange-500 text-white'
                            : 'bg-blue-500 text-white'
                        : 'bg-slate-200 text-slate-400'
                    }`}
                  >
                    <div className="h-1 w-1 rounded-full bg-white" />
                    {state === 'checked_in' ? label.checkedIn : state === 'planned' ? label.planned : label.wantToGo}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="max-h-[420px] overflow-auto px-3 py-2">
            {detailLoading ? (
              <div className="space-y-3 py-2">
                {[1, 2, 3, 4].map((index) => (
                  <div key={index} className="flex flex-col gap-2 rounded px-2 py-1.5">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : null}
            {!detailLoading && detailPoints.length === 0 ? <div className="py-4 text-sm text-slate-500">{label.noData}</div> : null}
            <div className="space-y-1">
              {detailPoints.map(({ point, distanceMeters }) => {
                const pointState = getPointState(point.id)
                const showPointWantToGo = pointState === 'none'
                return (
                  <div
                    key={point.id}
                    className={`block w-full rounded px-2 py-1.5 text-left text-xs ${
                      selectedPoint?.id === point.id ? 'bg-brand-100 text-brand-800' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => onSelectPoint(point)}
                      >
                        <div className="line-clamp-1 font-medium">{point.name}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {point.ep ? `EP ${point.ep}` : ''}
                          {distanceMeters != null ? `${point.ep ? ' · ' : ''}~${formatDistance(distanceMeters)}` : ''}
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {pointState === 'want_to_go' ? (
                          <span className="rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white">{label.wantToGo}</span>
                        ) : null}
                        {pointState === 'planned' ? (
                          <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-medium text-white">{label.planned}</span>
                        ) : null}
                        {pointState === 'checked_in' ? (
                          <span className="rounded-full bg-green-500 px-1.5 py-0.5 text-[10px] font-medium text-white">{label.checkedIn}</span>
                        ) : null}
                        {showPointWantToGo ? (
                          <button
                            type="button"
                            className="rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
                            onClick={(event) => {
                              event.stopPropagation()
                              onAddPointToPool(point.id)
                            }}
                          >
                            {label.addToPointPool}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  )
}
