import { NextRequest } from 'next/server'
import { getTranslationApiDeps } from '@/lib/translation/api'
import { routeError } from '@/lib/translation/handlers/common'
import { createHandlers } from '@/lib/translation/handlers/taskById'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).GET(req, ctx)
  } catch (error) {
    console.error('[api/admin/translations/[id]] GET failed', error)
    return routeError(error)
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).PATCH(req, ctx)
  } catch (error) {
    console.error('[api/admin/translations/[id]] PATCH failed', error)
    return routeError(error)
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).DELETE(req, ctx)
  } catch (error) {
    console.error('[api/admin/translations/[id]] DELETE failed', error)
    return routeError(error)
  }
}
