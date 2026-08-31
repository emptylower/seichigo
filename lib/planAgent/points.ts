export type BangumiHit = { id: number; titleZh: string | null; titleJaRaw: string | null; city: string | null }
export type AgentPoint = { id: string; name: string; nameZh: string | null; lat: number; lng: number; ep: string | null }
export type BgmSubject = { id: number; name: string; nameCn: string }

export interface PointFinder {
  searchBangumi(query: string, limit: number): Promise<BangumiHit[]>
  countPointsByBangumi(ids: number[]): Promise<Array<{ bangumiId: number; pointCount: number }>>
  listPoints(bangumiId: number, limit: number): Promise<AgentPoint[]>
  getPointsByIds(ids: string[]): Promise<Array<{ id: string; lat: number; lng: number }>>
}
