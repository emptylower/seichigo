import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { createRouteGeometryHandler } from '@/lib/routeBook/handlers/routeGeometry'

export const runtime = 'nodejs'

export async function GET(req: Request, _ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
    }

    return await createRouteGeometryHandler().GET(req, session.user.id)
  } catch (err) {
    console.error('[api/me/routebooks/[id]/route-geometry] GET failed', err)
    return NextResponse.json({ ok: false, error: '服务器错误' }, { status: 500 })
  }
}
