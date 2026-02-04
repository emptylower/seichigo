export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getServerAuthSession } from '@/lib/auth/session'
import { backfillArticleCityLinks } from '@/lib/city/backfillArticleCityLinks'

type Body = {
  dryRun?: boolean
  createMissingCity?: boolean
  limit?: number
  cursor?: string | null
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => null)) as Body | null
    const dryRun = Boolean(body?.dryRun)
    const createMissingCity = Boolean(body?.createMissingCity)
    const limit = typeof body?.limit === 'number' ? body?.limit : undefined
    const cursor = typeof body?.cursor === 'string' ? body?.cursor : body?.cursor == null ? null : String(body?.cursor)

    const result = await backfillArticleCityLinks({
      dryRun,
      createMissingCity,
      limit,
      cursor,
    })

    if (!dryRun && result.processed > 0) {
      // Best-effort cache invalidation for city hubs.
      revalidatePath('/')
      revalidatePath('/en')
      revalidatePath('/ja')
      revalidatePath('/city')
      revalidatePath('/en/city')
      revalidatePath('/ja/city')
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[api/admin/maintenance/backfill-article-cities] POST failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
