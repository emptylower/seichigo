import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAnimeById } from '@/lib/anime/getAllAnime'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export const runtime = 'nodejs'

const patchSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(120)
    .refine((v) => v.trim().length > 0, { message: '作品名不能为空' })
    .optional(),
  cover: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  hidden: z.boolean().optional(),
})

function routeError(err: unknown) {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json({ error: '数据库结构未更新，请先执行迁移' }, { status: 503 })
  }

  const msg = String((err as { message?: unknown } | null)?.message || '')
  if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }

  return NextResponse.json({ error: '服务器错误' }, { status: 500 })
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }
  const { id } = await params
  const anime = await getAnimeById(id, { includeHidden: true })
  if (!anime) {
    return NextResponse.json({ error: '未找到' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, anime })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
    }

    const current = await getAnimeById(id, { includeHidden: true })
    if (!current) {
      return NextResponse.json({ error: '未找到作品（请先创建）' }, { status: 404 })
    }

    const name = parsed.data.name != null ? parsed.data.name.trim() : undefined
    const { cover, summary, hidden } = parsed.data
    const data: { name?: string; cover?: string | null; summary?: string | null; hidden?: boolean } = {}
    if (name !== undefined) data.name = name
    if (cover !== undefined) data.cover = cover
    if (summary !== undefined) data.summary = summary
    if (hidden !== undefined) data.hidden = hidden

    const updated = await prisma.anime.upsert({
      where: { id },
      create: {
        id,
        name: name ?? current.name,
        cover: cover ?? current.cover,
        summary: summary ?? current.summary,
        hidden: hidden ?? current.hidden ?? false,
      },
      update: data,
    })

    return NextResponse.json({ ok: true, anime: updated })
  } catch (err) {
    console.error('[api/admin/anime/[id]] PATCH failed', err)
    return routeError(err)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }
  const { id } = await params
  const current = await getAnimeById(id, { includeHidden: true })
  if (!current) {
    return NextResponse.json({ error: '未找到' }, { status: 404 })
  }

  // Soft delete (hide)
  const updated = await prisma.anime.upsert({
    where: { id },
    create: {
      id,
      name: current.name,
      hidden: true,
    },
    update: {
      hidden: true,
    },
  })

  return NextResponse.json({ ok: true, anime: updated })
}
