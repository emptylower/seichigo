import {
  computeCanonicalImageUrl,
  computeMirrorKey,
  isAnitabiPointImagePath,
  normalizeAnitabiDisplayVariant,
  normalizeBangumiCoverVariant,
  normalizeBgmApiRelayUrl,
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
    // bgm-api 中转域 403：先归一回 lain.bgm.tv，让后续 bgm 逻辑（/l/→/m/、代理优先）接管。
    const safeUrl = normalizeBgmApiRelayUrl(url)
    if (canBypassProxy(safeUrl)) {
      // image.anitabi.cn 直连当前 403（WAF）：anitabi 资产保持直连但切到当前投递 host。
      if (isDirectSafeAnitabiHost(safeUrl)) {
        return resolveAnitabiDeliveryUrl(safeUrl).toString()
      }
      return safeUrl.toString()
    }
    return buildProxyImageUrl(safeUrl)
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
    // bgm-api 中转域 403：先归一回 lain.bgm.tv，再走既有的 bgm 封面变体逻辑
    // （cover 场景 /pic/cover/l/ 降 /m/、非 anitabi host 走代理优先）。
    const url = normalizeBgmApiRelayUrl(new URL(raw, baseOrigin))
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
      // R2 公共域开启时，点位图候选梯末档补直连投递 URL 作为最终兜底；
      // 开关为空时保持旧的纯代理两档不变。
      if (readMapImageR2PublicBase() !== '' && isDirectSafeAnitabiHost(url)) {
        return dedupeCandidates([proxyUrl, buildRetryProxyUrl(url), directUrl])
      }
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
  return applyMapImageRetryNonce(primary, src, options?.retryNonce)
}

function applyMapImageRetryNonce(
  primary: string,
  src: string,
  retryNonce?: number | null,
): string {
  if (!primary) return String(src || '').trim()

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    const finalUrl = new URL(primary, baseOrigin)
    appendRetryNonce(finalUrl, retryNonce)
    return finalUrl.toString()
  } catch {
    return primary
  }
}

const R2_PUBLIC_BASE_ENV = 'NEXT_PUBLIC_MAP_IMAGE_R2_PUBLIC_BASE'

/**
 * R2 镜像桶自定义公共域（例如 https://img.seichigo.com）。为空时完全不生成
 * R2 直出候选，候选梯行为与历史版本一致。
 */
export function readMapImageR2PublicBase(): string {
  const raw = String(process.env[R2_PUBLIC_BASE_ENV] || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
    return parsed.origin
  } catch {
    return ''
  }
}

export function isMapImageR2PublicBaseConfigured(): boolean {
  return readMapImageR2PublicBase() !== ''
}

function isAnitabiImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'anitabi.cn' || host === 'www.anitabi.cn' || host.endsWith('.anitabi.cn')
}

function isBangumiImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'bgm.tv' || host.endsWith('.bgm.tv')
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

/**
 * 按 URL 路径扩展名猜 mime（镜像对象写入时的 key ext 由真实 content-type 决定，
 * 客户端只能按扩展名对齐——绝大多数 anitabi/bgm 图是 jpeg）。没有扩展名或
 * 带 ?q=&w= 的 anitabi 点位图按 image/jpeg。
 */
function guessMirrorMimeType(url: URL): string {
  const segments = url.pathname.split('/')
  const last = segments[segments.length - 1] || ''
  const dotIndex = last.lastIndexOf('.')
  if (dotIndex <= 0) return 'image/jpeg'
  const ext = last.slice(dotIndex).toLowerCase()
  return MIME_BY_EXTENSION[ext] || 'image/jpeg'
}

/**
 * 与镜像入库枚举（lib/anitabi/imageMirrorVariants.ts）保持同一套变体口径：
 * - anitabi 点位图：point/point-preview → w640q80；point-thumbnail → h160
 * - anitabi /bangumi/ 封面（cover kind）：去掉 w/h/q，plan 保留（l 或无 → cover-l/cover-m）
 * - bgm.tv 封面（cover 路径 /pic/cover/l|m/）：canonical 内部会把 /l/ 降为 /m/
 * 其余（default kind、非镜像域）返回 null，不生成 R2 候选。
 */
