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

function dedupeStrings(input: unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const value = String(item || '').trim()
    if (!value) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function replaceAnimeId(animeIds: string[], fromId: string, toId: string): string[] {
  const next = animeIds.map((x) => (x === fromId ? toId : x))
  return dedupeStrings(next)
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
      const sourceSnapshot = {
        name: String(source?.name || current.name || id),
        alias: dedupeStrings(Array.isArray(source?.alias) ? source.alias : (current.alias || [])),
        year: source?.year ?? current.year ?? null,
        summary: source?.summary ?? current.summary ?? null,
        cover: source?.cover ?? current.cover ?? null,
        hidden: source?.hidden ?? current.hidden ?? false,
        name_en: source?.name_en ?? current.name_en ?? null,
        name_ja: source?.name_ja ?? current.name_ja ?? null,
        summary_en: source?.summary_en ?? current.summary_en ?? null,
        summary_ja: source?.summary_ja ?? current.summary_ja ?? null,
      }

      const renamed = await prisma.$transaction(async (tx) => {
        const target = await tx.anime.findUnique({ where: { id: nextId } })

        let nextAnime
        if (!target) {
          nextAnime = await tx.anime.create({
            data: {
              id: nextId,
              name: name ?? sourceSnapshot.name,
              alias: dedupeStrings([...sourceSnapshot.alias, id]),
              year: sourceSnapshot.year,
              summary: sourceSnapshot.summary,
              cover: sourceSnapshot.cover,
              hidden: false,
              name_en: sourceSnapshot.name_en,
              name_ja: sourceSnapshot.name_ja,
              summary_en: sourceSnapshot.summary_en,
              summary_ja: sourceSnapshot.summary_ja,
            },
          })
        } else {
          const updateData: Record<string, unknown> = {
            hidden: false,
            alias: dedupeStrings([...(target.alias || []), ...sourceSnapshot.alias, id]),
          }
          if (name) updateData.name = name
          if (target.year == null && sourceSnapshot.year != null) updateData.year = sourceSnapshot.year
          if (!target.cover && sourceSnapshot.cover) updateData.cover = sourceSnapshot.cover
          if (!target.summary && sourceSnapshot.summary) updateData.summary = sourceSnapshot.summary
          if (!target.name_en && sourceSnapshot.name_en) updateData.name_en = sourceSnapshot.name_en
          if (!target.name_ja && sourceSnapshot.name_ja) updateData.name_ja = sourceSnapshot.name_ja
          if (!target.summary_en && sourceSnapshot.summary_en) updateData.summary_en = sourceSnapshot.summary_en
          if (!target.summary_ja && sourceSnapshot.summary_ja) updateData.summary_ja = sourceSnapshot.summary_ja
          nextAnime = await tx.anime.update({
            where: { id: nextId },
            data: updateData,
          })
        }

        const articleRefs = await tx.article.findMany({
          where: { animeIds: { has: id } },
          select: { id: true, animeIds: true },
        })
        for (const row of articleRefs) {
          const nextAnimeIds = replaceAnimeId(row.animeIds || [], id, nextId)
          if (nextAnimeIds.join('\u0000') === (row.animeIds || []).join('\u0000')) continue
          await tx.article.update({
            where: { id: row.id },
            data: { animeIds: nextAnimeIds },
          })
        }

        const revisionRefs = await tx.articleRevision.findMany({
          where: { animeIds: { has: id } },
          select: { id: true, animeIds: true },
        })
        for (const row of revisionRefs) {
          const nextAnimeIds = replaceAnimeId(row.animeIds || [], id, nextId)
          if (nextAnimeIds.join('\u0000') === (row.animeIds || []).join('\u0000')) continue
          await tx.articleRevision.update({
            where: { id: row.id },
            data: { animeIds: nextAnimeIds },
          })
        }

        await tx.anime.upsert({
          where: { id },
          create: {
            id,
            name: sourceSnapshot.name,
            alias: dedupeStrings([...sourceSnapshot.alias, nextId]),
            year: sourceSnapshot.year,
            summary: sourceSnapshot.summary,
            cover: sourceSnapshot.cover,
            hidden: true,
            name_en: sourceSnapshot.name_en,
            name_ja: sourceSnapshot.name_ja,
            summary_en: sourceSnapshot.summary_en,
            summary_ja: sourceSnapshot.summary_ja,
          },
          update: {
            hidden: true,
            alias: dedupeStrings([...sourceSnapshot.alias, nextId]),
          },
        })

        return nextAnime
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
