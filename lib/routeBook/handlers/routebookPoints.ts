import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import { routeBookErrorResponse } from './errors'

/**
 * 兼容壳：公共巡礼地图（features/map/anitabi/useMapInteractionActions）在调这个接口。
 * - POST { pointId } → 加入未安排区 + 点位池移除
 * - DELETE { pointId } → 删本行程本里该点位的全部条目 + 无其它引用时回点位池
 * - 其它 op（reorder/move）→ 410
 */
const pointIdSchema = z.object({ pointId: z.string().min(1) })

export function createHandlers(deps: RouteBookApiDeps) {
  return {
    async POST(req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId } = (await ctx.params) || {}
      if (!routeBookId) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

      const body = await req.json().catch(() => null)
      const parsed = pointIdSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const item = await deps.repo.createItem(routeBookId, userId, { dayId: null, kind: 'point', pointId: parsed.data.pointId })
        await deps.pointPoolRepo.delete(userId, parsed.data.pointId)
        return NextResponse.json({ ok: true, item })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    async DELETE(req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId } = (await ctx.params) || {}
      if (!routeBookId) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

      const body = await req.json().catch(() => null)
      const parsed = pointIdSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const detail = await deps.repo.getById(routeBookId, userId)
        if (!detail) return NextResponse.json({ error: '行程不存在' }, { status: 404 })

        const matches = detail.items.filter((item) => item.kind === 'point' && item.pointId === parsed.data.pointId)
        for (const item of matches) {
          await deps.repo.deleteItem(routeBookId, userId, item.id)
        }

        const remains = await deps.repo.isPointInAnyRouteBook(userId, parsed.data.pointId)
        if (!remains) {
          await deps.pointPoolRepo.upsert(userId, parsed.data.pointId)
        }
        return NextResponse.json({ ok: true })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    async PATCH(_req: Request, _ctx: { params?: Promise<{ id: string }> }) {
      return NextResponse.json({ error: '接口已升级，请刷新页面' }, { status: 410 })
    },
  }
}
