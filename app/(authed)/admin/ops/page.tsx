import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import AdminOpsUi from './ui'
import type { AdminOpsInitialData, OpsLogEvent, ReportDetail, ReportListItem } from './ui'

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

function serializeOpsEvent(
  row: {
    id: string
    severity: string
    fingerprint: string
    timestamp: Date | null
    deploymentId: string | null
    requestId: string | null
    path: string | null
    method: string | null
    statusCode: number | null
    message: string
    raw: unknown
    createdAt: Date
  }
): OpsLogEvent {
  return {
    id: row.id,
    severity: row.severity,
    fingerprint: row.fingerprint,
    timestamp: row.timestamp ? row.timestamp.toISOString() : null,
    deploymentId: row.deploymentId,
    requestId: row.requestId,
    path: row.path,
    method: row.method,
    statusCode: row.statusCode,
    message: row.message,
    raw: row.raw,
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

    let detailReport: ReportDetail | null = null
    let detailEvents: OpsLogEvent[] = []

    const initialSelectedId = items[0]?.id || null
    if (initialSelectedId) {
      const report = await prisma.opsReport.findUnique({
        where: { id: initialSelectedId },
        include: {
          events: {
            orderBy: [{ severity: 'asc' }, { timestamp: 'desc' }, { createdAt: 'desc' }],
          },
        },
      })

      if (report) {
        detailReport = {
          id: report.id,
          source: report.source,
          dateKey: report.dateKey,
          triggerMode: report.triggerMode,
          status: report.status,
          totalDeployments: report.totalDeployments,
          totalLogs: report.totalLogs,
          severeCount: report.severeCount,
          warningCount: report.warningCount,
          truncated: report.truncated,
          windowStart: report.windowStart.toISOString(),
          windowEnd: report.windowEnd.toISOString(),
          createdAt: report.createdAt.toISOString(),
          markdownSummary: report.markdownSummary,
          rawSummary: report.rawSummary,
        }
        detailEvents = report.events.map(serializeOpsEvent)
      }
    }

    initialData = {
      items,
      nextCursor,
      selectedId: detailReport?.id || null,
      detailReport,
      detailEvents,
    }
  } catch (error) {
    console.error('[admin/ops] preload failed', error)
  }

  return <AdminOpsUi initialData={initialData} />
}
