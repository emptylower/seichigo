import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { buildPlacePhotoDisplayUrl, type PlacePhotoRef, type ResolvedPlace } from '@/lib/googlePlaces/places'
import {
  PLACE_METADATA_TTL_MS,
  parsePlacePhotoRefs,
  type ExternalPlaceRecord,
  type ExternalPlaceStore,
} from '@/lib/googlePlaces/store'

/**
 * ExternalPlaceStore 的 Prisma 实现（Postgres）。
 * - upsert 双表：地点行（provider+placeId 唯一）+ 查询词行（provider+normalizedQuery 唯一）。
 *   查询词行先 upsert 地点行再写，靠外键保证一致；镜像状态字段在更新时不覆盖。
 * - findByQuery：query 行 → include 地点行，fetchedAt 超 30 天按未命中。
 * - photos JSON 列：逐项校验 photoReference 形状；没有列值时退化为
 *   [ { photoReference: row.photoReference, attribution: row.photoAttribution } ]。
 * - lastUsedAt 命中时异步刷新（updateMany，失败忽略），不阻塞解析路径。
 */

type ExternalPlaceRow = Prisma.ExternalPlaceGetPayload<Record<string, never>>

function photosOfRow(row: Pick<ExternalPlaceRow, 'photos' | 'photoReference' | 'photoAttribution'>): PlacePhotoRef[] {
  const parsed = parsePlacePhotoRefs(row.photos)
  if (parsed.length > 0) return parsed
  return row.photoReference ? [{ photoReference: row.photoReference, attribution: row.photoAttribution }] : []
}

function toRecord(row: ExternalPlaceRow): ExternalPlaceRecord {
  return {
    provider: 'google',
    placeId: row.placeId,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    mapsUri: row.mapsUri,
    photo: row.photoReference
      ? {
          photoReference: row.photoReference,
          displayUrl: buildPlacePhotoDisplayUrl({ placeId: row.placeId }),
          attribution: row.photoAttribution,
        }
      : null,
    photos: photosOfRow(row),
    fetchedAt: row.fetchedAt.toISOString(),
    photoMirrorStatus: (row.photoMirrorStatus as ExternalPlaceRecord['photoMirrorStatus']) ?? 'none',
    photoMirrorKey: row.photoMirrorKey,
  }
}

function isFresh(row: ExternalPlaceRow, now: number): boolean {
  return now - row.fetchedAt.getTime() <= PLACE_METADATA_TTL_MS
}

