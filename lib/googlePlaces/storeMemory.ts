import { PLACE_METADATA_TTL_MS, type ExternalPlaceRecord, type ExternalPlaceStore } from '@/lib/googlePlaces/store'
import { buildPlacePhotoDisplayUrl, type PlacePhotoRef, type ResolvedPlace } from '@/lib/googlePlaces/places'

/**
 * ExternalPlaceStore 的内存实现：测试替身 + "库不可用"降级路径的参照语义。
 * 查询词 → placeId → 地点记录两层映射，模拟 Prisma 实现的唯一键约束。
 */

type PlaceRow = ExternalPlaceRecord & { fetchedAtMs: number }

export function createMemoryExternalPlaceStore(options?: { now?: () => number }): ExternalPlaceStore {
  const now = options?.now ?? (() => Date.now())
  const placesByKey = new Map<string, PlaceRow>()
  const queryToKey = new Map<string, string>()

  function keyOf(provider: string, placeId: string): string {
    return `${provider}:${placeId}`
  }

function toPlaceRow(place: ResolvedPlace, existing: PlaceRow | undefined): PlaceRow {
  const incoming: PlacePhotoRef[] =
    place.photos ?? (place.photo ? [{ photoReference: place.photo.photoReference, attribution: place.photo.attribution }] : [])
  // R7：库里已有整组照片（≥2 张，来自 Place Details）而新解析结果只有 1 张时
  // 保留库里整组（photoReference/attribution 对齐为库里 photos[0]）；新结果
  // 无照片时清空（不残留旧值）
  const keepExisting = (existing?.photos.length ?? 0) > 1 && incoming.length === 1
  const photos = keepExisting ? existing!.photos : incoming
  const first = photos[0]
  return {
    ...place,
    photos,
    photo: first
      ? {
          photoReference: first.photoReference,
          displayUrl: buildPlacePhotoDisplayUrl({ placeId: place.placeId }),
          attribution: first.attribution,
        }
      : null,
    photoMirrorStatus: existing?.photoMirrorStatus ?? 'none',
    photoMirrorKey: existing?.photoMirrorKey ?? null,
    fetchedAtMs: Date.parse(place.fetchedAt),
  }
}

  return {
    async findByQuery(provider, normalizedQuery) {
      const key = queryToKey.get(`${provider}:${normalizedQuery}`)
      if (!key) return null
      const row = placesByKey.get(key)
      if (!row) return null
      if (now() - row.fetchedAtMs > PLACE_METADATA_TTL_MS) return null
      return { ...row }
    },
    async findByPlaceId(provider, placeId) {
      const row = placesByKey.get(keyOf(provider, placeId))
      return row ? { ...row } : null
    },
    async upsert(place, normalizedQuery) {
      const key = keyOf(place.provider, place.placeId)
      placesByKey.set(key, toPlaceRow(place, placesByKey.get(key)))
      if (normalizedQuery) queryToKey.set(`${place.provider}:${normalizedQuery}`, key)
    },
    async setPhotoMirror(provider, placeId, patch) {
      const row = placesByKey.get(keyOf(provider, placeId))
      if (!row) return
      row.photoMirrorStatus = patch.status
      if (patch.key !== undefined) row.photoMirrorKey = patch.key
    },
    async updatePhotoReference(provider, placeId, photoReference, attribution) {
      const row = placesByKey.get(keyOf(provider, placeId))
      if (!row) return
      row.photo =
        photoReference === null
          ? null
          : {
              photoReference,
              displayUrl: buildPlacePhotoDisplayUrl({ placeId }),
              attribution,
            }
      // photos 非空时把 photos[0] 一并替换，保持两列一致
      if (photoReference !== null && row.photos.length > 0) {
        row.photos = [{ photoReference, attribution }, ...row.photos.slice(1)]
      }
    },
    async updatePhotos(provider, placeId, photos) {
      const row = placesByKey.get(keyOf(provider, placeId))
      if (!row) return
      const first: PlacePhotoRef | undefined = photos[0]
      row.photos = [...photos]
      row.photo = first
        ? {
            photoReference: first.photoReference,
            displayUrl: buildPlacePhotoDisplayUrl({ placeId }),
            attribution: first.attribution,
          }
        : null
      // 注意：不更新 fetchedAt——照片刷新不能延长 30 天元数据 TTL
    },
  }
}
