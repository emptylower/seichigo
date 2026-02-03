export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { syncGscData } from '@/lib/seo/gsc/sync'

export async function POST() {
  const session = await getServerAuthSession()
  
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const count = await syncGscData(7)
    return NextResponse.json({ 
      message: `Synced ${count} rows from GSC`, 
      count 
    })
  } catch (error) {
    console.error('[api/admin/seo/sync] POST failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
