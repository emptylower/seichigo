import { NextResponse } from 'next/server'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { isAdminSession } from '@/lib/translation/handlers/common'

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async GET(_req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: 'Missing task id' }, { status: 400 })
      }

      const detail = await deps.getTranslationTaskDetail(deps.prisma, id)
      if (!detail) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }

      return NextResponse.json(detail)
    },

    async PATCH(req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: 'Missing task id' }, { status: 400 })
      }

      const body = await req.json().catch(() => null)
      const task = await deps.updateTranslationTaskDraft(
        deps.prisma,
        id,
        (body as { draftContent?: unknown } | null)?.draftContent
      )

      return NextResponse.json({ ok: true, task })
    },

    async DELETE(_req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: 'Missing task id' }, { status: 400 })
      }

      await deps.deleteTranslationTask(deps.prisma, id)
      return NextResponse.json({ ok: true })
    },
  }
}
