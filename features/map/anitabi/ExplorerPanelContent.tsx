'use client'

import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { AnitabiBangumiCard, AnitabiMapTab } from '@/lib/anitabi/types'
import { L, type SearchResult } from './shared'

type ExplorerPanelContentProps = {
  label: (typeof L)['zh']
  styleMode: 'street' | 'satellite'
  onToggleStyleMode: () => void
  onRandom: () => void
  queryInput: string
  query: string
  setQueryInput: Dispatch<SetStateAction<string>>
  setQuery: Dispatch<SetStateAction<string>>
  searchOpen: boolean
  setSearchOpen: Dispatch<SetStateAction<boolean>>
  searchResult: SearchResult
  onSubmitQuery: () => void
  selectedCity: string
  setSelectedCity: Dispatch<SetStateAction<string>>
  cities: string[]
  tabs: Array<{ key: AnitabiMapTab; label: string }>
  tab: AnitabiMapTab
  setTab: Dispatch<SetStateAction<AnitabiMapTab>>
  showNearbyLocationCta: boolean
  locating: boolean
  onLocate: () => void
  loading: boolean
  hasSearchQuery: boolean
  cards: AnitabiBangumiCard[]
  selectedBangumiId: number | null
  onOpenBangumi: (id: number) => void
  onOpenPoint: (bangumiId: number, pointId: string) => void
  onHoverCardEnter: (id: number) => void
  onHoverCardLeave: () => void
  formatDistance: (meters: number) => string
  cardsContainerRef: RefObject<HTMLDivElement | null>
  cardsLoadMoreRef: RefObject<HTMLDivElement | null>
  loadingMoreCards: boolean
  cardsLoadError: string | null
  onRetryLoadMore: () => void
  hasMoreCards: boolean
}

