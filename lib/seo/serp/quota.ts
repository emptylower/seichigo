import { prisma } from '@/lib/db/prisma'

const MONTHLY_LIMIT = 250

export async function checkQuota(): Promise<{ allowed: boolean; used: number; limit: number }> {
  const currentMonth = new Date().toISOString().slice(0, 7) // YYYY-MM
  
  const usage = await prisma.seoApiUsage.findUnique({
    where: {
      provider_date: {
        provider: 'serpapi',
        date: currentMonth
      }
    }
  })
  
  const used = usage?.count || 0
  return {
    allowed: used < MONTHLY_LIMIT,
    used,
    limit: MONTHLY_LIMIT
  }
}

export async function incrementQuota(): Promise<void> {
  const currentMonth = new Date().toISOString().slice(0, 7)
  
  await prisma.seoApiUsage.upsert({
    where: {
      provider_date: {
        provider: 'serpapi',
        date: currentMonth
      }
    },
    create: {
      provider: 'serpapi',
      date: currentMonth,
      count: 1
    },
    update: {
      count: { increment: 1 }
    }
  })
}
