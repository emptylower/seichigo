import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

function normalizeFilter(input: string | null): string | null {
  const v = String(input || '').trim()
  if (!v || v === 'all') return null
  return v
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const entityType = normalizeFilter(searchParams.get('entityType'))
    const targetLanguage = normalizeFilter(searchParams.get('targetLanguage'))

    const where: any = {}
    if (entityType) where.entityType = entityType
    if (targetLanguage) where.targetLanguage = targetLanguage

    const rows = await prisma.translationTask.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    })

    const counts: Record<string, number> = {}
    for (const r of rows) {
      counts[String(r.status)] = Number((r as any)?._count?._all || 0)
    }

    return NextResponse.json({ ok: true, counts })
  } catch (error) {
    console.error('[api/admin/translations/stats] GET failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

