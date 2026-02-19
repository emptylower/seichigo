import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ListPointPoolFilters } from '@/lib/pointPool/repo'
import type { PointPoolApiDeps } from '@/lib/pointPool/api'

function parseBangumiId(raw: string): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null
  return n
}

const upsertBodySchema = z.object({
  pointId: z.string().min(1),
})

const deleteBodySchema = z.object({
  pointId: z.string().min(1),
})

export function createHandlers(deps: PointPoolApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const filters: ListPointPoolFilters = {}
      const url = new URL(req.url)
      const rawBangumiId = url.searchParams.get('bangumiId')

      if (rawBangumiId) {
        const bangumiId = parseBangumiId(rawBangumiId)
        if (bangumiId === null) {
          return NextResponse.json({ error: 'bangumiId 参数错误' }, { status: 400 })
        }
        filters.bangumiId = bangumiId
      }

      const items = await deps.repo.listByUser(session.user.id, filters)
      return NextResponse.json({ ok: true, items })
    },

    async PUT(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const body = await req.json().catch(() => null)
      const parsed = upsertBodySchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const item = await deps.repo.upsert(session.user.id, parsed.data.pointId)
      return NextResponse.json({ ok: true, item })
    },

    async DELETE(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const body = await req.json().catch(() => null)
      const parsed = deleteBodySchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const ok = await deps.repo.delete(session.user.id, parsed.data.pointId)
      if (!ok) {
        return NextResponse.json({ error: '点位不在点位池中' }, { status: 404 })
      }

      return NextResponse.json({ ok: true })
    },
  }
}
