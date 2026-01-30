import { NextResponse } from 'next/server'
import { getProfileApiDeps } from '@/lib/profile/api'
import { createHandlers } from '@/lib/profile/handlers'

function routeError(err: unknown) {
  console.error('[api/me/profile] error:', err)
  return NextResponse.json(
    { error: '服务器错误' },
    { status: 500 }
  )
}

export async function GET(req: Request) {
  try {
    const deps = await getProfileApiDeps()
    const handlers = createHandlers(deps)
    return await handlers.GET(req)
  } catch (err) {
    return routeError(err)
  }
}

export async function PATCH(req: Request) {
  try {
    const deps = await getProfileApiDeps()
    const handlers = createHandlers(deps)
    return await handlers.PATCH(req)
  } catch (err) {
    return routeError(err)
  }
}
