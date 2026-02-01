import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export const runtime = 'nodejs'

const patchSchema = z.object({
  name_zh: z.string().min(1).optional(),
  name_en: z.string().nullable().optional(),
  name_ja: z.string().nullable().optional(),
  description_zh: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  description_ja: z.string().nullable().optional(),
  transportTips_zh: z.string().nullable().optional(),
  transportTips_en: z.string().nullable().optional(),
  transportTips_ja: z.string().nullable().optional(),
  cover: z.string().nullable().optional(),
  needsReview: z.boolean().optional(),
  hidden: z.boolean().optional(),
})

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  const { id } = await params
  const city = await prisma.city.findUnique({
    where: { id },
    include: { aliases: { orderBy: [{ isPrimary: 'desc' }, { alias: 'asc' }] } },
  })
  if (!city) {
    return NextResponse.json({ error: '未找到' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, city })
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

  const current = await prisma.city.findUnique({ where: { id }, select: { id: true } })
  if (!current) {
    return NextResponse.json({ error: '未找到' }, { status: 404 })
  }

  const updated = await prisma.city.update({
    where: { id },
    data: {
      name_zh: parsed.data.name_zh?.trim() ?? undefined,
      name_en: parsed.data.name_en === undefined ? undefined : (parsed.data.name_en == null ? null : parsed.data.name_en.trim() || null),
      name_ja: parsed.data.name_ja === undefined ? undefined : (parsed.data.name_ja == null ? null : parsed.data.name_ja.trim() || null),
      description_zh: parsed.data.description_zh === undefined ? undefined : (parsed.data.description_zh == null ? null : parsed.data.description_zh.trim() || null),
      description_en: parsed.data.description_en === undefined ? undefined : (parsed.data.description_en == null ? null : parsed.data.description_en.trim() || null),
      description_ja: parsed.data.description_ja === undefined ? undefined : (parsed.data.description_ja == null ? null : parsed.data.description_ja.trim() || null),
      transportTips_zh: parsed.data.transportTips_zh === undefined ? undefined : (parsed.data.transportTips_zh == null ? null : parsed.data.transportTips_zh.trim() || null),
      transportTips_en: parsed.data.transportTips_en === undefined ? undefined : (parsed.data.transportTips_en == null ? null : parsed.data.transportTips_en.trim() || null),
      transportTips_ja: parsed.data.transportTips_ja === undefined ? undefined : (parsed.data.transportTips_ja == null ? null : parsed.data.transportTips_ja.trim() || null),
      cover: parsed.data.cover === undefined ? undefined : (parsed.data.cover == null ? null : parsed.data.cover.trim() || null),
      needsReview: parsed.data.needsReview === undefined ? undefined : Boolean(parsed.data.needsReview),
      hidden: parsed.data.hidden === undefined ? undefined : Boolean(parsed.data.hidden),
    },
    include: { aliases: { orderBy: [{ isPrimary: 'desc' }, { alias: 'asc' }] } },
  })

  // City pages are statically cached (ISR). Revalidate so admin edits (e.g. cover upload)
  // reflect immediately without waiting for the periodic revalidate window.
  revalidatePath('/city')
  revalidatePath('/en/city')
  revalidatePath(`/city/${encodeURIComponent(updated.slug)}`)
  revalidatePath(`/en/city/${encodeURIComponent(updated.slug)}`)

  return NextResponse.json({ ok: true, city: updated })
}
