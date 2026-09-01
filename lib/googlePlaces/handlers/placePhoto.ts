import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { isValidPhotoReference } from '@/lib/googlePlaces/places'
import { getMirroredImage, putMirroredImage, type R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

/**
 * Google Places 照片代理（M3）：浏览器只拿到 keyless 的 `/api/google/place-photo?ref=...`，
 * API key 只在本 handler 内部拼接。R2 镜像沿用 anitabi 的 mirror 体系：
 * - read-through：命中镜像直接返回，不打 Google；
 * - 后台镜像：上游成功后异步 put（canonical URL 不含 key，密钥永不落 R2 metadata）。
 */

const FETCH_TIMEOUT_MS = 8_000
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const PHOTO_HOST = 'https://maps.googleapis.com'
const ALLOWED_MIME_PREFIX = 'image/'
const RESPONSE_CACHE_CONTROL = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800'

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

export type PlacePhotoHandlerDeps = {
  getSession: () => Promise<Session | null>
  apiKey: string
  bucket?: R2MirrorBucket
  /** Cloudflare waitUntil（后台镜像不阻塞响应）；缺省时直接浮动 promise */
  waitUntil?: (promise: Promise<unknown>) => void
  fetchImpl?: typeof fetch
}

/**
 * 构建对 Google 的真实请求 URL（含 key）。仅服务端内存中存在；
 * canonical/镜像/日志一律使用 keyless 版本。
 */
function buildUpstreamUrl(photoReference: string, maxWidth: number, apiKey: string): URL {
  const url = new URL('/maps/api/place/photo', PHOTO_HOST)
  url.searchParams.set('photoreference', photoReference)
  url.searchParams.set('maxwidth', String(maxWidth))
  url.searchParams.set('key', apiKey)
  return url
}

/** keyless canonical URL：R2 mirror key 与 metadata 只依赖这个（不含任何密钥） */
export function buildPhotoCanonicalUrl(photoReference: string, maxWidth: number): string {
  const url = new URL('/maps/api/place/photo', PHOTO_HOST)
  url.searchParams.set('photoreference', photoReference)
  url.searchParams.set('maxwidth', String(maxWidth))
  return url.toString()
}

function sanitizeMaxWidth(raw: string | null): number {
  const value = String(raw ?? '').trim()
  if (!value) return 1600
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 1600
  return Math.min(2048, Math.max(200, Math.floor(parsed)))
}

function mirrorResponse(bytes: ArrayBuffer, mimeType: string, mirroredAt?: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': RESPONSE_CACHE_CONTROL,
      'X-Seichigo-Image-Source': 'google-place-photo-r2',
      'X-Content-Type-Options': 'nosniff',
      ...(mirroredAt ? { 'X-Seichigo-Image-Mirrored-At': mirroredAt } : {}),
    },
  })
}

export function createPlacePhotoHandlers(deps: PlacePhotoHandlerDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '未登录' }, { status: 401 })
      }

      const url = new URL(req.url)
      const ref = String(url.searchParams.get('ref') || '').trim()
      const maxWidth = sanitizeMaxWidth(url.searchParams.get('maxwidth'))
      if (!isValidPhotoReference(ref)) {
        return NextResponse.json({ error: '图片参数错误' }, { status: 400 })
      }
      if (!deps.apiKey) {
        return NextResponse.json({ error: '图片服务未配置' }, { status: 503 })
      }

      const canonicalUrl = buildPhotoCanonicalUrl(ref, maxWidth)

      // read-through：R2 命中就不打 Google
      if (deps.bucket) {
        const mirrored = await getMirroredImage(deps.bucket, canonicalUrl).catch(() => null)
        if (mirrored && mirrored.bytes.byteLength <= MAX_IMAGE_BYTES) {
          return mirrorResponse(
            mirrored.bytes,
            mirrored.httpContentType || mirrored.customMetadata.mimeType || 'image/jpeg',
            mirrored.customMetadata.mirroredAt || undefined,
          )
        }
      }

      const upstreamUrl = buildUpstreamUrl(ref, maxWidth, deps.apiKey)
      let upstream: Response
      try {
        upstream = await fetchImpl(upstreamUrl.toString(), {
          redirect: 'manual',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { accept: 'image/*,*/*;q=0.8' },
        })
      } catch {
        return NextResponse.json({ error: '图片读取失败' }, { status: 504 })
      }

      // Google Place Photo 对无权限/无效 ref 返回 403/400；成功时通常 302 到
      // Google 图片 CDN（lh3-lh6.googleusercontent.com 区域变体）——逐跳校验
      // host 集合后再跟随，非白名单目标一律拒绝
      let response = upstream
      let hops = 0
      while (response.status >= 300 && response.status < 400 && hops < 3) {
        hops += 1
        const location = response.headers.get('location')
        if (!location) return NextResponse.json({ error: '图片读取失败' }, { status: 502 })
        if (!isSafePhotoRedirectUrl(location, upstreamUrl)) {
          return NextResponse.json({ error: '不支持的重定向' }, { status: 502 })
        }
        try {
          response = await fetchImpl(new URL(location, upstreamUrl).toString(), {
            redirect: 'manual',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { accept: 'image/*,*/*;q=0.8' },
          })
        } catch {
          return NextResponse.json({ error: '图片读取失败' }, { status: 504 })
        }
      }
      if (response.status >= 300 && response.status < 400) {
        return NextResponse.json({ error: '重定向过多' }, { status: 508 })
      }

      if (!response.ok) {
        return NextResponse.json({ error: '图片读取失败' }, { status: 502 })
      }

      const mimeType = String(response.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase()
      if (!mimeType || !mimeType.startsWith(ALLOWED_MIME_PREFIX)) {
        return NextResponse.json({ error: '文件类型不支持' }, { status: 415 })
      }

      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: '图片文件过大' }, { status: 413 })
      }

      const bytes = await response.arrayBuffer().catch(() => null)
      if (!bytes) return NextResponse.json({ error: '图片读取失败' }, { status: 502 })
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: '图片文件过大' }, { status: 413 })
      }

      // 后台镜像（失败不影响展示）：canonical URL 不含 key，密钥不会进入 R2 metadata
      if (deps.bucket) {
        const write = putMirroredImage(deps.bucket, canonicalUrl, bytes, mimeType, 'lazy').catch(() => undefined)
        if (deps.waitUntil) deps.waitUntil(write)
        else void write
      }

      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(bytes.byteLength),
          'Cache-Control': RESPONSE_CACHE_CONTROL,
          'X-Seichigo-Image-Source': 'google-place-photo-upstream',
          'X-Original-Source': canonicalUrl,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    },
  }
}
