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
        return NextResponse.json(
          await deps.approveTranslationTask(deps.prisma, id)
        )
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
