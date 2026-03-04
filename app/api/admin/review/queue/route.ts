import { NextResponse } from 'next/server'
import { getAdminApiDeps } from '@/lib/admin/api'
import { createHandlers } from '@/lib/admin/handlers/reviewQueue'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const deps = await getAdminApiDeps()
    return createHandlers(deps).GET(req)
  } catch (err) {
    console.error('[api/admin/review/queue] GET failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
