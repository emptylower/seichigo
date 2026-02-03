import { prisma } from '@/lib/db/prisma'
import { createGscClient, fetchSearchAnalytics } from './client'

export async function syncGscData(days: number = 7) {
  const client = await createGscClient()
  const siteUrl = 'sc-domain:seichigo.com'

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  const startDateStr = startDate.toISOString().slice(0, 10)
  const endDateStr = endDate.toISOString().slice(0, 10)

  const rows = await fetchSearchAnalytics(client, siteUrl, startDateStr, endDateStr)

  let synced = 0
  for (const row of rows) {
    await prisma.seoGscData.upsert({
      where: {
        query_page_date: {
          query: row.keys[0],
          page: row.keys[1],
          date: new Date(row.keys[2]),
        },
      },
      create: {
        query: row.keys[0],
        page: row.keys[1],
        date: new Date(row.keys[2]),
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
    synced++
  }

  return synced
}
