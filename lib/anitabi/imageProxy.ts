import {
  normalizeAnitabiDisplayVariant,
  normalizeBangumiCoverVariant,
  resolveAnitabiDeliveryUrl,
} from '@/lib/anitabi/imageNormalize'
import type { MapDisplayImageKind } from '@/lib/anitabi/imageNormalize'
export { stripMapImageDiagnosticParams } from '@/lib/anitabi/imageNormalize'

export type MapImageDiagnosticQuery = {
  sessionId: string
  chainId: string
  requestId: string
  sampled?: boolean
  escalationReason?: string | null
  surface?: 'map' | 'nearby'
  slotKey?: string
  slotType?: string
  owner?: string
}

export function readMapImageDiagnosticParams(
  src: string | URL,
): MapImageDiagnosticQuery | null {
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    const url = src instanceof URL ? new URL(src.toString()) : new URL(src, baseOrigin)
    const sessionId = String(url.searchParams.get('__mi_session') || '').trim()
    const chainId = String(url.searchParams.get('__mi_chain') || '').trim()
    const requestId = String(url.searchParams.get('__mi_request') || '').trim()
    if (!sessionId || !chainId || !requestId) return null
    const sampledValue = url.searchParams.get('__mi_sampled')
    const escalationReasonValue = url.searchParams.get('__mi_escalation')
    const surfaceValue = String(url.searchParams.get('__mi_surface') || '').trim()
    const slotKeyValue = String(url.searchParams.get('__mi_slot_key') || '').trim()
    const slotTypeValue = String(url.searchParams.get('__mi_slot_type') || '').trim()
    const ownerValue = String(url.searchParams.get('__mi_owner') || '').trim()
    return {
      sessionId,
      chainId,
      requestId,
      ...(sampledValue != null
        ? { sampled: sampledValue.trim().toLowerCase() === '1' || sampledValue.trim().toLowerCase() === 'true' }
        : {}),
      ...(escalationReasonValue != null
        ? { escalationReason: escalationReasonValue.trim() || null }
        : {}),
      ...((surfaceValue === 'map' || surfaceValue === 'nearby') ? { surface: surfaceValue } : {}),
      ...(slotKeyValue ? { slotKey: slotKeyValue } : {}),
      ...(slotTypeValue ? { slotType: slotTypeValue } : {}),
      ...(ownerValue ? { owner: ownerValue } : {}),
    }
  } catch {
    return null
  }
}

function isDirectSafeAnitabiHost(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return host === 'image.anitabi.cn' || host.endsWith('.anitabi.cn')
}

function canBypassProxy(url: URL): boolean {
  if (typeof window !== 'undefined' && url.origin === window.location.origin) {
    return true
  }
  return isDirectSafeAnitabiHost(url)
}

function buildProxyImageUrl(url: URL): string {
  const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
  const proxied = new URL('/api/anitabi/image-render', baseOrigin)
  // 第六轮 E2：双重编码。Cloudflare/OpenNext 会对 req.url 的 query 再解码一次，
  // 单次编码的多参数上游 URL 会在服务端被 & 截断（R2 key 错位）；URLSearchParams
  // set 时会对值再编码一次，线上解码一层后仍是合法单次编码值，服务端
  // resolveProxyTargetUrl 再解一层。本地 Node 无平台解码，同样兼容。
  proxied.searchParams.set('url', encodeURIComponent(url.toString()))
  return proxied.toString()
}

function buildRetryProxyUrl(url: URL): string {
  const proxied = new URL(buildProxyImageUrl(url))
  proxied.searchParams.set('_retry', '1')
  return proxied.toString()
}

function buildRetryDirectUrl(url: URL): string {
  const retried = new URL(url.toString())
  retried.searchParams.set('_retry', '1')
  return retried.toString()
}

