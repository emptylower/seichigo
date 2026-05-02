'use client'

import { useEffect, useRef, useState } from 'react'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
import {
  clearMapImageHostDegraded,
  isMapImageProxyUrl,
  markMapImageHostDegraded,
  type MapImageHostPolicyScope,
  prioritizeMapImageCandidates,
  readMapImageHost,
  resolveHostTimeoutMs,
} from '@/components/map/utils/mapImageHostPolicy'
import {
  acquireTimedMapImageRequestSlot,
  type MapImageRequestLease,
} from '@/features/map/anitabi/mapImageRequestScheduler'

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
  diagnosticSurface?: 'map' | 'nearby'
  diagnosticSlotKey?: string | null
  onDiagnosticRequestStart?: (input: {
    slotKey: string
    surface: 'map' | 'nearby'
    requestedCandidateUrl: string
    candidateIndex: number
    candidateCount: number
    reuseChain: boolean
    queueWaitMs?: number
  }) => {
    requestUrl: string
    requestId: string
  } | null
  onDiagnosticRequestTerminal?: (input: {
    handle: { requestUrl: string; requestId: string } | null
    terminalState: 'succeeded' | 'failed' | 'aborted' | 'superseded'
    displayOutcome?: 'visible' | 'fallback'
    finalUrl: string
    chainTerminal: boolean
    outcome?: string
  }) => void
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

function resolveRequestTimeoutMs(
  url: string,
  kind: ResilientMapImageProps['kind'],
): number {
  const isProxyRequest = url.includes('/api/anitabi/image-render')
  const baseTimeoutMs = !isProxyRequest
    ? 4_000
    : kind === 'point' || kind === 'point-preview'
    ? 8_500
    : 6_000
  const scope = resolveHostPolicyScope(kind)
  const host = readMapImageHost(url)
  return resolveHostTimeoutMs(host, scope, baseTimeoutMs, Date.now())
}

function resolveRequestLane(): 'interaction-critical' {
  return 'interaction-critical'
}

