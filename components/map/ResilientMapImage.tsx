'use client'

import { useEffect, useState } from 'react'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'

type ResilientMapImageProps = {
  src: string | null | undefined
  alt: string
  className?: string
  loading?: 'eager' | 'lazy'
  decoding?: 'async' | 'auto' | 'sync'
  width?: number
  height?: number
  kind?: 'cover' | 'point' | 'point-preview' | 'default'
  fallback?: React.ReactNode
  firstViewSlotKey?: string | null
  onFirstViewRequestStart?: (input: { slotKey: string; src: string }) => void
  onFirstViewSettle?: (input: { slotKey: string; src: string; state: 'visible' | 'fallback' }) => void
}

function withRetryNonce(url: string, retryNonce: number): string {
  if (!url || retryNonce <= 0 || !url.includes('/api/anitabi/image-render')) {
    return url
  }

  try {
    const resolved = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com')
    resolved.searchParams.set('_retry', String(retryNonce))
    return resolved.toString()
  } catch {
    return url
  }
}

export default function ResilientMapImage({
  src,
  alt,
  className,
  loading = 'lazy',
  decoding = 'async',
  width,
  height,
  kind = 'default',
  fallback = null,
  firstViewSlotKey,
  onFirstViewRequestStart,
  onFirstViewSettle,
}: ResilientMapImageProps) {
  const raw = String(src || '').trim()
  const [retryNonce, setRetryNonce] = useState(0)
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [failed, setFailed] = useState(!raw)

  useEffect(() => {
    setCandidateIndex(0)
    setRetryNonce(0)
    setFailed(!raw)
  }, [raw])

  const candidates = raw ? getMapDisplayImageCandidates(raw, { kind }) : []
  const currentCandidate = candidates[candidateIndex] || raw
  const resolvedSrc = currentCandidate ? withRetryNonce(currentCandidate, retryNonce) : ''

  useEffect(() => {
    if (!firstViewSlotKey || !resolvedSrc || failed) return
    onFirstViewRequestStart?.({ slotKey: firstViewSlotKey, src: resolvedSrc })
  }, [failed, firstViewSlotKey, onFirstViewRequestStart, resolvedSrc])

  if (!raw || failed) {
    return <>{fallback}</>
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      width={width}
      height={height}
      className={className}
      loading={loading}
      decoding={decoding}
      onLoad={() => {
        if (!firstViewSlotKey) return
        onFirstViewSettle?.({ slotKey: firstViewSlotKey, src: resolvedSrc, state: 'visible' })
      }}
      onError={() => {
        if (candidateIndex + 1 < candidates.length) {
          setCandidateIndex((value) => value + 1)
          setRetryNonce(0)
          return
        }
        if (resolvedSrc.includes('/api/anitabi/image-render') && retryNonce < 1) {
          setRetryNonce((value) => value + 1)
          return
        }
        if (firstViewSlotKey) {
          onFirstViewSettle?.({ slotKey: firstViewSlotKey, src: resolvedSrc, state: 'fallback' })
        }
        setFailed(true)
      }}
    />
  )
}
