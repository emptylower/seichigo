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
  return list
}

export async function getAnimeById(id: string): Promise<Anime | null> {
  const dir = path.join(process.cwd(), 'content', 'anime')
  try {
    const raw = await fs.readFile(path.join(dir, `${id}.json`), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

