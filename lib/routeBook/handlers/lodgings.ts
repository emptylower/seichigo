import { NextResponse } from 'next/server'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import { routeBookErrorResponse } from './errors'
import { lodgingBaseSchema, lodgingSchema } from './schemas'

export function createLodgingHandlers(deps: RouteBookApiDeps) {
  return {
    /** POST /api/me/routebooks/[id]/lodgings */
    async POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId } = await ctx.params
      const body = await req.json().catch(() => null)
      const parsed = lodgingSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const lodging = await deps.repo.createLodging(routeBookId, userId, parsed.data)
        return NextResponse.json({ ok: true, lodging })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    /** PATCH /api/me/routebooks/[id]/lodgings/[lodgingId] */
    async PATCH(req: Request, ctx: { params: Promise<{ id: string; lodgingId?: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId, lodgingId } = await ctx.params
      if (!lodgingId) return NextResponse.json({ error: '缺少 lodgingId' }, { status: 400 })

      const body = await req.json().catch(() => null)
      const parsed = lodgingBaseSchema.partial().safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const lodging = await deps.repo.updateLodging(routeBookId, userId, lodgingId, parsed.data)
        if (!lodging) return NextResponse.json({ error: '住宿不存在' }, { status: 404 })
        return NextResponse.json({ ok: true, lodging })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    /** DELETE /api/me/routebooks/[id]/lodgings/[lodgingId] */
    async DELETE(_req: Request, ctx: { params: Promise<{ id: string; lodgingId?: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId, lodgingId } = await ctx.params
      if (!lodgingId) return NextResponse.json({ error: '缺少 lodgingId' }, { status: 400 })

      try {
        const deleted = await deps.repo.deleteLodging(routeBookId, userId, lodgingId)
        if (!deleted) return NextResponse.json({ error: '住宿不存在' }, { status: 404 })
        return NextResponse.json({ ok: true })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },
  }
}
