export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { syncGscData } from '@/lib/seo/gsc/sync'
import { createGscClient, fetchSearchAnalytics } from '@/lib/seo/gsc/client'

export async function POST(request: Request) {
  const session = await getServerAuthSession()
  
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const url = new URL(request.url)
    const daysParam = url.searchParams.get('days')
    const debug = url.searchParams.get('debug') === '1'
    const days = daysParam ? Number.parseInt(daysParam, 10) : 7
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      return NextResponse.json({ error: 'Invalid days' }, { status: 400 })
    }

    const siteUrl = process.env.GSC_SITE_URL || 'sc-domain:seichigo.com'
    const start = Date.now()
    const result = await syncGscData(days)
    const payload: Record<string, unknown> = {
      message: `Synced ${result.synced} rows from GSC (last ${days} days, property: ${siteUrl})`,
      count: result.synced,
      fetched: result.fetched,
      days,
      siteUrl,
      startDate: result.startDate,
      endDate: result.endDate,
      dimensions: result.dimensions,
      ms: Date.now() - start,
    }

    if (debug) {
      try {
        const client = await createGscClient()
        const sites = await client.sites.list()
        const entry = (sites.data.siteEntry || []).find((s) => s.siteUrl === siteUrl)
        const dateRows = await fetchSearchAnalytics(client, siteUrl, result.startDate, result.endDate, ['date'])
        payload.debug = {
          hasSiteAccess: Boolean(entry),
          permissionLevel: entry?.permissionLevel || null,
          dateRows: dateRows.length,
        }
      } catch (err) {
        payload.debug = {
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('[api/admin/seo/sync] POST failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
