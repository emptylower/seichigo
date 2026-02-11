import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { runAnitabiSync } from '@/lib/anitabi/sync/workflow'

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

  const header = String(req.headers.get('x-anitabi-cron-secret') || '').trim()
  if (header) return header

  const url = new URL(req.url)
  const query = String(url.searchParams.get('secret') || '').trim()
  return query || null
}

export function createHandlers(deps: AnitabiApiDeps, mode: 'delta' | 'full') {
  return {
    async GET(req: Request) {
      const expectedSecret = deps.getCronSecret()
      if (!expectedSecret) {
        return NextResponse.json({ error: 'ANITABI cron secret is not configured' }, { status: 503 })
      }

      const providedSecret = extractProvidedSecret(req)
      if (!providedSecret || providedSecret !== expectedSecret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const report = await runAnitabiSync(deps, { mode })
      if (report.status === 'failed') {
        return NextResponse.json(report, { status: 502 })
      }

      return NextResponse.json({ ok: true, report })
    },
  }
}
