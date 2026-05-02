import {
  clearMapImageHostDegraded,
  isMapImageProxyUrl,
  markMapImageHostDegraded,
  type MapImageHostPolicyScope,
  prioritizeMapImageCandidates,
  readMapImageHost,
} from '@/components/map/utils/mapImageHostPolicy'
import {
  acquireTimedMapImageRequestSlot,
  type MapImageRequestLane,
} from '@/features/map/anitabi/mapImageRequestScheduler'

type LoadImageMapLike = {
  loadImage(url: string): Promise<{ data: unknown }>
}

type RequestHandle = {
  requestUrl: string
  requestId: string
} | null

type OnTrackedRequestStart = (input: {
  slotKey: string
  requestedCandidateUrl: string
  candidateIndex: number
  candidateCount: number
  reuseChain: boolean
  queueWaitMs?: number
}) => RequestHandle

type OnTrackedRequestTerminal = (input: {
  handle: RequestHandle
  terminalState: 'succeeded' | 'failed' | 'aborted'
  finalUrl: string
  chainTerminal: boolean
  outcome?: string
}) => void

export type LoadMapImageWithCandidatesOptions = {
  map: LoadImageMapLike
  slotKey: string
  urls: string[]
  tracked: boolean
  onTrackedRequestStart?: OnTrackedRequestStart
  onTrackedRequestTerminal?: OnTrackedRequestTerminal
  directRequestTimeoutMs?: number
  proxyRequestTimeoutMs?: number
  requestLane?: MapImageRequestLane
  hostPolicyScope?: MapImageHostPolicyScope
  requestSignal?: AbortSignal
}

const DEFAULT_DIRECT_REQUEST_TIMEOUT_MS = 4_000
const DEFAULT_PROXY_REQUEST_TIMEOUT_MS = 6_000
const POINT_PROXY_REQUEST_TIMEOUT_MS = 8_500

function resolveDefaultProxyRequestTimeoutMs(hostPolicyScope: MapImageHostPolicyScope): number {
  return hostPolicyScope === 'point' || hostPolicyScope === 'point-thumbnail'
    ? POINT_PROXY_REQUEST_TIMEOUT_MS
    : DEFAULT_PROXY_REQUEST_TIMEOUT_MS
}

function resolveRequestTimeoutMs(
  url: string,
  directRequestTimeoutMs: number,
  proxyRequestTimeoutMs: number,
): number {
  return isMapImageProxyUrl(url)
    ? proxyRequestTimeoutMs
    : directRequestTimeoutMs
}

async function loadImageWithTimeout(
  map: LoadImageMapLike,
  requestUrl: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ ok: true; result: { data: unknown } } | { ok: false; outcome: 'timeout' | 'network_error' | 'aborted'; error?: unknown }> {
  if (signal?.aborted) {
    return { ok: false, outcome: 'aborted' }
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (
      value: { ok: true; result: { data: unknown } } | { ok: false; outcome: 'timeout' | 'network_error' | 'aborted'; error?: unknown },
    ) => {
      if (settled) return
      settled = true
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
      resolve(value)
    }
    const onAbort = () => {
      globalThis.clearTimeout(timer)
      finish({ ok: false, outcome: 'aborted' })
    }

    const timer = globalThis.setTimeout(() => {
      finish({ ok: false, outcome: 'timeout' })
    }, timeoutMs)

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    void map.loadImage(requestUrl).then((result) => {
      globalThis.clearTimeout(timer)
      finish({ ok: true, result })
    }).catch((error) => {
      globalThis.clearTimeout(timer)
      finish({ ok: false, outcome: 'network_error', error })
    })
  })
}

export async function loadMapImageWithCandidates(
  options: LoadMapImageWithCandidatesOptions,
): Promise<{ data: unknown; finalUrl: string }> {
  const hostPolicyScope = options.hostPolicyScope ?? 'default'
  const directRequestTimeoutMs = Math.max(100, options.directRequestTimeoutMs ?? DEFAULT_DIRECT_REQUEST_TIMEOUT_MS)
  const proxyRequestTimeoutMs = Math.max(
    100,
    options.proxyRequestTimeoutMs ?? resolveDefaultProxyRequestTimeoutMs(hostPolicyScope),
  )
  const candidateQueue = prioritizeMapImageCandidates(options.urls, hostPolicyScope)
  const requestLane = options.requestLane ?? 'viewport-visible'

  let lastError: unknown = null
  let candidateIndex = 0

  while (candidateQueue.length > 0) {
    if (options.requestSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const candidateUrl = candidateQueue.shift()!
    const { lease, queueWaitMs } = await acquireTimedMapImageRequestSlot({
      lane: requestLane,
      signal: options.requestSignal,
    })
    let requestUrl = candidateUrl
    let handle: RequestHandle = null
    const result = await (async () => {
      try {
        handle = options.tracked
          ? options.onTrackedRequestStart?.({
              slotKey: options.slotKey,
              requestedCandidateUrl: candidateUrl,
              candidateIndex,
              candidateCount: options.urls.length,
              reuseChain: candidateIndex > 0,
              queueWaitMs,
            }) ?? null
          : null
        requestUrl = handle?.requestUrl || candidateUrl
        return await loadImageWithTimeout(
          options.map,
          requestUrl,
          resolveRequestTimeoutMs(requestUrl, directRequestTimeoutMs, proxyRequestTimeoutMs),
          options.requestSignal,
        )
      } finally {
        lease.release()
      }
    })()

    if (result.ok) {
      if (!isMapImageProxyUrl(candidateUrl)) {
        clearMapImageHostDegraded(readMapImageHost(candidateUrl), hostPolicyScope)
      }
      if (options.tracked) {
        options.onTrackedRequestTerminal?.({
          handle,
          terminalState: 'succeeded',
          finalUrl: requestUrl,
          chainTerminal: true,
        })
      }
      return {
        data: result.result.data,
        finalUrl: requestUrl,
      }
    }

    if (result.outcome === 'aborted') {
      if (options.tracked) {
        options.onTrackedRequestTerminal?.({
          handle,
          terminalState: 'aborted',
          finalUrl: requestUrl,
          chainTerminal: true,
          outcome: 'aborted',
        })
      }
      throw new DOMException('Aborted', 'AbortError')
    }

    lastError = result.error || new Error(result.outcome)
    if (!isMapImageProxyUrl(candidateUrl)) {
      markMapImageHostDegraded(readMapImageHost(candidateUrl), hostPolicyScope)
    }
    if (options.tracked) {
      options.onTrackedRequestTerminal?.({
        handle,
        terminalState: 'failed',
        finalUrl: requestUrl,
        chainTerminal: candidateQueue.length === 0,
        outcome: result.outcome,
      })
    }
    candidateIndex += 1
  }

  throw lastError || new Error('load failed')
}
