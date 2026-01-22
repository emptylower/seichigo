import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { normalizeCityAlias } from '@/lib/city/normalize'

export const runtime = 'nodejs'

const schema = z.object({
  alias: z.string().min(1),
  langCode: z.string().nullable().optional(),
  isPrimary: z.boolean().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  const { id: cityId } = await params
  const city = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true } })
  if (!city) return NextResponse.json({ error: '未找到城市' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
  }

  const alias = parsed.data.alias.trim()
  const aliasNorm = normalizeCityAlias(alias)
  if (!aliasNorm) return NextResponse.json({ error: '别名无效' }, { status: 400 })

  try {
    const created = await prisma.cityAlias.create({
      data: {
        cityId,
        alias,
        aliasNorm,
        langCode: parsed.data.langCode == null ? null : parsed.data.langCode.trim() || null,
        isPrimary: Boolean(parsed.data.isPrimary),
      },
    })
    return NextResponse.json({ ok: true, alias: created })
  } catch {
    return NextResponse.json({ error: '别名已存在或创建失败' }, { status: 409 })
  }
}
