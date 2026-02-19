import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import { SortedZoneLimitError, type RouteBookZone } from '@/lib/routeBook/repo'

const zoneSchema = z.enum(['unsorted', 'sorted'])

const addBodySchema = z.object({
  pointId: z.string().min(1),
  zone: zoneSchema.optional(),
})

const deleteBodySchema = z.object({
  pointId: z.string().min(1),
})

const reorderBodySchema = z.object({
  pointIds: z.array(z.string().min(1)),
})

const moveBodySchema = z.object({
  pointId: z.string().min(1),
  zone: zoneSchema,
})

function getErrorMessage(err: unknown): string {
  return String((err as { message?: unknown } | null)?.message || '')
}

function parseZone(raw: string | undefined): RouteBookZone {
  const parsed = zoneSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'unsorted'
}

export function createHandlers(deps: RouteBookApiDeps) {
  return {
    async POST(req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const { id: routeBookId } = (await ctx.params) || {}
      if (!routeBookId) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const body = await req.json().catch(() => null)
      const parsed = addBodySchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const zone = parseZone(parsed.data.zone)

      try {
        const created = await deps.repo.addPoint(routeBookId, session.user.id, parsed.data.pointId, zone)
        return NextResponse.json({ ok: true, item: created })
      } catch (err) {
        if (err instanceof SortedZoneLimitError) {
          return NextResponse.json({ error: `已排序点位已达上限（${err.limit}）` }, { status: 400 })
        }
        const msg = getErrorMessage(err)
        if (msg.includes('RouteBook not found')) {
          return NextResponse.json({ error: '未找到路线册' }, { status: 404 })
        }
        throw err
      }
    },

    async DELETE(req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const { id: routeBookId } = (await ctx.params) || {}
      if (!routeBookId) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const body = await req.json().catch(() => null)
      const parsed = deleteBodySchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      try {
        const ok = await deps.repo.removePoint(routeBookId, session.user.id, parsed.data.pointId)
        if (!ok) {
          return NextResponse.json({ error: '点位不存在' }, { status: 404 })
        }
        return NextResponse.json({ ok: true })
      } catch (err) {
        const msg = getErrorMessage(err)
        if (msg.includes('RouteBook not found')) {
          return NextResponse.json({ error: '未找到路线册' }, { status: 404 })
        }
        throw err
      }
    },

    async PATCH(req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const { id: routeBookId } = (await ctx.params) || {}
      if (!routeBookId) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: '参数错误' }, { status: 400 })
      }

      const record = body as Record<string, unknown>
      const op = typeof record.op === 'string' ? record.op : ''

      try {
        if (op === 'move' || ('pointId' in record && 'zone' in record)) {
          const parsed = moveBodySchema.safeParse(record)
          if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
          }

          const updated = await deps.repo.movePointToZone(routeBookId, session.user.id, parsed.data.pointId, parsed.data.zone)
          if (!updated) {
            return NextResponse.json({ error: '点位不存在' }, { status: 404 })
          }
          return NextResponse.json({ ok: true, item: updated })
        }

        if (op === 'reorder' || 'pointIds' in record) {
          const parsed = reorderBodySchema.safeParse(record)
          if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
          }

          const items = await deps.repo.reorderPoints(routeBookId, session.user.id, parsed.data.pointIds)
          return NextResponse.json({ ok: true, items })
        }

        return NextResponse.json({ error: '参数错误' }, { status: 400 })
      } catch (err) {
        if (err instanceof SortedZoneLimitError) {
          return NextResponse.json({ error: `已排序点位已达上限（${err.limit}）` }, { status: 400 })
        }
        const msg = getErrorMessage(err)
        if (msg.includes('RouteBook not found')) {
          return NextResponse.json({ error: '未找到路线册' }, { status: 404 })
        }
        throw err
      }
    },
  }
}
