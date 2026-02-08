import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpsApiDeps } from '@/lib/ops/api'
import { OpsConfigError } from '@/lib/ops/vercelClient'
import { OpsUserInputError } from '@/lib/ops/reportWorkflow'

const manualRunSchema = z
  .object({
    windowStart: z.string().optional().nullable(),
    windowEnd: z.string().optional().nullable(),
  })
  .optional()

function isAdminSession(session: unknown): boolean {
  const user = (session as any)?.user
  return Boolean(user?.isAdmin)
}

function parseLimit(input: string | null): number {
  const raw = Number(input)
  if (!Number.isFinite(raw)) return 20
  return Math.max(1, Math.min(100, Math.floor(raw)))
}

function parseCursorDate(input: string | null): Date | null {
  const text = String(input || '').trim()
  if (!text) return null
  const date = new Date(text)
  if (!Number.isFinite(date.getTime())) return null
  return date
}

function parseWindow(body: z.infer<typeof manualRunSchema>, now: Date): { windowStart: Date; windowEnd: Date } {
  const startRaw = body?.windowStart ? String(body.windowStart).trim() : ''
  const endRaw = body?.windowEnd ? String(body.windowEnd).trim() : ''

  if (!startRaw && !endRaw) {
    const windowEnd = new Date(now)
    const windowStart = new Date(now)
    windowStart.setUTCHours(windowStart.getUTCHours() - 24)
    return { windowStart, windowEnd }
  }

  if (!startRaw || !endRaw) {
    throw new OpsUserInputError('windowStart and windowEnd must be provided together')
  }

  const windowStart = new Date(startRaw)
  const windowEnd = new Date(endRaw)

  if (!Number.isFinite(windowStart.getTime()) || !Number.isFinite(windowEnd.getTime())) {
    throw new OpsUserInputError('Invalid windowStart/windowEnd')
  }

  if (windowStart.getTime() >= windowEnd.getTime()) {
    throw new OpsUserInputError('windowStart must be earlier than windowEnd')
  }

  return { windowStart, windowEnd }
}

function mapReportError(error: unknown): NextResponse {
  if (error instanceof OpsConfigError) {
    return NextResponse.json({ error: error.message }, { status: 503 })
  }

  if (error instanceof OpsUserInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  console.error('[ops/reports] handler failed', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export function createHandlers(deps: OpsApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const url = new URL(req.url)
      const limit = parseLimit(url.searchParams.get('limit'))
      const cursor = parseCursorDate(url.searchParams.get('cursor'))

      const rows = await deps.prisma.opsReport.findMany({
        where: cursor ? { createdAt: { lt: cursor } } : undefined,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
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

      const hasMore = rows.length > limit
      const items = hasMore ? rows.slice(0, limit) : rows
      const nextCursor = hasMore ? items[items.length - 1]?.createdAt.toISOString() : null

      return NextResponse.json({ ok: true, items, nextCursor })
    },

    async POST(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      try {
        const body = (await req.json().catch(() => null)) as unknown
        const parsed = manualRunSchema.parse(body)
        const { windowStart, windowEnd } = parseWindow(parsed, deps.now())

        const report = await deps.runReport({
          triggerMode: 'manual',
          windowStart,
          windowEnd,
        })

        return NextResponse.json({ ok: true, report })
      } catch (error) {
        return mapReportError(error)
      }
    },

    async GET_BY_ID(_req: Request, ctx: { params: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id } = await ctx.params
      const reportId = String(id || '').trim()
      if (!reportId) {
        return NextResponse.json({ error: 'Missing report id' }, { status: 400 })
      }

      const report = await deps.prisma.opsReport.findUnique({
        where: { id: reportId },
        include: {
          events: {
            orderBy: [{ severity: 'asc' }, { timestamp: 'desc' }, { createdAt: 'desc' }],
          },
        },
      })

      if (!report) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 })
      }

      return NextResponse.json({ ok: true, report, events: report.events })
    },
  }
}
