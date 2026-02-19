import type { PointPoolRepo } from '@/lib/pointPool/repo'
import type { RouteBookRepo } from '@/lib/routeBook/repo'
import type { UserPointState, UserPointStateRepo, UserPointStateValue } from '@/lib/userPointState/repo'

export type ResolvePointStateFilters = {
  bangumiId?: number
  state?: UserPointStateValue
}

export type ResolvedPointState = {
  pointId: string
  state: UserPointStateValue
  checkedInAt: Date | null
  gpsVerified: boolean
  photoUrl: string | null
  updatedAt: Date
}

type ResolvePointStatesDeps = {
  pointStateRepo: UserPointStateRepo
  pointPoolRepo: PointPoolRepo
  routeBookRepo: RouteBookRepo
}

const STATE_PRIORITY: Record<UserPointStateValue, number> = {
  checked_in: 3,
  planned: 2,
  want_to_go: 1,
}

function shouldReplace(current: ResolvedPointState | undefined, next: ResolvedPointState): boolean {
  if (!current) return true

  const currentPriority = STATE_PRIORITY[current.state]
  const nextPriority = STATE_PRIORITY[next.state]
  if (nextPriority > currentPriority) return true
  if (nextPriority < currentPriority) return false

  return next.updatedAt.getTime() > current.updatedAt.getTime()
}

function toCheckedInState(row: UserPointState): ResolvedPointState {
  return {
    pointId: row.pointId,
    state: 'checked_in',
    checkedInAt: row.checkedInAt,
    gpsVerified: row.gpsVerified,
    photoUrl: row.photoUrl,
    updatedAt: row.updatedAt,
  }
}

export async function resolveUserPointStates(
  deps: ResolvePointStatesDeps,
  userId: string,
  filters?: ResolvePointStateFilters
): Promise<ResolvedPointState[]> {
  const [checkedInRows, plannedRows, wantToGoRows] = await Promise.all([
    deps.pointStateRepo.listByUser(userId, {
      state: 'checked_in',
      ...(filters?.bangumiId !== undefined ? { bangumiId: filters.bangumiId } : {}),
    }),
    deps.routeBookRepo.listPointRefsByUser(userId, {
      ...(filters?.bangumiId !== undefined ? { bangumiId: filters.bangumiId } : {}),
    }),
    deps.pointPoolRepo.listByUser(userId, {
      ...(filters?.bangumiId !== undefined ? { bangumiId: filters.bangumiId } : {}),
    }),
  ])

  const resolved = new Map<string, ResolvedPointState>()

  for (const row of wantToGoRows) {
    const next: ResolvedPointState = {
      pointId: row.pointId,
      state: 'want_to_go',
      checkedInAt: null,
      gpsVerified: false,
      photoUrl: null,
      updatedAt: row.updatedAt,
    }

    if (shouldReplace(resolved.get(row.pointId), next)) {
      resolved.set(row.pointId, next)
    }
  }

  for (const row of plannedRows) {
    const next: ResolvedPointState = {
      pointId: row.pointId,
      state: 'planned',
      checkedInAt: null,
      gpsVerified: false,
      photoUrl: null,
      updatedAt: row.updatedAt,
    }

    if (shouldReplace(resolved.get(row.pointId), next)) {
      resolved.set(row.pointId, next)
    }
  }

  for (const row of checkedInRows) {
    const next = toCheckedInState(row)
    if (shouldReplace(resolved.get(row.pointId), next)) {
      resolved.set(row.pointId, next)
    }
  }

  let items = Array.from(resolved.values()).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

  if (filters?.state) {
    items = items.filter((item) => item.state === filters.state)
  }

  return items
}
