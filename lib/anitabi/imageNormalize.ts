export type MapDisplayImageKind = 'cover' | 'point-thumbnail' | 'point-preview' | 'point' | 'default'

const DEFAULT_BASE_ORIGIN = 'https://seichigo.com'
const MAP_IMAGE_DIAGNOSTIC_PARAM_PREFIX = '__mi_'
const STRIPPED_CANONICAL_QUERY_PARAMS = new Set(['_retry', 'name'])
const MIRROR_KEY_VERSION = 'mirror/v1'
const INVALID_IMAGE_URL_ERROR = 'invalid_image_url'

/**
 * 上游同一批图片由两套 CDN 投递，路径结构与 ?plan= 语义完全一致：
 *   image.anitabi.cn   Cloudflare       —— 目前对我们返回 403（WAF）
 *   img-tc.anitabi.cn  Tencent EdgeOne  —— 目前可用
 *
 * canonical URL 始终使用 image.anitabi.cn 作为「逻辑身份」（R2 mirror key 依赖它的稳定性），
 * 实际投递 host 由 resolveAnitabiDeliveryUrl() 在真正发起请求／渲染时决定。
 * 这样换 host 不会改变 hash 输入，已镜像对象的 key 零漂移、零回填。
 */
const ANITABI_IMAGE_HOST_CANONICAL = 'image.anitabi.cn'
const ANITABI_IMAGE_HOST_EDGEONE = 'img-tc.anitabi.cn'

const ANITABI_IMAGE_HOSTS: ReadonlySet<string> = new Set([
  ANITABI_IMAGE_HOST_CANONICAL,
  ANITABI_IMAGE_HOST_EDGEONE,
])

/**
 * 当前首选投递 host。用 NEXT_PUBLIC_ 前缀是因为本文件也会在浏览器运行（见 getBaseOrigin），
 * 构建期会被内联。默认走 EdgeOne；把 NEXT_PUBLIC_ANITABI_IMAGE_HOST 设回
 * image.anitabi.cn 即可整体回滚到 Cloudflare。
 */
function getAnitabiDeliveryHost(): string {
  const raw = String(process.env.NEXT_PUBLIC_ANITABI_IMAGE_HOST || '').trim().toLowerCase()
  if (ANITABI_IMAGE_HOSTS.has(raw)) return raw
  return ANITABI_IMAGE_HOST_EDGEONE
}

/**
 * 把 anitabi 图片 URL 的 host 换成当前首选投递 host，路径与查询保持不变。
 * 非 anitabi host 原样返回（返回的是新 URL 实例，不改动入参）。
 */
export function resolveAnitabiDeliveryUrl(input: string | URL): URL {
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input)
  if (ANITABI_IMAGE_HOSTS.has(url.hostname.toLowerCase())) {
    url.hostname = getAnitabiDeliveryHost()
  }
  return url
}

const BGM_API_RELAY_HOST = 'bgm-api.anitabi.cn'
const BANGUMI_COVER_ORIGIN_HOST = 'lain.bgm.tv'

/**
 * bgm-api.anitabi.cn 是 anitabi 对 Bangumi 封面源 lain.bgm.tv 的中转域，
 * 2026-08-31 起对该域所有请求返回 403（Cloudflare 拦截），站内代理抓它也 502。
 * 路径可直接映射回官方源：host 换成 lain.bgm.tv；若 pathname 以 /img/pic/
 * 开头，去掉开头的 /img 挂载前缀；其余 path 与 query 原样保留。
 * 非 bgm-api host 原样返回（返回的是新 URL 实例，不改动入参）。
 */
export function normalizeBgmApiRelayUrl(input: string | URL): URL {
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input)
  if (url.hostname.toLowerCase() === BGM_API_RELAY_HOST) {
    url.hostname = BANGUMI_COVER_ORIGIN_HOST
    if (url.pathname.startsWith('/img/pic/')) {
      url.pathname = url.pathname.slice('/img'.length)
    }
  }
  return url
}

function getBaseOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : DEFAULT_BASE_ORIGIN
}

function isAnitabiHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'anitabi.cn' || host === 'www.anitabi.cn' || host.endsWith('.anitabi.cn')
}

function isBangumiHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'bgm.tv' || host.endsWith('.bgm.tv')
}

const ANITABI_USER_POINT_PATH_PATTERN = /^\/user\/\d+\/bangumi\/\d+\/points\//

/**
 * 判定一个 pathname 是否是 anitabi 点位图路径。
 * 覆盖 `/points/…` 与用户上传的 `/user/<uid>/bangumi/<id>/points/…`（含 `/images/` 前缀的同构路径）。
 * 镜像变体枚举（imageMirrorVariants）与展示变体归一（本文件）共用此口径，两处必须一致。
 */
export function isAnitabiPointImagePath(pathname: string): boolean {
  const normalized = pathname.startsWith('/images/')
    ? pathname.slice('/images'.length)
    : pathname
  return normalized.startsWith('/points/') || ANITABI_USER_POINT_PATH_PATTERN.test(normalized)
}

/**
 * 判定 pathname 是否是 anitabi 番剧封面路径（/bangumi/<id>.jpg）。
 * 展示变体（本文件）与镜像变体枚举（imageMirrorVariants）共用此口径。
 */
export function isAnitabiBangumiCoverPath(pathname: string): boolean {
  const normalized = pathname.startsWith('/images/')
    ? pathname.slice('/images'.length)
    : pathname
  return normalized.startsWith('/bangumi/')
}

