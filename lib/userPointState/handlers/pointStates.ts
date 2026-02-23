import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { UserPointStateApiDeps } from '@/lib/userPointState/api'
import type { ListByUserFilters, UpsertUserPointStateOpts, UserPointStateValue } from '@/lib/userPointState/repo'
import { resolveUserPointStates } from '@/lib/userPointState/stateResolver'

const stateSchema = z.enum(['want_to_go', 'planned', 'checked_in'])

type QueryInput = {
  state?: string | null
  bangumiId?: string | null
}

function parseBangumiId(raw: string): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null
  return n
}

function parseState(raw: string): UserPointStateValue | null {
  const parsed = stateSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

const upsertBodySchema = z.object({
  pointId: z.string().min(1),
  state: stateSchema,
  checkedInAt: z.string().datetime().nullable().optional(),
  gpsVerified: z.boolean().optional(),
  photoUrl: z.string().min(1).nullable().optional(),
})

const deleteBodySchema = z.object({
  pointId: z.string().min(1),
})

export function createHandlers(deps: UserPointStateApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const url = new URL(req.url)
      const query: QueryInput = {
        state: url.searchParams.get('state'),
        bangumiId: url.searchParams.get('bangumiId'),
      }

      const filters: ListByUserFilters = {}

      if (query.state) {
        const state = parseState(query.state)
        if (!state) return NextResponse.json({ error: 'state 参数错误' }, { status: 400 })
        filters.state = state
      }

      if (query.bangumiId) {
        const bangumiId = parseBangumiId(query.bangumiId)
        if (bangumiId === null) return NextResponse.json({ error: 'bangumiId 参数错误' }, { status: 400 })
        filters.bangumiId = bangumiId
      }

      const items = await resolveUserPointStates(
        {
          pointStateRepo: deps.repo,
          pointPoolRepo: deps.pointPoolRepo,
          routeBookRepo: deps.routeBookRepo,
        },
        session.user.id,
        filters
      )
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

      const { pointId, state } = parsed.data
      if (state !== 'checked_in') {
        return NextResponse.json({ error: '仅支持更新已打卡状态' }, { status: 400 })
      }

      const opts: UpsertUserPointStateOpts = {}

      if (parsed.data.checkedInAt !== undefined) {
        opts.checkedInAt = parsed.data.checkedInAt === null ? null : new Date(parsed.data.checkedInAt)
      }
      if (parsed.data.gpsVerified !== undefined) {
        opts.gpsVerified = parsed.data.gpsVerified
      }
      if (parsed.data.photoUrl !== undefined) {
        opts.photoUrl = parsed.data.photoUrl
      }

      if (state === 'checked_in' && opts.checkedInAt === undefined) {
        const prev = await deps.repo.getByUserAndPoint(session.user.id, pointId)
        if (!prev || prev.state !== 'checked_in') {
          opts.checkedInAt = deps.now()
        }
      }

      const saved = await deps.repo.upsert(session.user.id, pointId, state, opts)
      await deps.pointPoolRepo.delete(session.user.id, pointId)
      return NextResponse.json({ ok: true, item: saved })
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
        return NextResponse.json({ error: '未找到标记' }, { status: 404 })
      }

      return NextResponse.json({ ok: true })
    },
  }
}
