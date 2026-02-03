import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import SeoUi from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'SEO 工具 - 管理后台',
  description: 'SEO 关键词排名与 Google Search Console 数据管理。',
}

export default async function SeoPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  const keywords = await prisma.seoKeyword.findMany({
    where: { isActive: true },
    include: {
      rankHistory: {
        orderBy: { checkedAt: 'desc' },
        take: 1
      }
    },
    orderBy: { priority: 'desc' }
  })

  const topQueries = await prisma.seoGscData.groupBy({
    by: ['query'],
    _sum: { clicks: true, impressions: true },
    orderBy: { _sum: { clicks: 'desc' } },
    take: 10
  })

  const currentMonth = new Date().toISOString().slice(0, 7)
  const serpUsage = await prisma.seoApiUsage.findUnique({
    where: {
      provider_date: {
        provider: 'serpapi',
        date: currentMonth
      }
    }
  })

  return <SeoUi keywords={keywords} topQueries={topQueries} serpUsage={serpUsage} />
}
