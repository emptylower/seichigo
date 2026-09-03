import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { isValidPhotoReference, isValidPlaceId } from '@/lib/googlePlaces/places'
import {
  buildPhotoRefCanonicalUrl,
  buildPlacePhotoCanonicalUrl,
  fetchGooglePlacePhoto,
  MAX_PLACE_PHOTO_BYTES,
  type GooglePlacePhotoFetchResult,
} from '@/lib/googlePlaces/photoFetch'
import { fetchPlacePhotos } from '@/lib/googlePlaces/photoMirror'
import { getMirroredImage, putMirroredImage, type R2MirrorBucket } from '@/lib/anitabi/r2Mirror'
import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'

/**
 * Google Places 照片代理（M3 + 地点库）：浏览器只拿到 keyless 的
 * `/api/google/place-photo?placeId=...`（新）或 `?ref=...`（存量兼容），
 * API key 只在 photoFetch 服务层内部拼接。R2 镜像沿用 anitabi 的 mirror 体系：
 * - read-through：命中镜像直接返回，不打 Google（placeId 路径的 canonical 按 placeId 合成）；
 * - placeId 路径引用过期时服务端用 Place Details 拉整组照片刷新一次并重试，浏览器无感；
 * - 后台镜像：上游成功后异步 put（canonical URL 不含 key，密钥永不落 R2 metadata）。
 * 回归第四轮 A3：`i` 参数按序号取该地点的第 n 张照片（0..9）；A5 的点位兜底
 * 图接口复用导出的 servePlacePhotoByPlaceId。
 */

const RESPONSE_CACHE_CONTROL = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800'
const MAX_PHOTO_INDEX = 9

export function sanitizeMaxWidth(raw: string | null): number {
  const value = String(raw ?? '').trim()
  if (!value) return 1600
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 1600
  return Math.min(2048, Math.max(200, Math.floor(parsed)))
}

/** 解析照片序号参数 i：缺省 0；非整数/负数/>9 返回 null（调用方回 400） */
export function parsePhotoIndex(raw: string | null): number | null {
  const value = String(raw ?? '').trim()
  if (!value) return 0
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_PHOTO_INDEX) return null
  return parsed
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

/** photoFetch 的 typed 错误 → HTTP 状态（ref 与 placeId 路径共用） */
function photoFetchErrorResponse(result: Extract<GooglePlacePhotoFetchResult, { ok: false }>): Response {
  switch (result.status) {
    case 'too_large':
      return NextResponse.json({ error: '图片文件过大' }, { status: 413 })
    case 'bad_type':
      return NextResponse.json({ error: '文件类型不支持' }, { status: 415 })
    case 'timeout':
      return NextResponse.json({ error: '图片读取失败' }, { status: 504 })
    case 'redirect':
      return NextResponse.json({ error: '不支持的重定向' }, { status: 502 })
    case 'too_many_redirects':
      return NextResponse.json({ error: '重定向过多' }, { status: 508 })
    default:
      return NextResponse.json({ error: '图片读取失败' }, { status: 502 })
  }
}

function upstreamResponse(bytes: ArrayBuffer, mimeType: string, canonicalUrl: string): Response {
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
}

/** R2 read-through：命中且未超限时直接返回镜像响应，否则 null */
async function readMirrored(bucket: R2MirrorBucket, canonicalUrl: string): Promise<Response | null> {
  const mirrored = await getMirroredImage(bucket, canonicalUrl).catch(() => null)
  if (mirrored && mirrored.bytes.byteLength <= MAX_PLACE_PHOTO_BYTES) {
    return mirrorResponse(
      mirrored.bytes,
      mirrored.httpContentType || mirrored.customMetadata.mimeType || 'image/jpeg',
      mirrored.customMetadata.mirroredAt || undefined,
    )
  }
  return null
}

/**
 * 上游成功后的共用收尾：响应 + 后台镜像（canonical 不含 key）。
 * 镜像状态只在 put 真正成功后写 mirrored（含 key/mirroredAt）；put 失败写
 * failed；无 bucket 时什么都不写（没有镜像就没有状态，保持 none）。
 */
function finishWithUpstream(
  deps: { bucket?: R2MirrorBucket; waitUntil?: (promise: Promise<unknown>) => void },
  bytes: ArrayBuffer,
  mimeType: string,
  canonicalUrl: string,
  onMirror?: (mirror: { key: string } | null) => Promise<unknown>,
): Response {
  if (deps.bucket) {
    const write = putMirroredImage(deps.bucket, canonicalUrl, bytes, mimeType, 'lazy')
      .then(
        (written) => onMirror?.({ key: written.key }),
        () => onMirror?.(null),
      )
      .catch(() => undefined)
    if (deps.waitUntil) deps.waitUntil(write)
    else void write
  }
  return upstreamResponse(bytes, mimeType, canonicalUrl)
}

