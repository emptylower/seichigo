import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAnimeById } from '@/lib/anime/getAllAnime'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export const runtime = 'nodejs'

const patchSchema = z.object({
  cover: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  hidden: z.boolean().optional(),
})

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
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }

  const current = await getAnimeById(id, { includeHidden: true })
  if (!current) {
    return NextResponse.json({ error: '未找到作品（请先创建）' }, { status: 404 })
  }

  const { cover, summary, hidden } = parsed.data
  const data: any = {}
  if (cover !== undefined) data.cover = cover
  if (summary !== undefined) data.summary = summary
  if (hidden !== undefined) data.hidden = hidden

  const updated = await prisma.anime.upsert({
    where: { id },
    create: {
      id,
      name: current.name, // Use existing name (from JSON or DB)
      cover: cover ?? current.cover,
      summary: summary ?? current.summary,
      hidden: hidden ?? current.hidden ?? false,
    },
    update: data,
  })

  return NextResponse.json({ ok: true, anime: updated })
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
