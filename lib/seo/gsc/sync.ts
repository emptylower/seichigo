import { prisma } from '@/lib/db/prisma'
import { createGscClient, fetchSearchAnalytics } from './client'

export async function syncGscData(days: number = 7) {
  const client = await createGscClient()
  const siteUrl = process.env.GSC_SITE_URL || 'sc-domain:seichigo.com'

  // GSC usually lags behind "today"; querying up to yesterday is more reliable.
  const endDate = new Date()
  endDate.setDate(endDate.getDate() - 1)
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - (days - 1))

  const startDateStr = startDate.toISOString().slice(0, 10)
  const endDateStr = endDate.toISOString().slice(0, 10)

  const rows = await fetchSearchAnalytics(client, siteUrl, startDateStr, endDateStr)

  const concurrency = Math.max(1, Number.parseInt(process.env.GSC_SYNC_CONCURRENCY || '10', 10) || 10)

  let synced = 0
  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency)
    await Promise.all(
      chunk.map((row) => {
        const query = row.keys?.[0] || ''
        const page = row.keys?.[1] || ''
        const dateStr = row.keys?.[2] || ''
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

  return synced
}
