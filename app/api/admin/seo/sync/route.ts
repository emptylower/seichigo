export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { syncGscData } from '@/lib/seo/gsc/sync'

export async function POST(request: Request) {
  const session = await getServerAuthSession()
  
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const url = new URL(request.url)
    const daysParam = url.searchParams.get('days')
    const days = daysParam ? Number.parseInt(daysParam, 10) : 7
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      return NextResponse.json({ error: 'Invalid days' }, { status: 400 })
    }

    const siteUrl = process.env.GSC_SITE_URL || 'sc-domain:seichigo.com'
    const start = Date.now()
    const result = await syncGscData(days)
    return NextResponse.json({ 
      message: `Synced ${result.synced} rows from GSC (last ${days} days, property: ${siteUrl})`,
      count: result.synced,
      fetched: result.fetched,
      days,
      siteUrl,
      startDate: result.startDate,
      endDate: result.endDate,
      dimensions: result.dimensions,
      ms: Date.now() - start,
    })
  } catch (error) {
    console.error('[api/admin/seo/sync] POST failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
