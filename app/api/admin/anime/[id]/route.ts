import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAnimeById } from '@/lib/anime/getAllAnime'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { safeRevalidatePath } from '@/lib/next/revalidate'
import { isValidAnimeId, normalizeAnimeId } from '@/lib/anime/id'

export const runtime = 'nodejs'

const patchSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(120)
    .refine((v) => v.trim().length > 0, { message: '作品名不能为空' })
    .optional(),
  nextId: z.string().max(64).optional(),
  name_en: z.string().nullable().optional(),
  name_ja: z.string().nullable().optional(),
  cover: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  summary_en: z.string().nullable().optional(),
  summary_ja: z.string().nullable().optional(),
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

function revalidateAnimePaths(id: string) {
  safeRevalidatePath('/anime')
  safeRevalidatePath('/ja/anime')
  safeRevalidatePath('/en/anime')
  safeRevalidatePath(`/anime/${encodeURIComponent(id)}`)
  safeRevalidatePath(`/ja/anime/${encodeURIComponent(id)}`)
  safeRevalidatePath(`/en/anime/${encodeURIComponent(id)}`)
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
    const nextIdRaw = parsed.data.nextId
    const nextId = nextIdRaw === undefined ? undefined : normalizeAnimeId(nextIdRaw)
    if (nextIdRaw !== undefined) {
      if (!nextId) {
        return NextResponse.json({ error: '作品 ID 不能为空' }, { status: 400 })
      }
      if (!isValidAnimeId(nextId)) {
        return NextResponse.json({ error: '作品 ID 仅支持小写英文、数字和连字符（例如 weathering-with-you）' }, { status: 400 })
      }
    }

    if (nextId && nextId !== id) {
      const source = await prisma.anime.findUnique({ where: { id } })
      if (!source) {
        return NextResponse.json({ error: '当前作品不是数据库记录，暂不支持修改 ID' }, { status: 400 })
      }

      const target = await prisma.anime.findUnique({ where: { id: nextId } })
      if (target) {
        return NextResponse.json({ error: '目标作品 ID 已存在' }, { status: 409 })
      }

      const [articleRefs, revisionRefs] = await Promise.all([
        prisma.article.count({ where: { animeIds: { has: id } } }),
        prisma.articleRevision.count({ where: { animeIds: { has: id } } }),
      ])
      if (articleRefs > 0 || revisionRefs > 0) {
        return NextResponse.json(
          { error: `该作品已被 ${articleRefs + revisionRefs} 篇文章/修订引用，无法修改 ID` },
          { status: 400 }
        )
      }

      const renamed = await prisma.$transaction(async (tx) => {
        const created = await tx.anime.create({
          data: {
            id: nextId,
            name: source.name,
            alias: source.alias,
            year: source.year,
            summary: source.summary,
            cover: source.cover,
            hidden: source.hidden,
            name_en: source.name_en,
            name_ja: source.name_ja,
            summary_en: source.summary_en,
            summary_ja: source.summary_ja,
          },
        })
        await tx.anime.delete({ where: { id } })
        return created
      })

      revalidateAnimePaths(id)
      revalidateAnimePaths(nextId)

      return NextResponse.json({ ok: true, anime: renamed })
    }

    const { cover, summary, summary_en, summary_ja, name_en, name_ja, hidden } = parsed.data
    const data: { 
      name?: string
      name_en?: string | null
      name_ja?: string | null
      cover?: string | null
      summary?: string | null
      summary_en?: string | null
      summary_ja?: string | null
      hidden?: boolean 
    } = {}
    if (name !== undefined) data.name = name
    if (name_en !== undefined) data.name_en = name_en == null ? null : name_en.trim() || null
    if (name_ja !== undefined) data.name_ja = name_ja == null ? null : name_ja.trim() || null
    if (cover !== undefined) data.cover = cover
    if (summary !== undefined) data.summary = summary
    if (summary_en !== undefined) data.summary_en = summary_en == null ? null : summary_en.trim() || null
    if (summary_ja !== undefined) data.summary_ja = summary_ja == null ? null : summary_ja.trim() || null
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

    // Anime pages are statically cached (ISR). Revalidate so admin edits
    // reflect immediately without waiting for the periodic revalidate window.
    revalidateAnimePaths(id)

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
