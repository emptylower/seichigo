/**
 * Google Place Photo 抓取（从 handlers/placePhoto.ts 抽出的服务层）：
 * 带 key 请求 + 逐跳白名单校验重定向 + MIME/大小限制。
 * API key 只出现在对 Google 的请求里；canonical URL 与返回值永不带密钥。
 */

const FETCH_TIMEOUT_MS = 8_000
export const MAX_PLACE_PHOTO_BYTES = 10 * 1024 * 1024
const PHOTO_HOST = 'https://maps.googleapis.com'
const ALLOWED_MIME_PREFIX = 'image/'

/**
 * Google Place Photo 常见 302 到 Google 图片 CDN（lh3-lh6.googleusercontent.com
 * 及其区域变体）。这里精确枚举文档化的 host 集合：maps.googleapis.com 本身 +
 * lhN(.区域)?\.googleusercontent.com；每一跳重定向都重新校验协议与 host。
 */
const GOOGLE_USERCONTENT_PHOTO_HOST = /^lh\d(-[a-z0-9]+)*\.googleusercontent\.com$/i

function isAllowedPhotoHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  return host === 'maps.googleapis.com' || GOOGLE_USERCONTENT_PHOTO_HOST.test(host)
}

/** 校验重定向目标：http(s)、无凭据、host 在文档化 Google 图片 host 集合内 */
function isSafePhotoRedirectUrl(raw: string, base: URL): boolean {
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.username || url.password) return false
  return isAllowedPhotoHost(url.hostname)
}

/** 构建对 Google 的真实请求 URL（含 key）。仅服务端内存中存在。 */
export function buildUpstreamPhotoUrl(photoReference: string, maxWidth: number, apiKey: string): URL {
  const url = new URL('/maps/api/place/photo', PHOTO_HOST)
  url.searchParams.set('photoreference', photoReference)
  url.searchParams.set('maxwidth', String(maxWidth))
  url.searchParams.set('key', apiKey)
  return url
}

/** keyless canonical URL（photoReference 寻址）：R2 mirror key 与 metadata 只依赖这个 */
export function buildPhotoRefCanonicalUrl(photoReference: string, maxWidth: number): string {
  const url = new URL('/maps/api/place/photo', PHOTO_HOST)
  url.searchParams.set('photoreference', photoReference)
  url.searchParams.set('maxwidth', String(maxWidth))
  return url.toString()
}

/**
 * keyless canonical URL（placeId 寻址）：合成 `.../photo?maxwidth=<w>&placeid=<id>`，
 * 只作 R2 key 输入，绝不请求（Place Photo API 的 placeid 参数并非文档化取图参数，
 * 但 key 的稳定性由 placeId 保证，引用过期后无需迁移镜像）。index > 0 时追加
 * `&i=<n>`（旧图 key 不受影响）。
 */
export function buildPlacePhotoCanonicalUrl(placeId: string, maxWidth: number, index = 0): string {
  const url = new URL('/maps/api/place/photo', PHOTO_HOST)
  url.searchParams.set('maxwidth', String(maxWidth))
  url.searchParams.set('placeid', placeId)
  if (index > 0) url.searchParams.set('i', String(index))
  return url.toString()
}

export type FetchGooglePlacePhotoInput = {
  photoReference: string
  maxWidth: number
  apiKey: string
  fetchImpl?: typeof fetch
}

export type GooglePlacePhotoFetchResult =
  | { ok: true; bytes: ArrayBuffer; mimeType: string }
  | {
      ok: false
      status:
        | 'denied'
        | 'not_found'
        | 'upstream'
        | 'timeout'
        | 'too_large'
        | 'bad_type'
        /** 重定向到非白名单 host / 非法目标（协议、凭据） */
        | 'redirect'
        /** 重定向次数超过 3 跳仍未落地 */
        | 'too_many_redirects'
    }

/**
 * 抓取一张 Google Place Photo：成功时 302 到 Google 图片 CDN，逐跳校验 host
 * 集合后再跟随；非白名单目标、非图片 MIME、超限体积与网络失败都收敛为
 * typed 错误状态，调用方据此决定刷新引用/回退。
 */
export async function fetchGooglePlacePhoto(input: FetchGooglePlacePhotoInput): Promise<GooglePlacePhotoFetchResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const upstreamUrl = buildUpstreamPhotoUrl(input.photoReference, input.maxWidth, input.apiKey)

  let response: Response
  try {
    response = await fetchImpl(upstreamUrl.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'image/*,*/*;q=0.8' },
    })
  } catch {
    return { ok: false, status: 'timeout' }
  }

  let hops = 0
  while (response.status >= 300 && response.status < 400 && hops < 3) {
    hops += 1
    const location = response.headers.get('location')
    if (!location || !isSafePhotoRedirectUrl(location, upstreamUrl)) return { ok: false, status: 'redirect' }
    try {
      response = await fetchImpl(new URL(location, upstreamUrl).toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'image/*,*/*;q=0.8' },
      })
    } catch {
      return { ok: false, status: 'timeout' }
    }
  }
  if (response.status >= 300 && response.status < 400) return { ok: false, status: 'too_many_redirects' }

  if (!response.ok) {
    // Google Place Photo 对无权限/无效 key 返回 403；无效/过期 ref 返回 400/404
    if (response.status === 403) return { ok: false, status: 'denied' }
    if (response.status === 400 || response.status === 404) return { ok: false, status: 'not_found' }
    return { ok: false, status: 'upstream' }
  }

  const mimeType = String(response.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase()
  if (!mimeType || !mimeType.startsWith(ALLOWED_MIME_PREFIX)) return { ok: false, status: 'bad_type' }

  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PLACE_PHOTO_BYTES) {
    return { ok: false, status: 'too_large' }
  }

  const bytes = await response.arrayBuffer().catch(() => null)
  if (!bytes) return { ok: false, status: 'timeout' }
  if (bytes.byteLength > MAX_PLACE_PHOTO_BYTES) return { ok: false, status: 'too_large' }

  return { ok: true, bytes, mimeType }
}
