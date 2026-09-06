export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getCreemDeps } from '@/lib/billing/creem/serverDeps'

/** Creem 客户门户链接（设计 §5）：登录且有有效订阅才可进入。 */
export async function POST() {
  try {
    const session = await getServerAuthSession()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 })

    const deps = getCreemDeps()
    if (!deps) return NextResponse.json({ error: 'billing not configured' }, { status: 503 })

    const subscription = await deps.subs.findActiveByUser(userId)
    if (!subscription) return NextResponse.json({ error: 'no subscription' }, { status: 404 })

    const portal = await deps.client.createBillingPortal(subscription.creemCustomerId)
    return NextResponse.json({ portalUrl: portal.portalUrl })
  } catch (err) {
    console.error('[api/me/billing/portal] POST failed', err)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
