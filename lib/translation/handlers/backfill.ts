import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { isAdminSession } from '@/lib/translation/handlers/common'

const backfillSchema = z.object({
  entityType: z.enum(['anitabi_bangumi', 'anitabi_point']),
  targetLanguages: z.array(z.enum(['en', 'ja'])).min(1).optional(),
  mode: z.enum(['missing', 'stale', 'all']).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
  cursor: z.string().optional(),
})

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async POST(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const body = await req.json().catch(() => null)
      const parsed = backfillSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || '参数错误' },
          { status: 400 }
        )
      }

      const result = await deps.enqueueMapTranslationTasksForBackfill({
        prisma: deps.prisma,
        entityType: parsed.data.entityType,
        targetLanguages: parsed.data.targetLanguages || ['en', 'ja'],
        mode: parsed.data.mode || 'all',
        limit: parsed.data.limit ?? 1000,
        cursor: parsed.data.cursor || null,
      })

      return NextResponse.json({
        ok: true,
        scanned: result.scanned,
        enqueued: result.enqueued,
        updated: result.updated,
        nextCursor: result.nextCursor,
        done: result.done,
      })
    },
  }
}
