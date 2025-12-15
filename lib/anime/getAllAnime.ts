import fs from 'node:fs/promises'
import path from 'node:path'

export type Anime = {
  id: string
  name: string
  alias?: string[]
  year?: number
  summary?: string
  cover?: string
}

export async function getAllAnime(): Promise<Anime[]> {
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
        if (!id || byId.has(id)) continue
        byId.set(id, {
          id,
          name: String(r.name || id),
          alias: Array.isArray(r.alias) ? r.alias : [],
          year: typeof r.year === 'number' ? r.year : undefined,
          summary: r.summary ?? undefined,
          cover: r.cover ?? undefined,
        })
      }
    } catch {
      // ignore if DB not migrated/available
    }
  }

  return Array.from(byId.values())
}

export async function getAnimeById(id: string): Promise<Anime | null> {
  const dir = path.join(process.cwd(), 'content', 'anime')
  try {
    const raw = await fs.readFile(path.join(dir, `${id}.json`), 'utf-8')
    return JSON.parse(raw)
  } catch {
    if (process.env.DATABASE_URL) {
      try {
        const { prisma } = await import('@/lib/db/prisma')
        const found = await prisma.anime.findUnique({ where: { id } })
        if (!found) return null
        return {
          id: String((found as any).id),
          name: String((found as any).name || id),
          alias: Array.isArray((found as any).alias) ? (found as any).alias : [],
          year: typeof (found as any).year === 'number' ? (found as any).year : undefined,
          summary: (found as any).summary ?? undefined,
          cover: (found as any).cover ?? undefined,
        }
      } catch {
        return null
      }
    }
    return null
  }
}
