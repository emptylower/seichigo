import { NextResponse } from 'next/server'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { isAdminSession } from '@/lib/translation/handlers/common'

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async POST(_req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: 'Missing task id' }, { status: 400 })
      }

      try {
        const result = await deps.translateTranslationTaskById(deps.prisma, id)
        return NextResponse.json({ ok: true, status: result.status })
      } catch (error) {
        const status = (error as { status?: number } | null)?.status
        if (status === 404 || status === 400) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Translation failed' },
            { status }
          )
        }
        throw error
      }
    },
  }
}