function normalizeAnitabiMirrorUrl(url: URL): void {
  if (!isAnitabiHost(url.hostname)) return

  const host = url.hostname.toLowerCase()
  if (
    host === 'anitabi.cn'
    || host === 'www.anitabi.cn'
    || ANITABI_IMAGE_HOSTS.has(host)
  ) {
    url.hostname = ANITABI_IMAGE_HOST_CANONICAL
  }
  if (url.pathname.startsWith('/images/')) {
    url.pathname = url.pathname.slice('/images'.length)
  }
}

function stripCanonicalQueryParams(url: URL): void {
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith(MAP_IMAGE_DIAGNOSTIC_PARAM_PREFIX) || STRIPPED_CANONICAL_QUERY_PARAMS.has(key)) {
      url.searchParams.delete(key)
    }
  }
}

function extensionFromMimeType(mimeType: string | null | undefined): string {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized.includes('image/jpeg') || normalized.includes('image/jpg')) return '.jpg'
  if (normalized.includes('image/png')) return '.png'
  if (normalized.includes('image/webp')) return '.webp'
  if (normalized.includes('image/avif')) return '.avif'
  if (normalized.includes('image/gif')) return '.gif'
  if (normalized.includes('image/svg+xml')) return '.svg'
  return '.jpg'
}

function bytesToHex(input: ArrayBuffer): string {
  return [...new Uint8Array(input)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function parseAbsoluteHttpUrl(input: string): URL {
  const raw = String(input || '').trim()
  if (!raw) {
    throw new Error(INVALID_IMAGE_URL_ERROR)
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(INVALID_IMAGE_URL_ERROR)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(INVALID_IMAGE_URL_ERROR)
  }

  return url
}

export function stripMapImageDiagnosticParams(src: string | URL): URL {
  const url = src instanceof URL ? new URL(src.toString()) : new URL(src, getBaseOrigin())
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith(MAP_IMAGE_DIAGNOSTIC_PARAM_PREFIX)) {
      url.searchParams.delete(key)
    }
  }
  return url
}

export function normalizeBangumiCoverVariant(url: URL, kind: MapDisplayImageKind): void {
  if (kind !== 'cover' || !isBangumiHost(url.hostname)) return
  url.pathname = url.pathname.replace('/pic/cover/l/', '/pic/cover/m/')
}

function applyPointThumbnailVariant(url: URL): void {
  const plan = url.searchParams.get('plan')
  if (!plan || !plan.trim()) {
    url.searchParams.set('plan', 'h160')
  }
  url.searchParams.delete('w')
  url.searchParams.delete('h')
  url.searchParams.delete('q')
}

/**
 * anitabi /bangumi/ 封面降到 h160 变体（强制覆盖既有 plan，如 plan=l）。
 * ?plan= 仅 img-tc.anitabi.cn 支持（image.anitabi.cn 对带 plan 的请求 403），
 * 实际投递 host 由 resolveAnitabiDeliveryUrl 在候选生成时统一切换。
 */
function applyBangumiCoverH160Variant(url: URL): void {
  url.searchParams.set('plan', 'h160')
  url.searchParams.delete('w')
  url.searchParams.delete('h')
  url.searchParams.delete('q')
}

export function normalizeAnitabiDisplayVariant(url: URL, kind: MapDisplayImageKind): void {
  if (!isAnitabiHost(url.hostname)) return

  normalizeAnitabiMirrorUrl(url)

  // 所有 anitabi 点位图路径（/points/… 与 /user/<uid>/bangumi/<id>/points/…）
  // 统一口径见 isAnitabiPointImagePath。h320 变体上游不存在（EdgeOne 404），
  // 任何 kind 都不得再生成它。
  if (isAnitabiPointImagePath(url.pathname)) {
    if (kind === 'point' || kind === 'point-preview') {
      url.searchParams.delete('plan')
      if (!url.searchParams.has('w') && !url.searchParams.has('h')) {
        url.searchParams.set('w', '640')
      }
      if (!url.searchParams.has('q')) {
        url.searchParams.set('q', '80')
      }
      return
    }

    if (kind === 'point-thumbnail') {
      applyPointThumbnailVariant(url)
      return
    }
    return
  }

  // 非点位路径：point-thumbnail 补 h160；cover 仅对 /bangumi/ 封面降到 h160 变体
  // （2026-09-10 实测原图最大 1.9MB，地图圆头像超采 88–150 倍）。
  // 其余非点位路径与 kind 组合保持原有行为（不加 plan）。
  if (kind === 'point-thumbnail') {
    applyPointThumbnailVariant(url)
  }
  if (kind === 'cover' && isAnitabiBangumiCoverPath(url.pathname)) {
    applyBangumiCoverH160Variant(url)
  }
}

export function computeCanonicalImageUrl(input: string): string {
  // bgm-api 中转 URL 先归一回 lain.bgm.tv 官方源 —— canonical / R2 mirror key
  // 必须与旧镜像（基于 lain.bgm.tv canonical）零漂移，兜底镜像才能命中。
  const url = normalizeBgmApiRelayUrl(parseAbsoluteHttpUrl(input))
  normalizeBangumiCoverVariant(url, 'cover')
  normalizeAnitabiMirrorUrl(url)
  stripCanonicalQueryParams(url)
  url.searchParams.sort()
  return url.toString()
}

export async function computeMirrorKey(canonicalUrl: string, mimeType: string): Promise<string> {
  const url = new URL(canonicalUrl)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalUrl))
  const hash = bytesToHex(digest).slice(0, 24)
  const ext = extensionFromMimeType(mimeType)
  return `${MIRROR_KEY_VERSION}/${url.hostname.toLowerCase()}/${hash}/${ext}`
}
