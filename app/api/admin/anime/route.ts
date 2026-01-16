import { NextResponse } from 'next/server'
import { getAllAnime } from '@/lib/anime/getAllAnime'
import { getServerAuthSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

function matches(anime: { id: string; name: string; alias?: string[] }, q: string): boolean {
  const needle = normalize(q)
  if (!needle) return true
  if (normalize(anime.id).includes(needle)) return true
  if (normalize(anime.name).includes(needle)) return true
  for (const a of anime.alias || []) {
    if (normalize(String(a)).includes(needle)) return true
  }
  return false
}

export async function GET(req: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  const url = new URL(req.url)
  const q = url.searchParams.get('q') || ''
  
  const all = await getAllAnime({ includeHidden: true })
  const filtered = all.filter((a) => matches(a, q))
  
  // Sort: hidden last, then by name
  filtered.sort((a, b) => {
    if (a.hidden !== b.hidden) return (a.hidden ? 1 : -1)
    return a.id.localeCompare(b.id)
  })

  return NextResponse.json({ ok: true, items: filtered })
}
