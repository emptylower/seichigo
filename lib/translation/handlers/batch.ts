import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { isAdminSession } from '@/lib/translation/handlers/common'

const batchSchema = z.object({
  entityType: z.enum([
    'article',
    'city',
    'anime',
    'anitabi_bangumi',
    'anitabi_point',
  ]),
  targetLanguages: z.array(z.enum(['en', 'ja'])).min(1),
})

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async POST(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const body = await req.json().catch(() => null)
      const parsed = batchSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || '参数错误' },
          { status: 400 }
        )
      }

      const result = await deps.createTranslationTasksFromCoverage(deps.prisma, {
        entityType: parsed.data.entityType,
        targetLanguages: Array.from(new Set(parsed.data.targetLanguages)),
      })

      return NextResponse.json({
        ok: true,
        created: result.created,
        skipped: result.skipped,
        entities: result.entities,
      })
    },
  }
}
