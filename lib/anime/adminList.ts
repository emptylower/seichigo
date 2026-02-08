import { getAllAnime } from '@/lib/anime/getAllAnime'

export type AdminAnimeListItem = {
  id: string
  name: string
  alias: string[]
  hidden: boolean
}

export type AdminAnimeListResult = {
  items: AdminAnimeListItem[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

type ListOptions = {
  q?: string
  page?: number
  pageSize?: number
}

function clampInt(value: unknown, fallback: number, opts?: { min?: number; max?: number }): number {
  const min = opts?.min ?? 1
  const max = opts?.max ?? 100
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function normalize(input: string): string {
  return input.trim().toLowerCase()
}

function matches(item: { id: string; name: string; alias?: string[] }, q: string): boolean {
  const needle = normalize(q)
  if (!needle) return true
  if (normalize(item.id).includes(needle)) return true
  if (normalize(item.name).includes(needle)) return true
  for (const a of item.alias || []) {
    if (normalize(String(a)).includes(needle)) return true
  }
  return false
}

function toAdminItem(input: { id: string; name: string; alias?: string[]; hidden?: boolean }): AdminAnimeListItem {
  return {
    id: String(input.id || ''),
    name: String(input.name || input.id || ''),
    alias: Array.isArray(input.alias) ? input.alias.map((x) => String(x || '')).filter(Boolean) : [],
    hidden: Boolean(input.hidden),
  }
}

export async function listAdminAnime(options?: ListOptions): Promise<AdminAnimeListResult> {
  const q = String(options?.q || '')
  const page = clampInt(options?.page, 1, { min: 1, max: 10_000 })
  const pageSize = clampInt(options?.pageSize, 36, { min: 12, max: 120 })

  const all = await getAllAnime({ includeHidden: true })
  const filtered = all.filter((a) => matches(a, q))

  filtered.sort((a, b) => {
    if (a.hidden !== b.hidden) return a.hidden ? 1 : -1
    return String(a.id || '').localeCompare(String(b.id || ''))
  })

  const total = filtered.length
  const start = (page - 1) * pageSize
  const end = start + pageSize

  return {
    items: filtered.slice(start, end).map(toAdminItem),
    total,
    page,
    pageSize,
    hasMore: end < total,
  }
}
