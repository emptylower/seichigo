import { NextResponse } from 'next/server'
import { getTranslationApiDeps } from '@/lib/translation/api'
import { createHandlers } from '@/lib/translation/handlers/pendingCount'

export async function GET() {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).GET()
  } catch (error) {
    console.error('[api/admin/translations/pending-count] GET failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
