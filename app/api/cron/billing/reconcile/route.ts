export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getCreemDeps } from '@/lib/billing/creem/serverDeps'
import { runBillingReconcile } from '@/lib/billing/creem/reconcile'

/** 与 /api/cron/ops/daily 相同的 secret 校验（Authorization / x-ops-cron-secret / query）。 */
function parseBearerToken(raw: string | null): string | null {
  const text = String(raw || '').trim()
  if (!text) return null
  const match = /^bearer\s+(.+)$/i.exec(text)
  const token = match ? String(match[1] || '').trim() : ''
  return token || null
}

function extractProvidedSecret(req: Request): string | null {
  const auth = parseBearerToken(req.headers.get('authorization'))
  if (auth) return auth
  const header = String(req.headers.get('x-ops-cron-secret') || '').trim()
  if (header) return header
  const query = String(new URL(req.url).searchParams.get('secret') || '').trim()
  return query || null
}

export async function GET(req: Request) {
  const expectedSecret = String(process.env.OPS_CRON_SECRET || process.env.CRON_SECRET || '').trim()
  if (!expectedSecret) return NextResponse.json({ error: 'billing cron secret is not configured' }, { status: 503 })

  const providedSecret = extractProvidedSecret(req)
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const deps = getCreemDeps()
  if (!deps) return NextResponse.json({ error: 'billing not configured' }, { status: 503 })

  try {
    const result = await runBillingReconcile({ client: deps.client, subs: deps.subs, users: deps.users })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[api/cron/billing/reconcile] GET failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
