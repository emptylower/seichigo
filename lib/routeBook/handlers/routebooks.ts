import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import type { RouteBookListFilters, RouteBookStatus, RouteBookUpdateInput } from '@/lib/routeBook/repo'

const statusSchema = z.enum(['draft', 'in_progress', 'completed'])

type QueryInput = {
  status?: string | null
}

function parseStatus(raw: string): RouteBookStatus | null {
  const parsed = statusSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 20) return false
  if (value === null) return true

  const t = typeof value
  if (t === 'string' || t === 'boolean') return true
  if (t === 'number') return Number.isFinite(value)
  if (t !== 'object') return false

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isJsonValue(item, depth + 1)) return false
    }
    return true
  }

  const obj = value as Record<string, unknown>
  for (const k of Object.keys(obj)) {
    if (!isJsonValue(obj[k], depth + 1)) return false
  }
  return true
}

const createBodySchema = z.object({
  title: z.string().min(1).refine((v) => v.trim().length > 0, { message: '标题不能为空' }),
  status: statusSchema.optional(),
})

const patchBodySchema = z
  .object({
    title: z.string().min(1).refine((v) => v.trim().length > 0, { message: '标题不能为空' }).optional(),
    status: statusSchema.optional(),
    metadata: z.unknown().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少需要更新一个字段' })

export function createHandlers(deps: RouteBookApiDeps) {
  return {
    async GET(req: Request, ctx?: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const hasParams = Boolean(ctx?.params)
      if (hasParams) {
        const { id } = (await ctx?.params) || {}
        if (!id) {
          return NextResponse.json({ error: '缺少 id' }, { status: 400 })
        }

        const found = await deps.repo.getById(id, session.user.id)
        if (!found) {
          return NextResponse.json({ error: '未找到路线册' }, { status: 404 })
        }

        return NextResponse.json({ ok: true, item: found })
      }

      const url = new URL(req.url)
      const query: QueryInput = {
        status: url.searchParams.get('status'),
      }

      const filters: RouteBookListFilters = {}
      if (query.status) {
        const status = parseStatus(query.status)
        if (!status) return NextResponse.json({ error: 'status 参数错误' }, { status: 400 })
        filters.status = status
      }

      const items = await deps.repo.listByUser(session.user.id, filters)
      return NextResponse.json({ ok: true, items })
    },

    async POST(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const body = await req.json().catch(() => null)
      const parsed = createBodySchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const title = parsed.data.title.trim()
      const status = parsed.data.status ?? 'draft'

      const created = await deps.repo.create(session.user.id, title, status)
      return NextResponse.json({ ok: true, item: created })
    },

    async PATCH(req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const body = await req.json().catch(() => null)
      const parsed = patchBodySchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const update: RouteBookUpdateInput = {}
      if (parsed.data.title !== undefined) update.title = parsed.data.title.trim()
      if (parsed.data.status !== undefined) update.status = parsed.data.status

      if (parsed.data.metadata !== undefined) {
        if (parsed.data.metadata !== null && !isJsonValue(parsed.data.metadata)) {
          return NextResponse.json({ error: 'metadata 必须是有效的 JSON' }, { status: 400 })
        }
        update.metadata = parsed.data.metadata as RouteBookUpdateInput['metadata']
      }

      const updated = await deps.repo.update(id, session.user.id, update)
      if (!updated) {
        return NextResponse.json({ error: '未找到路线册' }, { status: 404 })
      }

      return NextResponse.json({ ok: true, item: updated })
    },

    async DELETE(_req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const deleted = await deps.repo.delete(id, session.user.id)
      if (!deleted) {
        return NextResponse.json({ error: '未找到路线册' }, { status: 404 })
      }

      return NextResponse.json({ ok: true })
    },
  }
}
