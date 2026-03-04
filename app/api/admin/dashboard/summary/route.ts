import { NextResponse } from 'next/server'
import { getAdminApiDeps } from '@/lib/admin/api'
import { createHandlers } from '@/lib/admin/handlers/dashboardSummary'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const deps = await getAdminApiDeps()
    return createHandlers(deps).GET()
  } catch (err) {
    console.error('[api/admin/dashboard/summary] GET failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
