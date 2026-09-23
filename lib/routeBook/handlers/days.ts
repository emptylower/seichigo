import { NextResponse } from 'next/server'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import { routeBookErrorResponse } from './errors'
import { insertDaySchema, reorderDaysSchema, updateDaySchema } from './schemas'

export function createDayHandlers(deps: RouteBookApiDeps) {
  return {
    /** POST /api/me/routebooks/[id]/days */
    async POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId } = await ctx.params
      const body = await req.json().catch(() => null)
      const parsed = insertDaySchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const day = await deps.repo.insertDay(routeBookId, userId, parsed.data.afterDayIndex)
        return NextResponse.json({ ok: true, day, bookUpdatedAt: day.bookUpdatedAt.toISOString() })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    /** POST /api/me/routebooks/[id]/days/reorder */
    async REORDER(req: Request, ctx: { params: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId } = await ctx.params
      const body = await req.json().catch(() => null)
      const parsed = reorderDaysSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const result = await deps.repo.reorderDays(routeBookId, userId, parsed.data.orderedDayIds)
        return NextResponse.json({ ok: true, days: result.days, bookUpdatedAt: result.bookUpdatedAt.toISOString() })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    /** PATCH /api/me/routebooks/[id]/days/[dayId] */
    async PATCH(req: Request, ctx: { params: Promise<{ id: string; dayId?: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId, dayId } = await ctx.params
      if (!dayId) return NextResponse.json({ error: '缺少 dayId' }, { status: 400 })

      const body = await req.json().catch(() => null)
      const parsed = updateDaySchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const day = await deps.repo.updateDay(routeBookId, userId, dayId, parsed.data)
        if (!day) return NextResponse.json({ error: '天不存在' }, { status: 404 })
        return NextResponse.json({ ok: true, day, bookUpdatedAt: day.bookUpdatedAt.toISOString() })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    /** DELETE /api/me/routebooks/[id]/days/[dayId] */
    async DELETE(_req: Request, ctx: { params: Promise<{ id: string; dayId?: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId, dayId } = await ctx.params
      if (!dayId) return NextResponse.json({ error: '缺少 dayId' }, { status: 400 })

      try {
        const deleted = await deps.repo.deleteDay(routeBookId, userId, dayId)
        if (!deleted) return NextResponse.json({ error: '天不存在' }, { status: 404 })
        return NextResponse.json({ ok: true, bookUpdatedAt: deleted.bookUpdatedAt.toISOString() })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },
  }
}
