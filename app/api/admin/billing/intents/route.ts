export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getCreemRepos } from '@/lib/billing/creem/serverDeps'
import { isCheckoutEnabled } from '@/lib/billing/checkoutGate'

/** F4（2026-09-07 Part F）：付费意向统计，供管理面板漏斗观察 */
export async function GET() {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const stats = await getCreemRepos().intents.stats(new Date())
    return NextResponse.json({ stats, checkoutEnabled: isCheckoutEnabled() })
  } catch (err) {
    console.error('[api/admin/billing/intents] GET failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
