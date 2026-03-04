import { NextRequest, NextResponse } from 'next/server'
import { getTranslationApiDeps } from '@/lib/translation/api'
import { createHandlers } from '@/lib/translation/handlers/stats'

export async function GET(req: NextRequest) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).GET(req)
  } catch (error) {
    console.error('[api/admin/translations/stats] GET failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