function buildMirrorVariantUrl(url: URL, kind: MapDisplayImageKind): URL | null {
  const host = url.hostname.toLowerCase()
  if (isAnitabiImageHost(host)) {
    const normalizedPathname = url.pathname.startsWith('/images/')
      ? url.pathname.slice('/images'.length)
      : url.pathname
    if (isAnitabiPointImagePath(url.pathname)) {
      if (kind === 'point' || kind === 'point-preview') {
        const variant = new URL(url.toString())
        variant.searchParams.delete('plan')
        variant.searchParams.delete('h')
        variant.searchParams.set('w', '640')
        variant.searchParams.set('q', '80')
        return variant
      }
      if (kind === 'point-thumbnail') {
        const variant = new URL(url.toString())
        variant.searchParams.delete('w')
        variant.searchParams.delete('h')
        variant.searchParams.delete('q')
        variant.searchParams.set('plan', 'h160')
        return variant
      }
      return null
    }
    if (kind === 'cover' && normalizedPathname.startsWith('/bangumi/')) {
      const variant = new URL(url.toString())
      variant.searchParams.delete('w')
      variant.searchParams.delete('h')
      variant.searchParams.delete('q')
      return variant
    }
    return null
  }
  if (isBangumiImageHost(host)) {
    if (url.pathname.includes('/pic/cover/l/') || url.pathname.includes('/pic/cover/m/')) {
      return new URL(url.toString())
    }
    return null
  }
  return null
}

const mirrorPublicUrlCache = new Map<string, Promise<string | null>>()
const MIRROR_PUBLIC_URL_CACHE_MAX = 2048

/**
 * 解析一张图在 R2 公共域上的直出 URL。key 计算与镜像入库零漂移：
 * computeCanonicalImageUrl（不变）→ 按 kind 复刻镜像变体 → 猜 mime → computeMirrorKey（不变）。
 * 开关为空、站内 origin、非 anitabi/bgm 域或算不出变体时返回 null。
 */
export async function resolveMirrorPublicUrl(
  rawUrl: string,
  options?: {
    kind?: MapDisplayImageKind
  }
): Promise<string | null> {
  const base = readMapImageR2PublicBase()
  if (!base) return null

  const raw = String(rawUrl || '').trim()
  if (!raw) return null

  const kind = options?.kind ?? 'default'
  const cacheKey = `${base}|${kind}|${raw}`
  const cached = mirrorPublicUrlCache.get(cacheKey)
  if (cached) return cached

  const promise = (async () => {
    try {
      const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
      const parsed = normalizeBgmApiRelayUrl(new URL(raw, baseOrigin))
      if (parsed.origin === baseOrigin) return null
      const variant = buildMirrorVariantUrl(parsed, kind)
      if (!variant) return null
      const canonicalUrl = computeCanonicalImageUrl(variant.toString())
      const key = await computeMirrorKey(canonicalUrl, guessMirrorMimeType(variant))
      return `${base}/${key}`
    } catch {
      return null
    }
  })()

  if (mirrorPublicUrlCache.size >= MIRROR_PUBLIC_URL_CACHE_MAX) {
    mirrorPublicUrlCache.clear()
  }
  mirrorPublicUrlCache.set(cacheKey, promise)
  return promise
}

/**
 * 浏览器真正加载图片用的候选梯：镜像 key 计算是异步的（crypto.subtle），
 * 在同步候选最前面插入 R2 直出 URL（算不出则原样返回同步结果）。
 */
export async function getMapDisplayImageCandidatesAsync(
  src: string,
  options?: {
    kind?: MapDisplayImageKind
  }
): Promise<string[]> {
  const candidates = getMapDisplayImageCandidates(src, options)
  const mirrorUrl = await resolveMirrorPublicUrl(src, options)
  if (!mirrorUrl) return candidates
  return dedupeCandidates([mirrorUrl, ...candidates])
}

export async function toMapDisplayImageUrlAsync(
  src: string,
  options?: {
    kind?: MapDisplayImageKind
    retryNonce?: number | null
  }
): Promise<string> {
  const primary = (await getMapDisplayImageCandidatesAsync(src, { kind: options?.kind }))[0]
  return applyMapImageRetryNonce(primary, src, options?.retryNonce)
}
