import { NextResponse } from 'next/server'
import { getAdminApiDeps } from '@/lib/admin/api'
import { createHandlers } from '@/lib/admin/handlers/users'

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const deps = await getAdminApiDeps()
    return createHandlers(deps).GET_BY_ID(request, { params })
  } catch (err) {
    console.error('[api/admin/users/[id]] GET failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const deps = await getAdminApiDeps()
    return createHandlers(deps).PATCH_BY_ID(request, { params })
  } catch (err: unknown) {
    console.error('[api/admin/users/[id]] PATCH failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
