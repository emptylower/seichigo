export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getCreemDeps } from '@/lib/billing/creem/serverDeps'
import { verifyCreemSignature } from '@/lib/billing/creem/signature'
import { handleCreemEvent, parseCreemEvent } from '@/lib/billing/creem/webhookHandler'

/**
 * Creem webhook（设计 §5）：读原始 body → 验签 → 按事件 id 幂等 claim → 状态机。
 * 处理异常也返回 200 并记 error（避免 Creem 无限重试），由对账 cron 兜底。
 */
export async function POST(req: Request) {
  const deps = getCreemDeps()
  if (!deps) return NextResponse.json({ error: 'billing not configured' }, { status: 503 })

  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  let valid = false
  try {
    valid = await verifyCreemSignature(raw, req.headers.get('creem-signature'), deps.config.webhookSecret)
  } catch (err) {
    console.error('[api/billing/creem/webhook] verify failed', err)
    return NextResponse.json({ error: 'signature verification failed' }, { status: 500 })
  }
  if (!valid) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const event = parseCreemEvent(payload)
  if (!event) return NextResponse.json({ error: 'invalid event' }, { status: 400 })

  try {
    const claimResult = await deps.events.claim({ id: event.id, type: event.eventType, payload })
    if (claimResult === 'duplicate') return NextResponse.json({ duplicate: true })

    try {
      await handleCreemEvent(event, { subs: deps.subs, users: deps.users })
      await deps.events.markProcessed(event.id)
    } catch (err) {
      const message = String((err as Error | undefined)?.message ?? err)
      await deps.events.markProcessed(event.id, message)
      console.error('[api/billing/creem/webhook] handle failed', err)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/billing/creem/webhook] failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
