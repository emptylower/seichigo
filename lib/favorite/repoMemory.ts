import type { FavoriteRecord, FavoriteRepo, FavoriteTarget } from './repo'

type Options = {
  now?: () => Date
}

function normalizeKey(target: FavoriteTarget): string {
  if (target.source === 'db') return `db:${target.articleId}`
  return `mdx:${target.slug}`
}

export class InMemoryFavoriteRepo implements FavoriteRepo {
  private readonly now: () => Date
  private readonly byUser = new Map<string, Map<string, FavoriteRecord>>()

  constructor(options?: Options) {
    this.now = options?.now ?? (() => new Date())
  }

  async add(userId: string, target: FavoriteTarget): Promise<void> {
    const key = normalizeKey(target)
    const map = this.byUser.get(userId) ?? new Map<string, FavoriteRecord>()
    if (!this.byUser.has(userId)) this.byUser.set(userId, map)
    if (map.has(key)) return
    map.set(key, { ...target, createdAt: this.now() })
  }

  async remove(userId: string, target: FavoriteTarget): Promise<void> {
    const key = normalizeKey(target)
    const map = this.byUser.get(userId)
    map?.delete(key)
  }

  async isFavorited(userId: string, target: FavoriteTarget): Promise<boolean> {
    const key = normalizeKey(target)
    const map = this.byUser.get(userId)
    return Boolean(map?.has(key))
  }

  async listByUser(userId: string): Promise<FavoriteRecord[]> {
    const map = this.byUser.get(userId)
    const all = map ? Array.from(map.values()) : []
    return all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }
}