function dedupeCandidates(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function appendRetryNonce(url: URL, retryNonce: number | null | undefined): void {
  if (!retryNonce || retryNonce <= 0) return
  url.searchParams.set('_retry', String(retryNonce))
}

function isRenderableProxyUrl(url: URL, baseOrigin: string): boolean {
  return url.origin === baseOrigin && url.pathname === '/api/anitabi/image-render'
}

export function appendMapImageDiagnosticParams(
  src: string,
  params: MapImageDiagnosticQuery | null | undefined,
): string {
  const raw = String(src || '').trim()
  if (!raw || !params) return raw

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    const url = new URL(raw, baseOrigin)
    if (!isRenderableProxyUrl(url, baseOrigin)) {
      return url.toString()
    }
    url.searchParams.set('__mi_session', params.sessionId)
    url.searchParams.set('__mi_chain', params.chainId)
    url.searchParams.set('__mi_request', params.requestId)
    if (params.sampled) {
      url.searchParams.set('__mi_sampled', '1')
    }
    if (params.escalationReason) {
      url.searchParams.set('__mi_escalation', params.escalationReason)
    }
    if (params.surface) {
      url.searchParams.set('__mi_surface', params.surface)
    }
    if (params.slotKey) {
      url.searchParams.set('__mi_slot_key', params.slotKey)
    }
    if (params.slotType) {
      url.searchParams.set('__mi_slot_type', params.slotType)
    }
    if (params.owner) {
      url.searchParams.set('__mi_owner', params.owner)
    }
    return url.toString()
  } catch {
    return raw
  }
}

export function toCanvasSafeImageUrl(src: string, _hintName?: string): string {
  const raw = String(src || '').trim()
  if (!raw) return ''

  if (typeof window === 'undefined') return raw

  try {
    const url = new URL(raw, window.location.origin)
    if (canBypassProxy(url)) {
      return url.toString()
    }
    return buildProxyImageUrl(url)
  } catch {
    return raw
  }
}

export function getMapDisplayImageCandidates(
  src: string,
  options?: {
    kind?: MapDisplayImageKind
  }
): string[] {
  const raw = String(src || '').trim()
  if (!raw) return []

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    const url = new URL(raw, baseOrigin)
    const kind = options?.kind ?? 'default'
    normalizeBangumiCoverVariant(url, kind)
    normalizeAnitabiDisplayVariant(url, kind)

    // 只换 anitabi 图片 host 到当前可用 CDN；路径与查询保持不变。
    // canonical（R2 key）仍在 imageNormalize 内部归一到 image.anitabi.cn，不受影响。
    // direct 一档用投递 host，proxy 一档保留原 host（由服务端在抓取时再解析投递 host）。
    const deliveryUrl = resolveAnitabiDeliveryUrl(url)
    const directUrl = deliveryUrl.toString()
    const proxyUrl = buildProxyImageUrl(url)
    if (url.origin === baseOrigin) {
      return [directUrl]
    }
    const forceProxyOnly =
      kind === 'point'
      || kind === 'point-preview'
      || kind === 'point-thumbnail'
    if (forceProxyOnly) {
      return dedupeCandidates([proxyUrl, buildRetryProxyUrl(url)])
    }
    const shouldPreferDirect =
      isDirectSafeAnitabiHost(url)
      && kind === 'cover'
    const shouldEnableProxyRetryAndDirectFallback =
      process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED === '1'
      && kind === 'cover'
      && !isDirectSafeAnitabiHost(url)

    return dedupeCandidates(
      shouldPreferDirect
        ? [directUrl, buildRetryDirectUrl(deliveryUrl), proxyUrl]
        : shouldEnableProxyRetryAndDirectFallback
          ? [proxyUrl, buildRetryProxyUrl(url), directUrl]
          : [proxyUrl]
    )
  } catch {
    return [raw]
  }
}

export function toMapDisplayImageUrl(
  src: string,
  options?: {
    kind?: MapDisplayImageKind
    retryNonce?: number | null
  }
): string {
  const primary = getMapDisplayImageCandidates(src, { kind: options?.kind })[0]
  if (!primary) return String(src || '').trim()

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    const finalUrl = new URL(primary, baseOrigin)
    appendRetryNonce(finalUrl, options?.retryNonce)
    return finalUrl.toString()
  } catch {
    return primary
  }
}
