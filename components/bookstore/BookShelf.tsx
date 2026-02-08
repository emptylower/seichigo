'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PublicPostListItem } from '@/lib/posts/types'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { t } from '@/lib/i18n'
import BookCover from './BookCover'

const SCROLL_EDGE_EPSILON = 4
const DRAG_THRESHOLD_PX = 6

const shelfUiCopy: Record<SiteLocale, { prev: string; next: string }> = {
  zh: { prev: '向左查看作品', next: '向右查看作品' },
  en: { prev: 'Scroll left', next: 'Scroll right' },
  ja: { prev: '左にスクロール', next: '右にスクロール' },
}

function formatLine(item: Pick<PublicPostListItem, 'animeIds' | 'city'>): string {
  const animeLabel = item.animeIds?.length ? item.animeIds.join('、') : 'unknown'
  const parts = [animeLabel, item.city].filter(Boolean)
  return parts.join(' · ')
}

function SkeletonTile({ seed }: { seed: number }) {
  const hue = (seed * 47) % 360
  return (
    <div className="w-72 shrink-0">
      <div
        className="relative aspect-video w-full overflow-hidden rounded-xl bg-gray-100 shadow-sm"
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 20% 96%), hsl(${(hue + 28) % 360} 30% 92%))`,
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/5 via-transparent to-transparent" />
        <div className="absolute inset-x-4 bottom-4 space-y-2">
          <div className="h-4 w-3/4 rounded bg-white/60" />
          <div className="h-3 w-1/2 rounded bg-white/50" />
        </div>
      </div>
      <div className="mt-3 space-y-1 px-1">
        <div className="h-5 w-11/12 rounded bg-gray-100" />
        <div className="h-4 w-2/3 rounded bg-gray-50" />
      </div>
    </div>
  )
}

function BookTile({ item }: { item: PublicPostListItem }) {
  return (
    <Link href={item.path} className="group w-72 shrink-0 no-underline hover:no-underline">
      <BookCover
        path={item.path}
        title={item.title}
        animeIds={item.animeIds}
        city={item.city}
        routeLength={item.routeLength}
        publishDate={item.publishDate}
        cover={item.cover}
      />
      <div className="mt-3 px-1 space-y-1">
        <div className="line-clamp-2 text-base font-bold leading-snug text-gray-900 transition-colors group-hover:text-brand-600">
          {item.title}
        </div>
        <div className="text-xs text-gray-500">{formatLine(item) || '—'}</div>
      </div>
    </Link>
  )
}

export default function BookShelf({ items, locale }: { items: PublicPostListItem[]; locale: SiteLocale }) {
  const shelfRef = useRef<HTMLDivElement | null>(null)
  const isMouseDownRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartScrollLeftRef = useRef(0)
  const didDragRef = useRef(false)
  const suppressClickRef = useRef(false)
  const suppressClickTimerRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [canScrollPrev, setCanScrollPrev] = useState(false)
  const [canScrollNext, setCanScrollNext] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)

  const updateScrollState = useCallback(() => {
    const el = shelfRef.current
    if (!el) return
    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth)
    setIsOverflowing(maxScrollLeft > SCROLL_EDGE_EPSILON)
    setCanScrollPrev(el.scrollLeft > SCROLL_EDGE_EPSILON)
    setCanScrollNext(el.scrollLeft < maxScrollLeft - SCROLL_EDGE_EPSILON)
  }, [])

  useEffect(() => {
    const el = shelfRef.current
    if (!el) return

    updateScrollState()

    const onScroll = () => updateScrollState()
    el.addEventListener('scroll', onScroll, { passive: true })

    const onWindowResize = () => updateScrollState()
    window.addEventListener('resize', onWindowResize)

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => updateScrollState())
      observer.observe(el)
    }

    return () => {
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onWindowResize)
      observer?.disconnect()
    }
  }, [updateScrollState, items.length])

  useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current)
      }
    }
  }, [])

  const scrollByStep = useCallback((direction: -1 | 1) => {
    const el = shelfRef.current
    if (!el) return
    const step = Math.max(260, Math.round(el.clientWidth * 0.9))
    el.scrollBy({ left: direction * step, behavior: 'smooth' })
  }, [])

  const endMouseDrag = useCallback(() => {
    const el = shelfRef.current
    if (!el || !isMouseDownRef.current) return
    isMouseDownRef.current = false
    setIsDragging(false)
    if (didDragRef.current) {
      suppressClickRef.current = true
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current)
      }
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
        suppressClickTimerRef.current = null
      }, 120)
    }
  }, [])

  const handleMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const el = shelfRef.current
    if (!el) return
    isMouseDownRef.current = true
    dragStartXRef.current = event.clientX
    dragStartScrollLeftRef.current = el.scrollLeft
    didDragRef.current = false
    setIsDragging(true)
  }, [])

  const handleMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const el = shelfRef.current
    if (!el || !isMouseDownRef.current) return
    const deltaX = event.clientX - dragStartXRef.current
    if (!didDragRef.current && Math.abs(deltaX) > DRAG_THRESHOLD_PX) {
      didDragRef.current = true
    }
    if (!didDragRef.current) return
    el.scrollLeft = dragStartScrollLeftRef.current - deltaX
    event.preventDefault()
  }, [])

  const handleClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return
    event.preventDefault()
    event.stopPropagation()
    suppressClickRef.current = false
  }, [])

  const labels = shelfUiCopy[locale]
  const cursorClass = isOverflowing ? (isDragging ? 'cursor-grabbing select-none' : 'cursor-grab') : ''

  if (!items?.length) {
    return (
      <div className="space-y-3">
        <div className="flex gap-4 overflow-x-auto pb-2 pr-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {Array.from({ length: 8 }).map((_, idx) => (
            <SkeletonTile key={idx} seed={idx + 1} />
          ))}
        </div>
        <div className="text-sm text-gray-500">{t('pages.components.bookShelf.emptyState', locale)}</div>
      </div>
    )
  }

  return (
    <div className="relative">
      {isOverflowing && canScrollPrev ? (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-16 bg-gradient-to-r from-white via-white/70 to-transparent md:block" />
      ) : null}
      {isOverflowing && canScrollNext ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden w-16 bg-gradient-to-l from-white via-white/70 to-transparent md:block" />
      ) : null}

      {isOverflowing ? (
        <>
          <button
            type="button"
            aria-label={labels.prev}
            onClick={() => scrollByStep(-1)}
            disabled={!canScrollPrev}
            className="absolute left-2 top-1/2 z-20 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-700 shadow-sm transition hover:bg-white hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35 md:flex"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={labels.next}
            onClick={() => scrollByStep(1)}
            disabled={!canScrollNext}
            className="absolute right-2 top-1/2 z-20 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-700 shadow-sm transition hover:bg-white hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35 md:flex"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      ) : null}

      <div
        ref={shelfRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endMouseDrag}
        onMouseLeave={endMouseDrag}
        onClickCapture={handleClickCapture}
        className={`flex gap-4 overflow-x-auto pb-2 pr-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${cursorClass}`}
      >
        {items.map((item) => (
          <BookTile key={item.path} item={item} />
        ))}
      </div>
    </div>
  )
}
