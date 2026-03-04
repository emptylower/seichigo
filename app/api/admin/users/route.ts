import { NextResponse } from 'next/server'
import { getAdminApiDeps } from '@/lib/admin/api'
import { createHandlers } from '@/lib/admin/handlers/users'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const deps = await getAdminApiDeps()
    return createHandlers(deps).GET_LIST(request)
  } catch (err) {
    console.error('[api/admin/users] GET failed', err)
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    )
  }
}
