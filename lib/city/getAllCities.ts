import fs from 'node:fs/promises'
import path from 'node:path'
import type { City } from './types'

const CITY_DIR = path.join(process.cwd(), 'content', 'city')

export async function getAllCities(): Promise<City[]> {
  const files = await fs.readdir(CITY_DIR).catch(() => [])
  const list: City[] = []

  for (const f of files.filter((x) => x.endsWith('.json'))) {
    const raw = await fs.readFile(path.join(CITY_DIR, f), 'utf-8').catch(() => '{}')
    try {
      const parsed = JSON.parse(raw)
      const id = String(parsed?.id || '').trim()
      const nameZh = String(parsed?.name_zh || '').trim()
      if (!id || !nameZh) continue
      list.push(parsed as City)
    } catch {
    }
  }

  const byId = new Map<string, City>()
  for (const c of list) {
    if (c?.id) byId.set(c.id, c)
  }

  return Array.from(byId.values())
}
