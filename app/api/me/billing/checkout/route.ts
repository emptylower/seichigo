export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getCreemDeps } from '@/lib/billing/creem/serverDeps'

/** 创建 Creem 结账（设计 §5）：request_id = "<userId>:<uuid>"，metadata 携带 userId 与 tier。 */
export async function POST(req: Request) {
  try {
    const session = await getServerAuthSession()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 })

    const deps = getCreemDeps()
    if (!deps) return NextResponse.json({ error: 'billing not configured' }, { status: 503 })

    const active = await deps.subs.findActiveByUser(userId)
    if (active) return NextResponse.json({ code: 'already_subscribed' }, { status: 409 })

    const email = session.user.email
    if (!email) return NextResponse.json({ error: 'account email missing' }, { status: 400 })

    const origin = new URL(req.url).origin
    const checkout = await deps.client.createCheckout({
      productId: deps.config.productStandardId,
      requestId: `${userId}:${crypto.randomUUID()}`,
      successUrl: `${origin}/me?billing=success`,
      customerEmail: email,
      metadata: { userId, tier: 'standard' },
    })
    return NextResponse.json({ checkoutUrl: checkout.checkoutUrl })
  } catch (err) {
    console.error('[api/me/billing/checkout] POST failed', err)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
