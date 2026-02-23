export type UserPointPoolItem = {
  id: string
  userId: string
  pointId: string
  createdAt: Date
  updatedAt: Date
}

export type ListPointPoolFilters = {
  bangumiId?: number
}

export interface PointPoolRepo {
  upsert(userId: string, pointId: string): Promise<UserPointPoolItem>
  delete(userId: string, pointId: string): Promise<boolean>
  listByUser(userId: string, filters?: ListPointPoolFilters): Promise<UserPointPoolItem[]>
  has(userId: string, pointId: string): Promise<boolean>
}