export default function ExplorerPanelContent(
  props: ExplorerPanelContentProps
) {
  const {
    label,
    styleMode,
    onToggleStyleMode,
    onRandom,
    queryInput,
    query,
    setQueryInput,
    setQuery,
    searchOpen,
    setSearchOpen,
    searchResult,
    onSubmitQuery,
    selectedCity,
    setSelectedCity,
    cities,
    tabs,
    tab,
    setTab,
    showNearbyLocationCta,
    locating,
    onLocate,
    loading,
    hasSearchQuery,
    cards,
    selectedBangumiId,
    onOpenBangumi,
    onOpenPoint,
    onHoverCardEnter,
    onHoverCardLeave,
    formatDistance,
    cardsContainerRef,
    cardsLoadMoreRef,
    loadingMoreCards,
    cardsLoadError,
    onRetryLoadMore,
    hasMoreCards,
  } = props

  return (
    <>
      <div className="space-y-3 border-b border-slate-200 px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-slate-900">{label.title}</h1>
          <div className="flex items-center gap-1">
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              onClick={onToggleStyleMode}
              type="button"
            >
              {styleMode === 'street' ? label.satellite : label.street}
            </button>
            <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100" onClick={onRandom} type="button">
              {label.random}
            </button>
          </div>
        </div>

        <div className="relative">
          <div className="flex gap-2">
            <input
              id="anitabi-map-search"
              name="q"
              value={queryInput}
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => {
                const next = event.target.value
                setQueryInput(next)
                if (!next.trim() && query) {
                  setQuery('')
                  setSearchOpen(false)
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSubmitQuery()
              }}
              placeholder={label.searchPlaceholder}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400"
            />
            <button className="rounded-md bg-brand-500 px-3 py-2 text-xs font-medium text-white hover:bg-brand-600" onClick={onSubmitQuery} type="button">
              {label.search}
            </button>
          </div>

          {searchOpen && (searchResult.bangumi.length > 0 || searchResult.points.length > 0 || searchResult.cities.length > 0) ? (
            <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-xl">
              {searchResult.cities.slice(0, 6).map((city) => (
                <button
                  key={`city:${city}`}
                  type="button"
                  className="mb-1 block w-full rounded px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-100"
                  onClick={() => {
                    setSelectedCity(city)
                    setSearchOpen(false)
                  }}
                >
                  {label.searchCityPrefix}：{city}
                </button>
              ))}
              {searchResult.bangumi.slice(0, 10).map((item) => (
                <button
                  key={`bangumi:${item.id}`}
                  type="button"
                  className="mb-1 block w-full rounded px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-100"
                  onClick={() => {
                    onOpenBangumi(item.id)
                    setSearchOpen(false)
                  }}
                >
                  {label.searchAnimePrefix}：{item.title}
                </button>
              ))}
              {searchResult.points.slice(0, 10).map((point) => (
                <button
                  key={`point:${point.id}`}
                  type="button"
                  className="mb-1 block w-full rounded px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-100"
                  onClick={() => {
                    onOpenPoint(point.bangumiId, point.id)
                    setSearchOpen(false)
                  }}
                >
                  {label.searchPointPrefix}：{point.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded-full border px-2 py-1 text-xs ${!selectedCity ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
            onClick={() => setSelectedCity('')}
          >
            {label.allCities}
          </button>
          {cities.map((city) => (
            <button
              key={city}
              type="button"
              className={`rounded-full border px-2 py-1 text-xs ${selectedCity === city ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
              onClick={() => setSelectedCity(city)}
            >
              {city}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs ${tab === item.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={cardsContainerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {showNearbyLocationCta ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 text-center">
            <div className="text-sm text-slate-500">{label.nearbyNeedLocation}</div>
            <button
              type="button"
              className="rounded-full bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onLocate}
              disabled={locating}
            >
              {locating ? label.locating : label.nearbyGrantLocation}
            </button>
          </div>
        ) : null}
        {loading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, index) => (
              <div key={index} className="flex animate-pulse items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                <div className="h-16 w-12 shrink-0 rounded-md bg-slate-200" />
                <div className="min-w-0 flex-1 space-y-2 py-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="h-4 w-32 rounded bg-slate-200" />
                    <div className="h-4 w-10 rounded-full bg-slate-200" />
                  </div>
                  <div className="h-3 w-48 rounded bg-slate-200" />
                  <div className="mt-2 flex gap-1.5">
                    <div className="h-4 w-12 rounded-full bg-slate-100" />
                    <div className="h-4 w-12 rounded-full bg-slate-100" />
                    <div className="h-4 w-12 rounded-full bg-slate-100" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {!loading && !showNearbyLocationCta && cards.length === 0 ? (
          <div className="text-sm text-slate-500">{hasSearchQuery ? label.searchNoData : label.noData}</div>
        ) : null}
        {!showNearbyLocationCta ? (
          <>
            <div className="space-y-3">
              {cards.map((card, index) => {
                const swatchColor = card.color || '#ec4899'
                const prioritizeCardCover = index < 20
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => onOpenBangumi(card.id)}
                    className={`group w-full overflow-hidden rounded-2xl border text-left transition ${
                      selectedBangumiId === card.id
                        ? 'border-brand-400 bg-brand-50/70 shadow-[0_8px_22px_rgba(236,72,153,0.18)]'
                        : 'border-slate-200 bg-white hover:border-brand-200 hover:bg-brand-50/30'
                    }`}
                    onMouseEnter={() => onHoverCardEnter(card.id)}
                    onMouseLeave={onHoverCardLeave}
                    onTouchStart={() => onHoverCardEnter(card.id)}
                  >
                    <div className="h-1 w-full" style={{ background: swatchColor, opacity: selectedBangumiId === card.id ? 0.95 : 0.58 }} />
                    <div className="flex items-start gap-3 p-3">
                      <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                        {card.cover ? (
                          <img
                            src={card.cover}
                            alt={card.title}
                            width={96}
                            height={128}
                            className="h-full w-full object-cover"
                            loading={prioritizeCardCover ? 'eager' : 'lazy'}
                            fetchPriority={index < 4 ? 'high' : 'auto'}
                            decoding="async"
                          />
                        ) : (
                          <div className="grid h-full w-full place-items-center bg-slate-200 text-sm font-semibold text-slate-600">{card.title.slice(0, 1)}</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{card.title}</h3>
                          {card.cat ? <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">{card.cat}</span> : null}
                        </div>
                        {card.titleZh && card.titleZh !== card.title ? <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{card.titleZh}</div> : null}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                          {card.city ? <span className="rounded-full bg-slate-100 px-2 py-0.5">{card.city}</span> : null}
                          {card.nearestDistanceMeters != null ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{formatDistance(card.nearestDistanceMeters)}</span> : null}
                          <span className="rounded-full bg-slate-100 px-2 py-0.5">{card.pointsLength} {label.points}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5">{card.imagesLength} {label.screenshots}</span>
                        </div>
                      </div>
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-white shadow-sm" style={{ background: swatchColor }} />
                    </div>
                  </button>
                )
              })}
            </div>
            <div ref={cardsLoadMoreRef} className="h-2" />
            {loadingMoreCards ? <div className="pt-3 text-center text-xs text-slate-500">{label.loadingMore}</div> : null}
            {cardsLoadError ? (
              <div className="flex items-center justify-center gap-2 pt-3 text-xs text-rose-600">
                <span>{cardsLoadError}</span>
                <button
                  type="button"
                  onClick={onRetryLoadMore}
                  className="rounded border border-rose-200 bg-white px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
                >
                  {label.retry}
                </button>
              </div>
            ) : null}
            {!loading && !loadingMoreCards && !hasMoreCards && cards.length > 0 ? (
              <div className="pt-3 text-center text-xs text-slate-400">{label.loadedAll}</div>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  )
}
