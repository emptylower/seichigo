export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getCreemDeps } from '@/lib/billing/creem/serverDeps'
import { getSiteOrigin } from '@/lib/seo/site'

/** F11：同一用户并发/连击结账的去重窗口 */
const CHECKOUT_DEDUP_MS = 60_000

/**
 * 创建 Creem 结账（设计 §5）：request_id = "<userId>:<uuid>"，metadata 携带 userId 与 tier。
 * F5：success_url 用站点权威地址（SITE_URL），不信任请求 origin；
 * F11：结账前以 checkout.requested 事件做 60 秒去重；nit：409 只对 active/trialing 生效。
 */
export async function POST(req: Request) {
  try {
    const session = await getServerAuthSession()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 })

    const deps = getCreemDeps()
    if (!deps) return NextResponse.json({ error: 'billing not configured' }, { status: 503 })

    const active = await deps.subs.findActiveByUser(userId)
    if (active && (active.status === 'active' || active.status === 'trialing')) {
      return NextResponse.json({ code: 'already_subscribed' }, { status: 409 })
    }

    const email = session.user.email
    if (!email) return NextResponse.json({ error: 'account email missing' }, { status: 400 })

    const recent = await deps.events.findRecentByType('checkout.requested', userId, CHECKOUT_DEDUP_MS)
    if (recent) return NextResponse.json({ code: 'checkout_in_progress' }, { status: 429 })

    const uuid = crypto.randomUUID()
    const dedupEventId = `checkout_request:${uuid}`
    await deps.events.claim({ id: dedupEventId, type: 'checkout.requested', payload: { userId } })
    await deps.events.markProcessed(dedupEventId)

    const checkout = await deps.client.createCheckout({
      productId: deps.config.productStandardId,
      requestId: `${userId}:${uuid}`,
      successUrl: `${getSiteOrigin()}/me?billing=success`,
      customerEmail: email,
      metadata: { userId, tier: 'standard' },
    })
    return NextResponse.json({ checkoutUrl: checkout.checkoutUrl })
  } catch (err) {
    console.error('[api/me/billing/checkout] POST failed', err)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
