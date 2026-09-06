import { NextResponse } from 'next/server'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { getBillingService } from '@/lib/billing/serverDeps'
import { toUsageView } from '@/lib/billing/usageView'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const deps = await getTripPlanApiDeps()
  const session = await deps.getSession()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  try {
    const account = await getBillingService().getAccount(userId)
    if (!account) return NextResponse.json({ error: 'user not found' }, { status: 404 })
    return NextResponse.json(toUsageView(account), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/me/usage] GET failed', err)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
