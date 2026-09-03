'use client'

import { useEffect, useRef, useState } from 'react'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
import {
  clearMapImageHostDegraded,
  DEGRADED_HOST_TIMEOUT_MS,
  isMapImageProxyUrl,
  markMapImageHostDegraded,
  type MapImageHostPolicyScope,
  prioritizeMapImageCandidates,
  readMapImageEffectiveHost,
  readMapImageHost,
  resolveHostTimeoutMs,
} from '@/components/map/utils/mapImageHostPolicy'
import {
  hasLoadedMapImage,
  rememberLoadedMapImage,
} from '@/components/map/utils/mapImageLoadedCache'
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
  kind?: 'cover' | 'point' | 'point-preview' | 'point-thumbnail' | 'default'
  fallback?: React.ReactNode
  /** 候选梯最后一档（同源相对路径，原样追加、去重）：用于点位无图时的 Google 兜底图 */
  fallbackSrc?: string | null
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
  if (!url || retryNonce <= 0 || !isMapImageProxyUrl(url)) {
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
  const isProxyRequest = isMapImageProxyUrl(url)
  // 点位代理图（anitabi 渲染 / Google 地点图）单张 5–10s 是常态；
  // DayCards 几十张并发时 8.5s 预算必然级联超时，给足 20s。
  const baseTimeoutMs = !isProxyRequest
    ? 4_000
    : kind === 'point' || kind === 'point-preview' || kind === 'point-thumbnail'
    ? 20_000
    : 6_000
  const scope = resolveHostPolicyScope(kind)
  const host = readMapImageEffectiveHost(url)
  return resolveHostTimeoutMs(host, scope, baseTimeoutMs, Date.now())
}

function resolveRequestLane(): 'interaction-critical' {
  return 'interaction-critical'
}

function resolveHostPolicyScope(kind: ResilientMapImageProps['kind']): MapImageHostPolicyScope {
  if (kind === 'cover') return 'cover'
  if (kind === 'point' || kind === 'point-preview') return 'point'
  if (kind === 'point-thumbnail') return 'point-thumbnail'
  return 'default'
}