export function createPrismaExternalPlaceStore(options?: { client?: PrismaClient }): ExternalPlaceStore {
  const client = options?.client ?? (prisma as unknown as PrismaClient)
  const now = () => Date.now()

  function touchLastUsed(provider: string, placeId: string): void {
    void client.externalPlace
      .updateMany({
        where: { provider, placeId },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => undefined)
  }

  return {
    async findByQuery(provider, normalizedQuery) {
      const row = await client.externalPlaceQuery.findUnique({
        where: { provider_normalizedQuery: { provider, normalizedQuery } },
        include: { place: true },
      })
      if (!row) return null
      if (!isFresh(row.place, now())) return null
      touchLastUsed(provider, row.placeId)
      return toRecord(row.place)
    },
    async findByPlaceId(provider, placeId) {
      const row = await client.externalPlace.findUnique({
        where: { provider_placeId: { provider, placeId } },
      })
      if (!row) return null
      touchLastUsed(provider, placeId)
      return toRecord(row)
    },
    async upsert(place, normalizedQuery) {
      const fetchedAt = new Date(place.fetchedAt)
      const incoming: PlacePhotoRef[] = place.photos ?? (place.photo ? [{ photoReference: place.photo.photoReference, attribution: place.photo.attribution }] : [])
      // R7：先读库里现有 photos——新解析结果只有 1 张而库里已有整组（≥2 张，来自
      // Place Details）时保留库里整组（photoReference/attribution 对齐为库里
      // photos[0]）；新结果无照片时清空 photos（不残留旧值）
      const existing = await client.externalPlace.findUnique({
        where: { provider_placeId: { provider: place.provider, placeId: place.placeId } },
        select: { photos: true },
      })
      const existingPhotos = existing ? parsePlacePhotoRefs(existing.photos) : []
      const keepExisting = existingPhotos.length > 1 && incoming.length === 1
      const photos = keepExisting ? existingPhotos : incoming
      const first = photos[0]
      await client.externalPlace.upsert({
        where: { provider_placeId: { provider: place.provider, placeId: place.placeId } },
        create: {
          provider: place.provider,
          placeId: place.placeId,
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          mapsUri: place.mapsUri,
          photoReference: place.photo?.photoReference ?? null,
          photoAttribution: place.photo?.attribution ?? null,
          photos: (incoming.length ? incoming : undefined) as Prisma.InputJsonValue | undefined,
          fetchedAt,
          lastUsedAt: new Date(),
        },
        update: {
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          mapsUri: place.mapsUri,
          photoReference: first?.photoReference ?? null,
          photoAttribution: first?.attribution ?? null,
          photos: (photos.length ? photos : []) as Prisma.InputJsonValue,
          fetchedAt,
          lastUsedAt: new Date(),
        },
      })
      if (normalizedQuery) {
        await client.externalPlaceQuery.upsert({
          where: { provider_normalizedQuery: { provider: place.provider, normalizedQuery } },
          create: { provider: place.provider, normalizedQuery, placeId: place.placeId },
          update: { placeId: place.placeId },
        })
      }
    },
    async setPhotoMirror(provider, placeId, patch) {
      await client.externalPlace.update({
        where: { provider_placeId: { provider, placeId } },
        data: {
          photoMirrorStatus: patch.status,
          ...(patch.key !== undefined ? { photoMirrorKey: patch.key } : {}),
          ...(patch.mirroredAt !== undefined ? { photoMirroredAt: patch.mirroredAt } : {}),
        },
      })
    },
    async updatePhotoReference(provider, placeId, photoReference, attribution) {
      // photos 非空时把 photos[0] 一并替换（保留其余照片）：先读后写（罕见路径，多一次读可接受）
      const existing = await client.externalPlace.findUnique({
        where: { provider_placeId: { provider, placeId } },
        select: { photos: true },
      })
      const current = existing ? photosOfRow({ ...existing, photoReference: null, photoAttribution: null }) : []
      const nextPhotos =
        photoReference === null
          ? []
          : current.length > 0
            ? [{ photoReference, attribution }, ...current.slice(1)]
            : [{ photoReference, attribution }]
      await client.externalPlace.update({
        where: { provider_placeId: { provider, placeId } },
        data: {
          photoReference,
          photoAttribution: attribution,
          photos: nextPhotos as unknown as Prisma.InputJsonValue,
          // 注意：不更新 fetchedAt——照片引用刷新不能延长 30 天元数据 TTL
        },
      })
    },
    async updatePhotos(provider, placeId, photos) {
      const first: PlacePhotoRef | undefined = photos[0]
      await client.externalPlace.update({
        where: { provider_placeId: { provider, placeId } },
        data: {
          photos: (photos.length ? photos : []) as unknown as Prisma.InputJsonValue,
          photoReference: first?.photoReference ?? null,
          photoAttribution: first?.attribution ?? null,
          // 注意：不更新 fetchedAt——照片刷新不能延长 30 天元数据 TTL
        },
      })
    },
  }
}

/** 进程级单例（workerd 隔离体内各自持有；库不可用时由调用方降级） */
let singleton: ExternalPlaceStore | null = null

export function getPrismaExternalPlaceStore(): ExternalPlaceStore {
  if (!singleton) singleton = createPrismaExternalPlaceStore()
  return singleton
}
