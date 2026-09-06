/**
 * 解析结果的照片镜像服务：resolver 的 onResolved 回调里后台执行——
 * 抓取照片字节 → putMirroredImage 落 R2（canonical 按 placeId，不含密钥）→
 * store.setPhotoMirror 记录状态；以及引用过期时用 Place Details 刷新 photo_reference。
 */

import { isValidPhotoReference, type PlacePhotoRef } from '@/lib/googlePlaces/places'
import { buildPlacePhotoCanonicalUrl, fetchGooglePlacePhoto } from '@/lib/googlePlaces/photoFetch'
import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'
import { putMirroredImage, type R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

const MIRROR_MAX_WIDTH = 1600
const DETAILS_TIMEOUT_MS = 8_000

export type MirrorPlacePhotoResult = { status: 'skipped' | 'mirrored' | 'failed'; key?: string }

export type MirrorPlacePhotoInput = {
  store: ExternalPlaceStore
  bucket?: R2MirrorBucket
  apiKey: string
  fetchImpl?: typeof fetch
  /** resolver 刚解析出的地点（只用 placeId 与 photo.photoReference） */
  place: { placeId: string; photo?: { photoReference: string } | null }
}

/**
 * 镜像一个地点的照片：无 bucket 或无 photoReference 时直接 skipped；
 * 成功后 R2 key 输入是 placeId 寻址的 keyless canonical（引用过期后镜像不失效）。
 * 任何失败只落 photoMirrorStatus='failed'，绝不抛出（调用方在后台任务里执行）。
 */
export async function mirrorPlacePhoto(input: MirrorPlacePhotoInput): Promise<MirrorPlacePhotoResult> {
  const photoReference = input.place.photo?.photoReference ?? null
  if (!input.bucket || !photoReference) return { status: 'skipped' }
  try {
    const fetched = await fetchGooglePlacePhoto({
      photoReference,
      maxWidth: MIRROR_MAX_WIDTH,
      apiKey: input.apiKey,
      fetchImpl: input.fetchImpl,
    })
    if (!fetched.ok) {
      await input.store.setPhotoMirror('google', input.place.placeId, { status: 'failed' })
      return { status: 'failed' }
    }
    const canonical = buildPlacePhotoCanonicalUrl(input.place.placeId, MIRROR_MAX_WIDTH)
    const written = await putMirroredImage(input.bucket, canonical, fetched.bytes, fetched.mimeType, 'lazy')
    await input.store.setPhotoMirror('google', input.place.placeId, {
      status: 'mirrored',
      key: written.key,
      mirroredAt: new Date(),
    })
    return { status: 'mirrored', key: written.key }
  } catch {
    return { status: 'failed' }
  }
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim()
}

type PlaceDetailsBody = {
  status?: string
  result?: {
    photos?: Array<{
      photo_reference?: string
      html_attributions?: string[]
    }>
  }
}

/**
 * 用 Place Details（fields=photos）拉取一个地点的全部照片引用（最多前 10 个
 * 合法引用）。无照片/请求失败返回 null。API key 只进请求 URL。
 * F7：onGoogleCall 只在真实向 Google 发 Place Details 请求前回调一次——
 * 由计数发生在真实外呼处的语义保证（镜像/缓存命中不产生请求就不计数）。
 */
export async function fetchPlacePhotos(input: {
  placeId: string
  apiKey: string
  fetchImpl?: typeof fetch
  onGoogleCall?: () => void
}): Promise<PlacePhotoRef[] | null> {
  const fetchImpl = input.fetchImpl ?? fetch
  try {
    const params = new URLSearchParams({
      place_id: input.placeId,
      fields: 'photos',
      key: input.apiKey,
    })
    input.onGoogleCall?.()
    const res = await fetchImpl(`https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`, {
      signal: AbortSignal.timeout(DETAILS_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as PlaceDetailsBody | null
    if (!body || (body.status !== 'OK' && body.status !== 'ZERO_RESULTS')) return null
    const photos: PlacePhotoRef[] = []
    for (const photo of body.result?.photos ?? []) {
      if (typeof photo.photo_reference !== 'string' || !isValidPhotoReference(photo.photo_reference)) continue
      photos.push({
        photoReference: photo.photo_reference,
        attribution: photo.html_attributions?.[0] ? stripHtml(photo.html_attributions[0]) : null,
      })
      if (photos.length >= 10) break
    }
    // 无合法照片与失败同口径：null（调用方无需区分"没有照片"与"没查到"）
    return photos.length ? photos : null
  } catch {
    return null
  }
}

/**
 * 用 Place Details（fields=photos）刷新一个地点的 photo_reference：
 * 引用过期（代理抓取 denied/not_found）时服务端调用，浏览器无感。
 * 返回新的引用与纯文本署名；无照片/请求失败返回 null。API key 只进请求 URL。
 */
export async function refreshPhotoReference(input: {
  placeId: string
  apiKey: string
  fetchImpl?: typeof fetch
}): Promise<{ photoReference: string; attribution: string | null } | null> {
  const photos = await fetchPlacePhotos(input)
  return photos?.[0] ?? null
}
