export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  const session = await getServerAuthSession()
  
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const [
      pendingArticles,
      publishedArticles,
      animeCount,
      cityCount,
      userCount,
      waitlistCount
    ] = await Promise.all([
      prisma.article.count({ where: { status: 'in_review' } }),
      prisma.article.count({ where: { status: 'published' } }),
      prisma.anime.count({ where: { hidden: false } }),
      prisma.city.count({ where: { hidden: false } }),
      prisma.user.count(),
      prisma.waitlistEntry.count()
    ])

    const stats = {
      pendingArticles,
      publishedArticles,
      animeCount,
      cityCount,
      userCount,
      waitlistCount
    }

    return NextResponse.json({ ok: true, stats })
  } catch (err) {
    console.error('[api/admin/stats] GET failed', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
