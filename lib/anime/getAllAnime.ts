import { unstable_cache } from 'next/cache'
import { getBundledAnimeById, getBundledAnimeList } from './publicSnapshot'

export type Anime = {
  id: string
  name: string
  alias?: string[]
  year?: number
  summary?: string
  cover?: string
  hidden?: boolean
  name_ja?: string
  name_en?: string
  summary_ja?: string
  summary_en?: string
}

export type GetAllAnimeOptions = {
  includeHidden?: boolean
  baseList?: Anime[]
}

async function loadMergedAnime(includeHidden: boolean, baseList?: Anime[]): Promise<Anime[]> {
  const list = baseList ?? getBundledAnimeList()
  const byId = new Map<string, Anime>()

  for (const anime of list) {
    if (anime?.id) byId.set(anime.id, anime)
  }

  if (process.env.DATABASE_URL) {
    try {
      const { prisma } = await import('@/lib/db/prisma')
      const records = await prisma.anime.findMany()
      for (const row of records) {
        const id = String(row.id || '').trim()
        if (!id) continue

        if (row.hidden && !includeHidden) {
          byId.delete(id)
          continue
        }

        const existing = byId.get(id)
        byId.set(id, {
          id,
          name: String(row.name || existing?.name || id),
          alias: Array.isArray(row.alias) ? row.alias : existing?.alias || [],
          year: typeof row.year === 'number' ? row.year : existing?.year || undefined,
          summary: row.summary ?? existing?.summary ?? undefined,
          cover: row.cover ?? existing?.cover ?? undefined,
          hidden: row.hidden ?? false,
          name_ja: row.name_ja ?? existing?.name_ja ?? undefined,
          name_en: row.name_en ?? existing?.name_en ?? undefined,
          summary_ja: row.summary_ja ?? existing?.summary_ja ?? undefined,
          summary_en: row.summary_en ?? existing?.summary_en ?? undefined,
        })
      }
    } catch {
      // ignore if DB not migrated/available
    }
  }

  const merged = Array.from(byId.values())
  if (includeHidden) return merged

  const shadowedLegacyIds = new Set<string>()
  const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
  for (const anime of merged) {
    if (anime.hidden) continue
    for (const aliasRaw of anime.alias || []) {
      const alias = String(aliasRaw || '').trim()
      if (!alias || !ID_RE.test(alias)) continue
      if (alias === anime.id) continue
      const legacy = byId.get(alias)
      if (!legacy) continue
      shadowedLegacyIds.add(alias)
    }
  }

  if (!shadowedLegacyIds.size) return merged
  return merged.filter((anime) => !shadowedLegacyIds.has(anime.id))
}

const getCachedMergedAnime = unstable_cache(
  async (includeHidden: boolean) => loadMergedAnime(includeHidden),
  ['anime:getAllAnime'],
  { revalidate: 120 }
)

export async function getAllAnime(options?: GetAllAnimeOptions): Promise<Anime[]> {
  if (options?.baseList) {
    return loadMergedAnime(Boolean(options?.includeHidden), options.baseList)
  }
  return getCachedMergedAnime(Boolean(options?.includeHidden))
}

export async function getAnimeById(id: string, options?: GetAllAnimeOptions): Promise<Anime | null> {
  const baseList = options?.baseList
  const fromJson = baseList
    ? baseList.find((anime) => anime.id === id) ?? null
    : getBundledAnimeById(id)

  if (process.env.DATABASE_URL) {
    try {
      const { prisma } = await import('@/lib/db/prisma')
      const found = await prisma.anime.findUnique({ where: { id } })
      if (found) {
        if (found.hidden && !options?.includeHidden) return null
        return {
          id: String(found.id),
          name: String(found.name || fromJson?.name || id),
          alias: Array.isArray(found.alias) ? found.alias : fromJson?.alias || [],
          year: typeof found.year === 'number' ? found.year : fromJson?.year || undefined,
          summary: found.summary ?? fromJson?.summary ?? undefined,
          cover: found.cover ?? fromJson?.cover ?? undefined,
          hidden: found.hidden ?? false,
          name_ja: found.name_ja ?? fromJson?.name_ja ?? undefined,
          name_en: found.name_en ?? fromJson?.name_en ?? undefined,
          summary_ja: found.summary_ja ?? fromJson?.summary_ja ?? undefined,
          summary_en: found.summary_en ?? fromJson?.summary_en ?? undefined,
        }
      }
    } catch {
      // ignore
    }
  }

  return fromJson
}
