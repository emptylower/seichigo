export type UserPointStateValue = 'want_to_go' | 'planned' | 'checked_in'

export type UserPointState = {
  id: string
  userId: string
  pointId: string
  state: UserPointStateValue
  checkedInAt: Date | null
  gpsVerified: boolean
  photoUrl: string | null
  createdAt: Date
  updatedAt: Date
}

export type UpsertUserPointStateOpts = {
  checkedInAt?: Date | null
  gpsVerified?: boolean
  photoUrl?: string | null
}

export type ListByUserFilters = {
  state?: UserPointStateValue
  bangumiId?: number
}

export interface UserPointStateRepo {
  upsert(userId: string, pointId: string, state: UserPointStateValue, opts?: UpsertUserPointStateOpts): Promise<UserPointState>
  delete(userId: string, pointId: string): Promise<boolean>
  listByUser(userId: string, filters?: ListByUserFilters): Promise<UserPointState[]>
  getByUserAndPoint(userId: string, pointId: string): Promise<UserPointState | null>
  countByBangumi(userId: string, bangumiId: number): Promise<number>
}
