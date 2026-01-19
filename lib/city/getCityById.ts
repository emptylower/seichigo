import fs from 'node:fs/promises'
import path from 'node:path'
import type { City } from './types'

const CITY_DIR = path.join(process.cwd(), 'content', 'city')

export async function getCityById(id: string): Promise<City | null> {
  const key = String(id || '').trim()
  if (!key) return null

  try {
    const raw = await fs.readFile(path.join(CITY_DIR, `${key}.json`), 'utf-8')
    const parsed = JSON.parse(raw)
    const cityId = String(parsed?.id || '').trim()
    if (!cityId) return null
    return parsed as City
  } catch {
    return null
  }
}
