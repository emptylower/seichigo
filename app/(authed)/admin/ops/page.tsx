import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import AdminOpsUi from './ui'
import type { AdminOpsInitialData, ReportListItem } from './ui'

const LIST_LIMIT = 20

function serializeReportListItem(
  row: {
    id: string
    source: string
    dateKey: string
    triggerMode: string
    status: string
    totalDeployments: number
    totalLogs: number
    severeCount: number
    warningCount: number
    truncated: boolean
    windowStart: Date
    windowEnd: Date
    createdAt: Date
  }
): ReportListItem {
  return {
    id: row.id,
    source: row.source,
    dateKey: row.dateKey,
    triggerMode: row.triggerMode,
    status: row.status,
    totalDeployments: row.totalDeployments,
    totalLogs: row.totalLogs,
    severeCount: row.severeCount,
    warningCount: row.warningCount,
    truncated: row.truncated,
    windowStart: row.windowStart.toISOString(),
    windowEnd: row.windowEnd.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}

export const metadata: Metadata = {
  title: '运维检查 - 管理后台',
  description: '每日运维巡检报告（Vercel 日志）。',
  alternates: { canonical: '/admin/ops' },
}

export default async function AdminOpsPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  let initialData: AdminOpsInitialData | undefined

  try {
    const rows = await prisma.opsReport.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT + 1,
      select: {
        id: true,
        source: true,
        dateKey: true,
        triggerMode: true,
        status: true,
        totalDeployments: true,
        totalLogs: true,
        severeCount: true,
        warningCount: true,
        truncated: true,
        windowStart: true,
        windowEnd: true,
        createdAt: true,
      },
    })

    const hasMore = rows.length > LIST_LIMIT
    const visibleRows = hasMore ? rows.slice(0, LIST_LIMIT) : rows
    const items = visibleRows.map(serializeReportListItem)
    const nextCursor = hasMore ? items[items.length - 1]?.createdAt || null : null

    initialData = {
      items,
      nextCursor,
      selectedId: null,
      detailReport: null,
      detailEvents: [],
    }
  } catch (error) {
    console.error('[admin/ops] preload failed', error)
  }

  return <AdminOpsUi initialData={initialData} />
}
