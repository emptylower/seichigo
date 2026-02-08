import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAllAnime } from '@/lib/anime/getAllAnime'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { resolveAnimeId } from '@/lib/anime/id'

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

function getLocalizedName(anime: any, language: string): string {
  if (language === 'en' && anime.name_en) return anime.name_en
  if (language === 'ja' && anime.name_ja) return anime.name_ja
  return anime.name
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q') || ''
  const language = url.searchParams.get('language') || 'zh'
  
  const all = await getAllAnime()
  const filtered = all.filter((a) => matches(a, q)).slice(0, 30)
  
  const localized = filtered.map(anime => ({
    ...anime,
    name: getLocalizedName(anime, language)
  }))
  
  return NextResponse.json({ ok: true, items: localized })
}

const createSchema = z.object({
  id: z.string().min(1).refine((v) => v.trim().length > 0, { message: 'id 不能为空' }),
  name: z.string().optional(),
})

export async function POST(req: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
  }

  const requestedId = parsed.data.id.trim()
  const name = (parsed.data.name ?? parsed.data.id).trim()
  if (!name) {
    return NextResponse.json({ error: 'name 不能为空' }, { status: 400 })
  }
  const resolvedId = resolveAnimeId(requestedId, name)
  if (!resolvedId) {
    return NextResponse.json(
      { error: '请使用英文作品 ID（小写字母/数字/连字符），例如 weathering-with-you' },
      { status: 400 }
    )
  }

  const existing = await prisma.anime.findUnique({ where: { id: resolvedId } }).catch(() => null)
  if (existing) {
    return NextResponse.json({ ok: true, anime: { id: existing.id, name: existing.name } })
  }

  try {
    const created = await prisma.anime.create({
      data: {
        id: resolvedId,
        name,
        alias: [],
      },
    })
    return NextResponse.json({ ok: true, anime: { id: created.id, name: created.name } })
  } catch (err: any) {
    // unique constraint, race
    const fallback = await prisma.anime.findUnique({ where: { id: resolvedId } }).catch(() => null)
    if (fallback) {
      return NextResponse.json({ ok: true, anime: { id: fallback.id, name: fallback.name } })
    }
    throw err
  }
}