/** 候选梯：getMapDisplayImageCandidates 输出 + 断路器排序，末尾原样追加 fallbackSrc（去重） */
function buildCandidateQueue(
  raw: string,
  kind: ResilientMapImageProps['kind'],
  scope: MapImageHostPolicyScope,
  fallbackSrc?: string | null,
): string[] {
  const base = raw
    ? prioritizeMapImageCandidates(getMapDisplayImageCandidates(raw, { kind }), scope)
    : []
  const fallback = String(fallbackSrc || '').trim()
  if (!fallback) return base
  // 去重：候选梯里的站内 URL 已被绝对化，fallbackSrc 多为相对路径，按解析后形式比较
  let resolvedFallback = fallback
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    resolvedFallback = new URL(fallback, baseOrigin).toString()
  } catch {
    // 保留原样
  }
  if (base.includes(fallback) || base.includes(resolvedFallback)) return base
  return [...base, fallback]
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
  fallbackSrc = null,
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
  // 视口门控：lazy 且环境支持 IntersectionObserver 时，先观察哨兵，相交后才发请求；
  // eager / jsdom（无 IntersectionObserver）时立即视为已相交
  const [inView, setInView] = useState(
    () => loading === 'eager' || typeof IntersectionObserver === 'undefined',
  )
  const activeRequestRef = useRef<{ requestUrl: string; requestId: string } | null>(null)
  const activeLeaseRef = useRef<MapImageRequestLease | null>(null)
  const timeoutIdRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const sentinelRef = useRef<HTMLSpanElement | null>(null)
  const diagnosticRequestStartRef = useRef<typeof onDiagnosticRequestStart>(onDiagnosticRequestStart)
  const diagnosticRequestTerminalRef = useRef<typeof onDiagnosticRequestTerminal>(onDiagnosticRequestTerminal)
  const lastRawRef = useRef(raw)
  const candidateQueueRef = useRef<string[]>(
    buildCandidateQueue(raw, kind, hostPolicyScope, fallbackSrc),
  )
  const rawChanged = lastRawRef.current !== raw
  diagnosticRequestStartRef.current = onDiagnosticRequestStart
  diagnosticRequestTerminalRef.current = onDiagnosticRequestTerminal

  // raw 变化时 inView 不重置：同一位置换图不必再等一次相交
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
    candidateQueueRef.current = buildCandidateQueue(raw, kind, hostPolicyScope, fallbackSrc)
    lastRawRef.current = raw
  }, [hostPolicyScope, kind, raw, fallbackSrc])

  const candidates = candidateQueueRef.current
  const currentCandidate = candidates[candidateIndex] || raw
  const resolvedSrc = currentCandidate ? withRetryNonce(currentCandidate, retryNonce) : ''
  // 已加载缓存命中：候选梯中第一个已成功加载过的 URL（同一图片的 _retry 档视为同图）
  const cachedCandidateIndex = raw && !failed ? candidates.findIndex((c) => hasLoadedMapImage(c)) : -1
  const cachedCandidate = cachedCandidateIndex >= 0 ? candidates[cachedCandidateIndex]! : null
  const trackedCandidateCount =
    candidates.length + (candidates.some((candidate) => isMapImageProxyUrl(candidate)) ? 1 : 0)
  const diagnosticsEnabled = Boolean(
    diagnosticSlotKey
    && diagnosticSurface
    && (diagnosticSurface === 'map' || diagnosticSurface === 'nearby'),
  )

  // 视口门控观察器：哨兵首次相交后置 inView；加载一旦开始就持续有效
  useEffect(() => {
    if (inView) return
    if (loading !== 'lazy' || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [inView, loading, failed, raw])

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
      // 断路器口径（§0.5）：只有真实网络错误（onError）计入断路器；
      // 超时不计入——超时只换候选/重试/回退
      if (outcome === 'network_error') {
        const failureHost = readMapImageEffectiveHost(currentCandidate)
        if (failureHost) {
          markMapImageHostDegraded(failureHost, hostPolicyScope)
        }
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
    if (isMapImageProxyUrl(resolvedSrc) && retryNonce < 1) {
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
    // 已加载缓存命中：跳过视口门控、lease 与计时器，直接以该 URL 渲染；
    // onError 仍走正常失败链（候选梯后续档位不受影响）
    if (cachedCandidate) {
      clearRequestTimeout()
      activeLeaseRef.current?.release()
      activeLeaseRef.current = null
      if (cachedCandidateIndex !== candidateIndex) {
        setCandidateIndex(cachedCandidateIndex)
      }
      setRequestSrc(cachedCandidate)
      return
    }
    // 视口门控：lazy 且尚未相交时不发起请求——视口外的图浏览器根本不发请求，
    // 若计时器从赋 src 起算会被一律误判成"超时失败"
    if (!inView) {
      return
    }
    // host 被断路器封禁（超时预算 0）时不再秒失败，直接跳到下一候选；
    // 若无下一候选则照常发出请求，由计时器按降级预算正常尝试一次
    if (
      resolveRequestTimeoutMs(resolvedSrc, kind) === 0
      && candidateIndex + 1 < candidates.length
    ) {
      advanceAfterFailure('timeout')
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
    cachedCandidate,
    cachedCandidateIndex,
    diagnosticSlotKey,
    diagnosticSurface,
    diagnosticsEnabled,
    failed,
    inView,
    rawChanged,
    resolvedSrc,
    retryNonce,
    trackedCandidateCount,
  ])

  useEffect(() => {
    clearRequestTimeout()
    if (!requestSrc || failed) return
    // 已加载缓存命中的渲染不挂计时器
    if (cachedCandidate && requestSrc === cachedCandidate) return
    const timeoutMs = resolveRequestTimeoutMs(requestSrc, kind)
    timeoutIdRef.current = globalThis.setTimeout(() => {
      timeoutIdRef.current = null
      advanceAfterFailure('timeout')
      // host 被封禁（预算 0）且走到最后一档时，按降级预算正常尝试一次，不再 0ms 秒失败
    }, timeoutMs > 0 ? timeoutMs : DEGRADED_HOST_TIMEOUT_MS)
    return clearRequestTimeout
  }, [cachedCandidate, failed, requestSrc, candidateIndex, retryNonce, kind])

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
    // 视口门控中：渲染 fallback + 零尺寸哨兵供 IntersectionObserver 观察
    if (loading === 'lazy' && !inView) {
      return (
        <>
          {/* 哨兵放在 fallback 之前：贴容器左上角，落在 overflow-hidden 的裁剪区内，
              放在末尾会贴到容器底边，零尺寸元素在裁剪边界上是否相交取决于实现 */}
          <span
            aria-hidden
            data-map-image-sentinel
            style={{ display: 'block', width: 0, height: 0 }}
            ref={sentinelRef}
          />
          {fallback}
        </>
      )
    }
    return <>{fallback}</>
  }

  return (
    <img
      src={requestSrc}
      alt={alt}
      width={width}
      height={height}
      className={className}
      // 门控已由组件负责，请求发出后一律 eager，避免浏览器 lazy 延迟导致计时器失真
      loading="eager"
      decoding={decoding}
      onLoad={() => {
        rememberLoadedMapImage(currentCandidate)
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
