import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { isAdminSession } from '@/lib/translation/handlers/common'

const executeByIdsSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(200),
  concurrency: z.number().int().min(1).max(12).optional(),
})

const executeByFilterSchema = z.object({
  entityType: z
    .enum(['article', 'city', 'anime', 'anitabi_bangumi', 'anitabi_point'])
    .optional(),
  targetLanguage: z.enum(['zh', 'en', 'ja']).optional(),
  q: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  includeFailed: z.boolean().optional(),
  statusScope: z.enum(['pending', 'failed', 'pending_or_failed']).optional(),
  concurrency: z.number().int().min(1).max(12).optional(),
})

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async POST(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const body = await req.json().catch(() => null)
      let input: Parameters<typeof deps.executeTranslationTasks>[1]

      if (body && typeof body === 'object' && Array.isArray((body as any).taskIds)) {
        const parsed = executeByIdsSchema.safeParse(body)
        if (!parsed.success) {
          return NextResponse.json(
            { error: parsed.error.issues[0]?.message || '参数错误' },
            { status: 400 }
          )
        }
        input = {
          taskIds: parsed.data.taskIds,
          concurrency: deps.parseExecutionConcurrency(parsed.data.concurrency),
        }
      } else {
        const parsed = executeByFilterSchema.safeParse(body || {})
        if (!parsed.success) {
          return NextResponse.json(
            { error: parsed.error.issues[0]?.message || '参数错误' },
            { status: 400 }
          )
        }
        input = {
          entityType: parsed.data.entityType,
          targetLanguage: parsed.data.targetLanguage,
          q: parsed.data.q,
          limit: parsed.data.limit,
          includeFailed: parsed.data.includeFailed,
          statusScope: parsed.data.statusScope,
          concurrency: deps.parseExecutionConcurrency(parsed.data.concurrency),
        }
      }

      const result = await deps.executeTranslationTasks(deps.prisma, input)
      return NextResponse.json({
        ok: true,
        reclaimedProcessing: result.reclaimedProcessing,
        total: result.total,
        processed: result.processed,
        success: result.success,
        failed: result.failed,
        skipped: result.skipped,
        results: result.results,
      })
    },
  }
}
