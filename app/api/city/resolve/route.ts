import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { resolveCitiesByNames } from '@/lib/city/resolve'

export const runtime = 'nodejs'

const schema = z.object({
  names: z.array(z.string()).default([]),
})

export async function POST(req: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }

  const { cities, createdCityIds } = await resolveCitiesByNames(parsed.data.names, { createIfMissing: true })
  return NextResponse.json({
    ok: true,
    cities: cities.map((c) => ({ id: c.id, slug: c.slug, name_zh: c.name_zh, name_en: c.name_en, name_ja: c.name_ja })),
    createdCityIds,
  })
}
