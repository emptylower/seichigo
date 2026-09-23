import { NextResponse } from 'next/server'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import { routeBookErrorResponse } from './errors'
import { createItemSchema, reorderItemsSchema, updateItemSchema } from './schemas'

type ItemRouteCtx = { params: Promise<{ id: string; itemId?: string }> }

export function createItemHandlers(deps: RouteBookApiDeps) {
  return {
    /** POST /api/me/routebooks/[id]/items — 响应带目标天完整条目（契约 2） */
    async POST(req: Request, ctx: ItemRouteCtx) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId } = await ctx.params
      const body = await req.json().catch(() => null)
      const parsed = createItemSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const created = await deps.repo.createItem(routeBookId, userId, {
          dayId: parsed.data.dayId,
          kind: parsed.data.kind,
          pointId: parsed.data.pointId,
          placeId: parsed.data.placeId,
          title: parsed.data.title,
          note: parsed.data.note,
          timeStart: parsed.data.timeStart,
          index: parsed.data.index,
        })
        if (parsed.data.kind === 'point' && parsed.data.pointId) {
          await deps.pointPoolRepo.delete(userId, parsed.data.pointId)
        }
        return NextResponse.json({
          ok: true,
          item: created.item,
          items: created.items,
          bookUpdatedAt: created.bookUpdatedAt.toISOString(),
        })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    /** POST /api/me/routebooks/[id]/items/reorder — 返回整本全部条目（契约 3） */
    async REORDER(req: Request, ctx: { params: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId } = await ctx.params
      const body = await req.json().catch(() => null)
      const parsed = reorderItemsSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const result = await deps.repo.reorderItems(routeBookId, userId, parsed.data.dayId, parsed.data.orderedItemIds)
        return NextResponse.json({ ok: true, items: result.items, bookUpdatedAt: result.bookUpdatedAt.toISOString() })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    /** PATCH /api/me/routebooks/[id]/items/[itemId] */
    async PATCH(req: Request, ctx: ItemRouteCtx) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId, itemId } = await ctx.params
      if (!itemId) return NextResponse.json({ error: '缺少 itemId' }, { status: 400 })

      const body = await req.json().catch(() => null)
      const parsed = updateItemSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const updated = await deps.repo.updateItem(routeBookId, userId, itemId, parsed.data)
        if (!updated) return NextResponse.json({ error: '条目不存在' }, { status: 404 })
        return NextResponse.json({ ok: true, item: updated, bookUpdatedAt: updated.bookUpdatedAt.toISOString() })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    /** DELETE /api/me/routebooks/[id]/items/[itemId] */
    async DELETE(_req: Request, ctx: ItemRouteCtx) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId, itemId } = await ctx.params
      if (!itemId) return NextResponse.json({ error: '缺少 itemId' }, { status: 400 })

      try {
        const detail = await deps.repo.getById(routeBookId, userId)
        if (!detail) return NextResponse.json({ error: '行程不存在' }, { status: 404 })
        const item = detail.items.find((row) => row.id === itemId)
        if (!item) return NextResponse.json({ error: '条目不存在' }, { status: 404 })

        const deleted = await deps.repo.deleteItem(routeBookId, userId, itemId)
        if (!deleted) return NextResponse.json({ error: '条目不存在' }, { status: 404 })

        if (item.kind === 'point' && item.pointId) {
          const remains = await deps.repo.isPointInAnyRouteBook(userId, item.pointId)
          if (!remains) {
            await deps.pointPoolRepo.upsert(userId, item.pointId)
          }
        }
        return NextResponse.json({ ok: true, bookUpdatedAt: deleted.bookUpdatedAt.toISOString() })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },
  }
}
