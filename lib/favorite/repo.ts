export type FavoriteTarget =
  | { source: 'db'; articleId: string }
  | { source: 'mdx'; slug: string }

export type FavoriteRecord = FavoriteTarget & { createdAt: Date }

export interface FavoriteRepo {
  add: (userId: string, target: FavoriteTarget) => Promise<void>
  remove: (userId: string, target: FavoriteTarget) => Promise<void>
  listByUser: (userId: string) => Promise<FavoriteRecord[]>
  isFavorited: (userId: string, target: FavoriteTarget) => Promise<boolean>
}