function resolveHostPolicyScope(kind: ResilientMapImageProps['kind']): MapImageHostPolicyScope {
  if (kind === 'cover') return 'cover'
  if (kind === 'point' || kind === 'point-preview') return 'point'
  return 'default'
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
  diagnosticSurface,
  diagnosticSlotKey,
  onDiagnosticRequestStart,
  onDiagnosticRequestTerminal,
}: ResilientMapImageProps) {
  const raw = String(src || '').trim()
  const hostPolicyScope = resolveHostPolicyScope(kind)
  const [retryNonce, setRetryNonce] = useState(0)
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [failed, setFailed] = useState(!raw)
  const [requestSrc, setRequestSrc] = useState('')
  const activeRequestRef = useRef<{ requestUrl: string; requestId: string } | null>(null)
  const activeLeaseRef = useRef<MapImageRequestLease | null>(null)
  const timeoutIdRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const diagnosticRequestStartRef = useRef<typeof onDiagnosticRequestStart>(onDiagnosticRequestStart)
  const diagnosticRequestTerminalRef = useRef<typeof onDiagnosticRequestTerminal>(onDiagnosticRequestTerminal)
  const lastRawRef = useRef(raw)
  const candidateQueueRef = useRef<string[]>(
    raw ? prioritizeMapImageCandidates(getMapDisplayImageCandidates(raw, { kind }), hostPolicyScope) : [],
  )
  const rawChanged = lastRawRef.current !== raw
  diagnosticRequestStartRef.current = onDiagnosticRequestStart
  diagnosticRequestTerminalRef.current = onDiagnosticRequestTerminal

  useEffect(() => {
    finishActiveRequest({
      terminalState: 'superseded',
      chainTerminal: true,
      outcome: 'source_replaced',
    })
    setCandidateIndex(0)
    setRetryNonce(0)
    setFailed(!raw)
    setRequestSrc('')
    candidateQueueRef.current = raw
      ? prioritizeMapImageCandidates(getMapDisplayImageCandidates(raw, { kind }), hostPolicyScope)
      : []
    lastRawRef.current = raw
  }, [hostPolicyScope, kind, raw])

  const candidates = candidateQueueRef.current
  const currentCandidate = candidates[candidateIndex] || raw
  const resolvedSrc = currentCandidate ? withRetryNonce(currentCandidate, retryNonce) : ''
  const trackedCandidateCount =
    candidates.length + (candidates.some((candidate) => candidate.includes('/api/anitabi/image-render')) ? 1 : 0)
  const diagnosticsEnabled = Boolean(
    diagnosticSlotKey
    && diagnosticSurface
    && (diagnosticSurface === 'map' || diagnosticSurface === 'nearby'),
  )

  const clearRequestTimeout = () => {
    if (timeoutIdRef.current == null) return
    globalThis.clearTimeout(timeoutIdRef.current)
    timeoutIdRef.current = null
  }

  const finishActiveRequest = (input: {
    terminalState: 'succeeded' | 'failed' | 'aborted' | 'superseded'
    displayOutcome?: 'visible' | 'fallback'
    chainTerminal: boolean
    outcome?: string
  }) => {
    clearRequestTimeout()
    activeLeaseRef.current?.release()
    activeLeaseRef.current = null
    if (!activeRequestRef.current) return
    diagnosticRequestTerminalRef.current?.({
      handle: activeRequestRef.current,
      terminalState: input.terminalState,
      displayOutcome: input.displayOutcome,
      finalUrl: activeRequestRef.current.requestUrl,
      chainTerminal: input.chainTerminal,
      outcome: input.outcome,
    })
    activeRequestRef.current = null
  }

  const advanceAfterFailure = (outcome: 'network_error' | 'timeout') => {
    if (candidateIndex + 1 < candidates.length) {
      if (!isMapImageProxyUrl(currentCandidate)) {
        markMapImageHostDegraded(readMapImageHost(currentCandidate), hostPolicyScope)
      }
      finishActiveRequest({
        terminalState: 'failed',
        chainTerminal: false,
        outcome,
      })
      setCandidateIndex((value) => value + 1)
      setRetryNonce(0)
      return
    }
    if (resolvedSrc.includes('/api/anitabi/image-render') && retryNonce < 1) {
      finishActiveRequest({
        terminalState: 'failed',
        chainTerminal: false,
        outcome,
      })
      setRetryNonce((value) => value + 1)
      return
    }
    finishActiveRequest({
      terminalState: 'succeeded',
      displayOutcome: 'fallback',
      chainTerminal: true,
      outcome,
    })
    setFailed(true)
  }

  useEffect(() => {
    if (rawChanged) {
      return
    }
    if (!resolvedSrc || failed) {
      finishActiveRequest({
        terminalState: 'aborted',
        chainTerminal: true,
        outcome: 'request_cleared',
      })
      setRequestSrc('')
      return
    }
    const abortController = new AbortController()

    void (async () => {
      try {
        const { lease, queueWaitMs } = await acquireTimedMapImageRequestSlot({
          lane: resolveRequestLane(),
          signal: abortController.signal,
        })
        if (abortController.signal.aborted) {
          lease.release()
          return
        }
        activeLeaseRef.current = lease
        if (!diagnosticsEnabled) {
          activeRequestRef.current = null
          setRequestSrc(resolvedSrc)
          return
        }
        const handle = diagnosticRequestStartRef.current?.({
          slotKey: diagnosticSlotKey!,
          surface: diagnosticSurface!,
          requestedCandidateUrl: resolvedSrc,
          candidateIndex,
          candidateCount: trackedCandidateCount,
          reuseChain: candidateIndex > 0 || retryNonce > 0,
          queueWaitMs,
        }) ?? null
        activeRequestRef.current = handle
        setRequestSrc(handle?.requestUrl || resolvedSrc)
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return
        setFailed(true)
      }
    })()

    return () => {
      abortController.abort()
    }
  }, [
    candidateIndex,
    diagnosticSlotKey,
    diagnosticSurface,
    diagnosticsEnabled,
    failed,
    rawChanged,
    resolvedSrc,
    retryNonce,
    trackedCandidateCount,
  ])

  useEffect(() => {
    clearRequestTimeout()
    if (!requestSrc || failed) return
    timeoutIdRef.current = globalThis.setTimeout(() => {
      timeoutIdRef.current = null
      advanceAfterFailure('timeout')
    }, resolveRequestTimeoutMs(requestSrc, kind))
    return clearRequestTimeout
  }, [failed, requestSrc, candidateIndex, retryNonce, kind])

  useEffect(() => () => {
    finishActiveRequest({
      terminalState: 'aborted',
      chainTerminal: true,
    })
  }, [])

  if (!raw || failed) {
    return <>{fallback}</>
  }

  if (!requestSrc) {
    return <>{fallback}</>
  }

  return (
    <img
      src={requestSrc}
      alt={alt}
      width={width}
      height={height}
      className={className}
      loading={loading}
      decoding={decoding}
      onLoad={() => {
        if (!isMapImageProxyUrl(currentCandidate)) {
          clearMapImageHostDegraded(readMapImageHost(currentCandidate), hostPolicyScope)
        }
        finishActiveRequest({
          terminalState: 'succeeded',
          displayOutcome: 'visible',
          chainTerminal: true,
        })
      }}
      onError={() => {
        advanceAfterFailure('network_error')
      }}
    />
  )
}
