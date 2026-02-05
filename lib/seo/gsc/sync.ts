import { prisma } from '@/lib/db/prisma'
import { createGscClient, fetchSearchAnalytics } from './client'
import type { GscDimension } from './client'

export type SyncGscDataResult = {
  synced: number
  fetched: number
  dimensions: GscDimension[]
  startDate: string
  endDate: string
}

type RowMapper = (row: { keys: string[] }) => { query: string; page: string; dateStr: string }

export async function syncGscData(days: number = 7): Promise<SyncGscDataResult> {
  const client = await createGscClient()
  const siteUrl = process.env.GSC_SITE_URL || 'sc-domain:seichigo.com'

  // GSC usually lags behind "today"; querying up to yesterday is more reliable.
  const endDate = new Date()
  endDate.setDate(endDate.getDate() - 1)
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - (days - 1))

  const startDateStr = startDate.toISOString().slice(0, 10)
  const endDateStr = endDate.toISOString().slice(0, 10)

  const attempts: Array<{ dimensions: GscDimension[]; map: RowMapper }> = [
    {
      dimensions: ['query', 'page', 'date'],
      map: (row) => ({
        query: row.keys?.[0] || '',
        page: row.keys?.[1] || '',
        dateStr: row.keys?.[2] || '',
      }),
    },
    {
      // When data is sparse, GSC may return no rows at the query+page+date granularity.
      // Fallback to query+date and store it under a synthetic "__all__" page.
      dimensions: ['query', 'date'],
      map: (row) => ({
        query: row.keys?.[0] || '',
        page: '__all__',
        dateStr: row.keys?.[1] || '',
      }),
    },
    {
      // If query dimension is withheld (privacy threshold), use date-only totals so we can
      // still track overall impressions/clicks.
      dimensions: ['date'],
      map: (row) => ({
        query: '__all__',
        page: '__all__',
        dateStr: row.keys?.[0] || '',
      }),
    },
  ]

  let rows: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> = []
  let usedDimensions: GscDimension[] = attempts[0].dimensions
  let mapRow: RowMapper = attempts[0].map

  for (const attempt of attempts) {
    const fetched = await fetchSearchAnalytics(client, siteUrl, startDateStr, endDateStr, attempt.dimensions)
    rows = fetched
    usedDimensions = attempt.dimensions
    mapRow = attempt.map
    if (fetched.length > 0) break
  }

  const concurrency = Math.max(1, Number.parseInt(process.env.GSC_SYNC_CONCURRENCY || '10', 10) || 10)

  let synced = 0
  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency)
    await Promise.all(
      chunk.map((row) => {
        const { query, page, dateStr } = mapRow(row)
        return prisma.seoGscData.upsert({
          where: {
            query_page_date: {
              query,
              page,
              date: new Date(dateStr),
            },
          },
          create: {
            query,
            page,
            date: new Date(dateStr),
            clicks: row.clicks || 0,
            impressions: row.impressions || 0,
            ctr: row.ctr || 0,
            position: row.position || 0,
          },
          update: {
            clicks: row.clicks || 0,
            impressions: row.impressions || 0,
            ctr: row.ctr || 0,
            position: row.position || 0,
          },
        })
      })
    )
    synced += chunk.length
  }

  return {
    synced,
    fetched: rows.length,
    dimensions: usedDimensions,
    startDate: startDateStr,
    endDate: endDateStr,
  }
}