export type PlacePhotoHandlerDeps = {
  getSession: () => Promise<Session | null>
  apiKey: string
  bucket?: R2MirrorBucket
  /** 地点库（placeId 寻址路径依赖；缺省时该路径返回 503） */
  store?: ExternalPlaceStore
  /** Cloudflare waitUntil（后台镜像不阻塞响应）；缺省时直接浮动 promise */
  waitUntil?: (promise: Promise<unknown>) => void
  fetchImpl?: typeof fetch
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
      const placeId = String(url.searchParams.get('placeId') || '').trim()
      const maxWidth = sanitizeMaxWidth(url.searchParams.get('maxwidth'))
      const index = parsePhotoIndex(url.searchParams.get('i'))
      if (index === null) {
        return NextResponse.json({ error: '图片参数错误' }, { status: 400 })
      }
      // 带 placeId 一律走 placeId 寻址路径（忽略 ref，杜绝未校验的 ref 混入）；
      // 此时 placeId 本身必须合法。只有不带 placeId 时才按 ref 校验走存量路径。
      if (placeId) {
        if (!isValidPlaceId(placeId)) {
          return NextResponse.json({ error: '图片参数错误' }, { status: 400 })
        }
        return servePlacePhotoByPlaceId(deps, placeId, maxWidth, index)
      }
      // R10：ref= 是存量兼容路径，只支持第 0 张——序号寻址必须走地点库（placeId 路径）
      if (index > 0) {
        return NextResponse.json({ error: '图片参数错误' }, { status: 400 })
      }
      if (!isValidPhotoReference(ref)) {
        return NextResponse.json({ error: '图片参数错误' }, { status: 400 })
      }
      if (!deps.apiKey) {
        return NextResponse.json({ error: '图片服务未配置' }, { status: 503 })
      }

      const canonicalUrl = buildPhotoRefCanonicalUrl(ref, maxWidth)

      // read-through：R2 命中就不打 Google
      if (deps.bucket) {
        const mirrored = await readMirrored(deps.bucket, canonicalUrl)
        if (mirrored) return mirrored
      }

      const fetched = await fetchGooglePlacePhoto({ photoReference: ref, maxWidth, apiKey: deps.apiKey, fetchImpl })
      if (!fetched.ok) return photoFetchErrorResponse(fetched)

      return finishWithUpstream(deps, fetched.bytes, fetched.mimeType, canonicalUrl)
    },
  }
}

/**
 * placeId 寻址路径（A3 起导出，A5 点位兜底图接口复用）：
 * 库取第 index 张照片引用 → R2 read-through → 上游（过期则 Place Details
 * 拉整组照片、updatePhotos 回写后按 index 重试）。
 */
export async function servePlacePhotoByPlaceId(
  deps: PlacePhotoHandlerDeps,
  placeId: string,
  maxWidth: number,
  index = 0,
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch
  if (!deps.store) {
    return NextResponse.json({ error: '地点库未配置' }, { status: 503 })
  }
  if (!deps.apiKey) {
    return NextResponse.json({ error: '图片服务未配置' }, { status: 503 })
  }

  const record = await deps.store.findByPlaceId('google', placeId).catch(() => null)
  if (!record) {
    return NextResponse.json({ error: '地点或其照片不存在' }, { status: 404 })
  }
  const photos = record.photos ?? (record.photo ? [{ photoReference: record.photo.photoReference, attribution: record.photo.attribution }] : [])
  const current = photos[index]
  if (!current) {
    return NextResponse.json({ error: '地点或其照片不存在' }, { status: 404 })
  }

  const canonicalUrl = buildPlacePhotoCanonicalUrl(placeId, maxWidth, index)

  // read-through：R2 命中就不打 Google（placeId canonical 与引用解耦，过期不影响）
  if (deps.bucket) {
    const mirrored = await readMirrored(deps.bucket, canonicalUrl)
    if (mirrored) return mirrored
  }

  let fetched = await fetchGooglePlacePhoto({
    photoReference: current.photoReference,
    maxWidth,
    apiKey: deps.apiKey,
    fetchImpl,
  })

  // 引用过期（denied/not_found）→ Place Details 拉整组照片、updatePhotos 回写，
  // 再按 index 重试；浏览器无感
  if (!fetched.ok && (fetched.status === 'denied' || fetched.status === 'not_found')) {
    const refreshed = await fetchPlacePhotos({ placeId, apiKey: deps.apiKey, fetchImpl })
    if (refreshed && refreshed.length > 0) {
      await deps.store
        .updatePhotos('google', placeId, refreshed)
        .catch(() => undefined)
      const retryRef = refreshed[index]?.photoReference
      if (retryRef) {
        fetched = await fetchGooglePlacePhoto({
          photoReference: retryRef,
          maxWidth,
          apiKey: deps.apiKey,
          fetchImpl,
        })
      }
    }
  }

  if (!fetched.ok) {
    // R6：镜像状态列没有序号维度——只有 index 0 的失败才落 failed
    if (index === 0) {
      void deps.store.setPhotoMirror('google', placeId, { status: 'failed' }).catch(() => undefined)
    }
    return photoFetchErrorResponse(fetched)
  }

  // R6：index > 0 的上游成功仍然 put R2（canonical 带 i），但不改 photoMirror* 列
  return finishWithUpstream(
    deps,
    fetched.bytes,
    fetched.mimeType,
    canonicalUrl,
    index === 0
      ? (mirror) =>
          deps
            .store!
            .setPhotoMirror(
              'google',
              placeId,
              mirror
                ? { status: 'mirrored', key: mirror.key, mirroredAt: new Date() }
                : { status: 'failed' },
            )
            .catch(() => undefined)
      : undefined,
  )
}
