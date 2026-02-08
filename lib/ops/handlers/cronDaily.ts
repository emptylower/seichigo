import { NextResponse } from 'next/server'
import type { OpsApiDeps } from '@/lib/ops/api'
import { OpsConfigError } from '@/lib/ops/vercelClient'
import { computePreviousUtcDayWindow } from '@/lib/ops/reportWorkflow'

function parseBearerToken(raw: string | null): string | null {
  const text = String(raw || '').trim()
  if (!text) return null
  const match = /^bearer\s+(.+)$/i.exec(text)
  if (!match) return null
  const token = String(match[1] || '').trim()
  return token || null
}

function extractProvidedSecret(req: Request): string | null {
  const auth = parseBearerToken(req.headers.get('authorization'))
  if (auth) return auth

  const header = String(req.headers.get('x-ops-cron-secret') || '').trim()
  if (header) return header

  const url = new URL(req.url)
  const query = String(url.searchParams.get('secret') || '').trim()
  if (query) return query

  return null
}

function mapCronError(error: unknown): NextResponse {
  if (error instanceof OpsConfigError) {
    return NextResponse.json({ error: error.message }, { status: 503 })
  }

  console.error('[ops/cronDaily] handler failed', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export function createHandlers(deps: OpsApiDeps) {
  return {
    async GET(req: Request) {
      const expectedSecret = deps.getCronSecret()
      if (!expectedSecret) {
        return NextResponse.json({ error: 'OPS cron secret is not configured' }, { status: 503 })
      }

      const providedSecret = extractProvidedSecret(req)
      if (!providedSecret || providedSecret !== expectedSecret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { windowStart, windowEnd, dateKey } = computePreviousUtcDayWindow(deps.now())

      const existing = await deps.prisma.opsReport.findFirst({
        where: {
          source: 'vercel',
          triggerMode: 'cron',
          dateKey,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      })

      if (existing) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          dateKey,
          report: {
            reportId: existing.id,
            status: existing.status,
            createdAt: existing.createdAt,
          },
        })
      }

      try {
        const report = await deps.runReport({
          triggerMode: 'cron',
          windowStart,
          windowEnd,
        })

        return NextResponse.json({
          ok: true,
          skipped: false,
          dateKey,
          report,
        })
      } catch (error) {
        return mapCronError(error)
      }
    },
  }
}
