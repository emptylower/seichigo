import { NextResponse } from 'next/server'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { isAdminSession } from '@/lib/translation/handlers/common'

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async POST(req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!isAdminSession(session) || !session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: 'Missing task id' }, { status: 400 })
      }

      const body = await req.json().catch(() => null)
      const historyId = (body as { historyId?: unknown } | null)?.historyId
      if (typeof historyId !== 'string' || !historyId.trim()) {
        return NextResponse.json({ error: 'Invalid historyId' }, { status: 400 })
      }

      try {
        await deps.rollbackTranslationTask(deps.prisma, {
          id,
          historyId,
          adminUserId: session.user.id,
        })
        return NextResponse.json({ ok: true })
      } catch (error) {
        if (deps.isTranslationHttpError(error)) {
          return NextResponse.json(
            { error: error.message },
            { status: error.status }
          )
        }
        throw error
      }
    },
  }
}
