/**
 * AnitabiPoint ↔ Google 地点映射（回归第四轮 A5 点位兜底图）：领域类型与内存实现。
 * `/api/google/point-photo?pointId=...` 服务端按点位名 + 坐标解析 Google 地点，
 * 落库映射后按 placeId 路径回图。解析结果（含 not_found）落库，7 天内不再重试。
 */

export type PointPlaceLinkRow = {
  id: string
  name: string
  nameZh: string | null
  lat: number | null
  lng: number | null
  googlePlaceId: string | null
  googlePlaceStatus: 'resolved' | 'not_found' | null
  googlePlaceResolvedAt: Date | null
}

export interface PointPlaceLinkStore {
  findPoint(pointId: string): Promise<PointPlaceLinkRow | null>
  setLink(pointId: string, link: { placeId: string | null; status: 'resolved' | 'not_found'; resolvedAt: Date }): Promise<void>
}

/** not_found 结果的重试间隔（7 天内不再重试解析） */
export const POINT_LINK_NOT_FOUND_RETRY_MS = 7 * 24 * 3600 * 1000

/** 解析结果与点位允许的最大直线距离（超出视为不同地点） */
export const POINT_LINK_MAX_DISTANCE_KM = 1

/** 内存实现：测试替身 + 语义参照；calls 记录 setLink 调用历史（断言用） */
export type MemoryPointPlaceLinkStore = PointPlaceLinkStore & {
  calls: Array<{ pointId: string; placeId: string | null; status: string; resolvedAt: Date }>
}

export function createMemoryPointPlaceLinkStore(seed: PointPlaceLinkRow[] = []): MemoryPointPlaceLinkStore {
  const rows = new Map<string, PointPlaceLinkRow>(seed.map((row) => [row.id, { ...row }]))
  const setLinkCalls: MemoryPointPlaceLinkStore['calls'] = []
  return {
    async findPoint(pointId) {
      const row = rows.get(pointId)
      return row ? { ...row } : null
    },
    async setLink(pointId, link) {
      const row = rows.get(pointId)
      if (!row) return
      row.googlePlaceId = link.placeId
      row.googlePlaceStatus = link.status
      row.googlePlaceResolvedAt = link.resolvedAt
      setLinkCalls.push({ pointId, placeId: link.placeId, status: link.status, resolvedAt: link.resolvedAt })
    },
    calls: setLinkCalls,
  }
}

/** Prisma 行 → 领域行（select 列与 PointPlaceLinkRow 对齐；实现见 pointPlaceLinkPrisma.ts） */
type PrismaPointRow = {
  id: string
  name: string
  nameZh: string | null
  geoLat: number | null
  geoLng: number | null
  googlePlaceId: string | null
  googlePlaceStatus: string | null
  googlePlaceResolvedAt: Date | null
}

export function toPointPlaceLinkRow(row: PrismaPointRow): PointPlaceLinkRow {
  const status = row.googlePlaceStatus === 'resolved' || row.googlePlaceStatus === 'not_found' ? row.googlePlaceStatus : null
  return {
    id: row.id,
    name: row.name,
    nameZh: row.nameZh,
    lat: row.geoLat,
    lng: row.geoLng,
    googlePlaceId: row.googlePlaceId,
    googlePlaceStatus: status,
    googlePlaceResolvedAt: row.googlePlaceResolvedAt,
  }
}
