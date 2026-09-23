import { NextResponse } from 'next/server'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import { routeBookErrorResponse } from './errors'
import { placeSchema } from './schemas'

export function createPlaceHandlers(deps: RouteBookApiDeps) {
  return {
    /** POST /api/me/routebooks/[id]/places */
    async POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId } = await ctx.params
      const body = await req.json().catch(() => null)
      const parsed = placeSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const place = await deps.repo.createPlace(routeBookId, userId, parsed.data)
        return NextResponse.json({ ok: true, place })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    /** PATCH /api/me/routebooks/[id]/places/[placeId] */
    async PATCH(req: Request, ctx: { params: Promise<{ id: string; placeId?: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId, placeId } = await ctx.params
      if (!placeId) return NextResponse.json({ error: '缺少 placeId' }, { status: 400 })

      const body = await req.json().catch(() => null)
      const parsed = placeSchema.partial().safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const place = await deps.repo.updatePlace(routeBookId, userId, placeId, parsed.data)
        if (!place) return NextResponse.json({ error: '自定义点不存在' }, { status: 404 })
        return NextResponse.json({ ok: true, place })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    /** DELETE /api/me/routebooks/[id]/places/[placeId] */
    async DELETE(_req: Request, ctx: { params: Promise<{ id: string; placeId?: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId, placeId } = await ctx.params
      if (!placeId) return NextResponse.json({ error: '缺少 placeId' }, { status: 400 })

      try {
        const deleted = await deps.repo.deletePlace(routeBookId, userId, placeId)
        if (!deleted) return NextResponse.json({ error: '自定义点不存在' }, { status: 404 })
        return NextResponse.json({ ok: true })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },
  }
}
