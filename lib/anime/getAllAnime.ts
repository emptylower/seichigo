import fs from 'node:fs/promises'
import path from 'node:path'

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
}

export async function getAllAnime(options?: GetAllAnimeOptions): Promise<Anime[]> {
  const dir = path.join(process.cwd(), 'content', 'anime')
  const files = await fs.readdir(dir).catch(() => [])
  const list: Anime[] = []
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    const raw = await fs.readFile(path.join(dir, f), 'utf-8').catch(() => '{}')
    try {
      list.push(JSON.parse(raw))
    } catch {}
  }

  const byId = new Map<string, Anime>()
  for (const a of list) {
    if (a?.id) byId.set(a.id, a)
  }

  if (process.env.DATABASE_URL) {
    try {
      const { prisma } = await import('@/lib/db/prisma')
      const records = await prisma.anime.findMany()
      for (const r of records as any[]) {
        const id = String(r.id || '').trim()
        if (!id) continue
        
        if (r.hidden && !options?.includeHidden) {
          byId.delete(id)
          continue
        }

        const existing = byId.get(id)
        byId.set(id, {
          id,
          name: String(r.name || existing?.name || id),
          alias: Array.isArray(r.alias) ? r.alias : (existing?.alias || []),
          year: typeof r.year === 'number' ? r.year : (existing?.year || undefined),
          summary: r.summary ?? existing?.summary ?? undefined,
          cover: r.cover ?? existing?.cover ?? undefined,
          hidden: r.hidden ?? false,
          name_ja: r.name_ja ?? existing?.name_ja ?? undefined,
          name_en: r.name_en ?? existing?.name_en ?? undefined,
          summary_ja: r.summary_ja ?? existing?.summary_ja ?? undefined,
          summary_en: r.summary_en ?? existing?.summary_en ?? undefined,
        })
      }
    } catch {
      // ignore if DB not migrated/available
    }
  }

  return Array.from(byId.values())
}

export async function getAnimeById(id: string, options?: GetAllAnimeOptions): Promise<Anime | null> {
  const dir = path.join(process.cwd(), 'content', 'anime')
  let fromJson: Anime | null = null
  try {
    const raw = await fs.readFile(path.join(dir, `${id}.json`), 'utf-8')
    fromJson = JSON.parse(raw)
  } catch {
    // ignore
  }

  if (process.env.DATABASE_URL) {
    try {
      const { prisma } = await import('@/lib/db/prisma')
      const found = await prisma.anime.findUnique({ where: { id } })
      if (found) {
        if ((found as any).hidden && !options?.includeHidden) return null
        return {
          id: String(found.id),
          name: String(found.name || fromJson?.name || id),
          alias: Array.isArray(found.alias) ? found.alias : (fromJson?.alias || []),
          year: typeof found.year === 'number' ? found.year : (fromJson?.year || undefined),
          summary: found.summary ?? fromJson?.summary ?? undefined,
          cover: found.cover ?? fromJson?.cover ?? undefined,
          hidden: (found as any).hidden ?? false,
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
