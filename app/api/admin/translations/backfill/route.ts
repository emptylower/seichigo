import { NextRequest, NextResponse } from 'next/server'
import { getTranslationApiDeps } from '@/lib/translation/api'
import { createHandlers } from '@/lib/translation/handlers/backfill'

export async function POST(req: NextRequest) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).POST(req)
  } catch (error) {
    console.error('[api/admin/translations/backfill] POST failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
