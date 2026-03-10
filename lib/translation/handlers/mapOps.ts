import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { runMapOps } from '@/lib/translation/mapOps'
import { isAdminSession } from '@/lib/translation/handlers/common'

const mapOpsSchema = z.object({
  action: z.enum([
    'backfill_once',
    'incremental_refill',
    'execute_round',
    'manual_advance',
    'approve_all_ready',
    'approve_sample',
    'advance_one_key',
  ]),
  targetLanguage: z.enum(['all', 'en', 'ja']).default('all'),
  entityType: z.enum(['anitabi_bangumi', 'anitabi_point']).optional(),
  mode: z.enum(['missing', 'stale', 'all']).optional(),
  statusScope: z.enum(['pending', 'failed', 'pending_or_failed']).optional(),
  limitPerType: z.number().int().min(1).max(200).optional(),
  concurrency: z.number().int().min(1).max(12).optional(),
  maxRounds: z.number().int().min(1).max(1000).optional(),
  sampleSize: z.number().int().min(1).max(300).optional(),
  q: z.string().max(200).optional(),
  continuation: z
    .object({
      bangumiBackfillCursor: z.string().nullable().optional(),
      pointBackfillCursor: z.string().nullable().optional(),
      processed: z.number().int().min(0).optional(),
      success: z.number().int().min(0).optional(),
      failed: z.number().int().min(0).optional(),
      reclaimed: z.number().int().min(0).optional(),
      skipped: z.number().int().min(0).optional(),
      errors: z.array(z.string()).optional(),
      bangumiBackfilledTotal: z.number().int().min(0).optional(),
      pointBackfilledEnqueued: z.number().int().min(0).optional(),
      pointBackfilledUpdated: z.number().int().min(0).optional(),
      bangumiBatch: z.number().int().min(0).optional(),
      approved: z.number().int().min(0).optional(),
      approvalFailed: z.number().int().min(0).optional(),
      baselineEstimatedTotal: z.number().int().min(0).optional(),
      stagnationCount: z.number().int().min(0).optional(),
    })
    .nullable()
    .optional(),
})

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async POST(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const body = await req.json().catch(() => null)
      const parsed = mapOpsSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || '参数错误' },
          { status: 400 }
        )
      }

      return NextResponse.json(
        await runMapOps(deps.prisma, parsed.data)
      )
    },
  }
}
