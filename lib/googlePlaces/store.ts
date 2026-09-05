import { isValidPhotoReference, type PlacePhotoRef, type ResolvedPlace } from '@/lib/googlePlaces/places'

/**
 * 地点库（ExternalPlace/ExternalPlaceQuery）的领域接口。
 * 设计：docs/superpowers/specs/2026-09-02-plan-agent-external-place-store-design.md §5.1
 * - 查询词键 = normalizePlaceQuery 的输出；命中以 fetchedAt 新鲜度（30 天）为准。
 * - placeId 与 R2 镜像长期保留；只有元数据按 TTL 重查 Google。
 */

export type ExternalPlaceRecord = ResolvedPlace & {
  photoMirrorStatus: 'none' | 'pending' | 'mirrored' | 'failed'
  photoMirrorKey: string | null
  /** 已知照片引用列表（无照片为 []；photoReference 列始终等于 photos[0]） */
  photos: PlacePhotoRef[]
}

/** Places 元数据新鲜度（对齐 Google Places 数据缓存政策的 30 天上限） */
export const PLACE_METADATA_TTL_MS = 30 * 24 * 3600 * 1000

export interface ExternalPlaceStore {
  /** 按归一化查询词取地点（fetchedAt 超过 30 天按未命中返回 null） */
  findByQuery(provider: 'google', normalizedQuery: string): Promise<ExternalPlaceRecord | null>
  findByPlaceId(provider: 'google', placeId: string): Promise<ExternalPlaceRecord | null>
  /** 解析结果落库；normalizedQuery 为 null 时只 upsert 地点行 */
  upsert(place: ResolvedPlace, normalizedQuery: string | null): Promise<void>
  setPhotoMirror(
    provider: 'google',
    placeId: string,
    patch: {
      status: ExternalPlaceRecord['photoMirrorStatus']
      key?: string | null
      mirroredAt?: Date | null
    },
  ): Promise<void>
  /** 照片引用过期后由 Place Details 刷新时回写 */
  updatePhotoReference(
    provider: 'google',
    placeId: string,
    photoReference: string | null,
    attribution: string | null,
  ): Promise<void>
  /** 覆盖写入该地点的全部照片引用（Place Details 补拉后回写）；同时把 photoReference 列同步为 photos[0] */
  updatePhotos(provider: 'google', placeId: string, photos: PlacePhotoRef[]): Promise<void>
}

/** 校验未知来源的 photos JSON 列（逐项检查 photoReference 形状），只留合法项 */
export function parsePlacePhotoRefs(raw: unknown): PlacePhotoRef[] {
  if (!Array.isArray(raw)) return []
  const refs: PlacePhotoRef[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const photoReference = typeof record.photoReference === 'string' ? record.photoReference : ''
    if (!isValidPhotoReference(photoReference)) continue
    const attribution = typeof record.attribution === 'string' ? record.attribution : null
    refs.push({ photoReference, attribution })
  }
  return refs
}
