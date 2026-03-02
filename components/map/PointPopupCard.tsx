'use client'

import { useEffect, useRef } from 'react'
import type { AnitabiPointDTO, AnitabiBangumiCard } from '@/lib/anitabi/types'

export interface PointPopupCardProps {
  point: AnitabiPointDTO
  bangumi: AnitabiBangumiCard
  onClose: () => void
  anchorPosition: { x: number; y: number }
}

export function PointPopupCard({
  point,
  bangumi,
  onClose,
  anchorPosition,
}: PointPopupCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  const getCardStyle = (): React.CSSProperties => {
    const cardWidth = 320
    const cardHeight = 400
    const padding = 16
    let left = anchorPosition.x
    let top = anchorPosition.y + 10
    if (left + cardWidth > window.innerWidth - padding) {
      left = window.innerWidth - cardWidth - padding
    }
    if (left < padding) left = padding
    if (top + cardHeight > window.innerHeight - padding) {
      top = anchorPosition.y - cardHeight - 10
    }
    if (top < padding) top = padding
    return { position: 'fixed', left: `${left}px`, top: `${top}px`, zIndex: 1000 }
  }

  const displayName = point.nameZh || point.name
  const displayTitle = bangumi.titleZh || bangumi.title
  const hasImage = point.image && point.image.trim() !== ''
  const hasEp = point.ep && point.ep.trim() !== ''
  const googleMapsUrl = point.geo
    ? `https://www.google.com/maps/search/?api=1&query=${point.geo[0]},${point.geo[1]}`
    : null

  return (
    <div ref={cardRef} style={getCardStyle()} className="w-80 bg-white rounded-lg shadow-lg overflow-hidden">
      {hasImage ? (
        <div className="relative w-full h-48">
          <img src={point.image} alt={displayName} className="w-full h-full object-cover" loading="lazy" />
          {hasEp && (
            <div className="absolute bottom-2 left-2 bg-black/70 text-white px-2 py-1 rounded text-sm font-medium">
              {point.ep}
            </div>
          )}
        </div>
      ) : (
        <div className="w-full h-48 bg-gray-100 flex items-center justify-center">
          <div className="text-gray-400 text-sm">暂无图片</div>
        </div>
      )}
      <div className="p-4 space-y-3">
        <h3 className="font-bold text-lg text-gray-900 line-clamp-2">{displayName}</h3>
        <p className="text-sm font-medium line-clamp-1" style={{ color: bangumi.color || '#ec4899' }}>
          {displayTitle}
        </p>
        {point.note && <p className="text-sm text-gray-600 line-clamp-2">{point.note}</p>}
        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
          {googleMapsUrl && (
            <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
              </svg>
              <span>地图</span>
            </a>
          )}
          {point.originUrl && (
            <a href={point.originUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span>来源</span>
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
