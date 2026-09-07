export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getBillingService } from '@/lib/billing/serverDeps'
import { getCreemRepos } from '@/lib/billing/creem/serverDeps'

/** 账户页订阅状态（设计 §5）：tier 来自 billing service，其余来自订阅记录；无记录时 status null。 */
export async function GET() {
  try {
    const session = await getServerAuthSession()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 })

    const account = await getBillingService().getAccount(userId)
    if (!account) return NextResponse.json({ error: 'user not found' }, { status: 404 })

    const subscription = await getCreemRepos().subs.findActiveByUser(userId)
    return NextResponse.json(
      {
        tier: account.tier,
        hasSubscription: Boolean(subscription),
        status: subscription?.status ?? null,
        currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/me/billing] GET failed', err)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
