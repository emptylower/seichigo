export type BangumiHit = { id: number; titleZh: string | null; titleJaRaw: string | null; city: string | null; cover?: string | null }
export type AgentPoint = { id: string; name: string; nameZh: string | null; lat: number; lng: number; ep: string | null }
export type BgmSubject = { id: number; name: string; nameCn: string }

export interface PointFinder {
  searchBangumi(query: string, limit: number): Promise<BangumiHit[]>
  countPointsByBangumi(ids: number[]): Promise<Array<{ bangumiId: number; pointCount: number }>>
  listPoints(bangumiId: number, limit: number): Promise<AgentPoint[]>
  /**
   * 按点位 id 批量取坐标。点位 id 存储格式是 "<bangumiId>:<rawId>"；传入
   * 不含 ":" 的裸 id 且未命中时，可用 bangumiIds（本次计划关联的作品 id）
   * 拼 scoped id 兜底重查一轮（Prisma 实现的容错层，纯内存实现可忽略）。
   * image 可选：M4 质量门控的图片门用它判定站内点位是否有图。
   */
  getPointsByIds(ids: string[], bangumiIds?: number[]): Promise<Array<{ id: string; lat: number; lng: number; image?: string | null }>>
}
