import { NextRequest, NextResponse } from 'next/server'
import { getTranslationApiDeps } from '@/lib/translation/api'
import { createHandlers } from '@/lib/translation/handlers/tasks'

export async function GET(req: NextRequest) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).GET(req)
  } catch (error) {
    console.error('[api/admin/translations] GET failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).POST(req)
  } catch (error) {
    console.error('[api/admin/translations] POST failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
