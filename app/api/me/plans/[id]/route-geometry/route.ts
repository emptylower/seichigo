import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { createRouteGeometryHandler } from '@/lib/routeBook/handlers/routeGeometry'

export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
    }

    const { id } = await ctx.params
    const deps = await getTripPlanApiDeps()
    const plan = await deps.repo.getPlan(id)
    if (!plan) {
      return NextResponse.json({ ok: false, error: '计划不存在' }, { status: 404 })
    }
    if (plan.userId !== session.user.id) {
      return NextResponse.json({ ok: false, error: '无权访问' }, { status: 403 })
    }

    return await createRouteGeometryHandler().GET(req, session.user.id)
  } catch (err) {
    console.error('[api/me/plans/[id]/route-geometry] GET failed', err)
    return NextResponse.json({ ok: false, error: '服务器错误' }, { status: 500 })
  }
}
