import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { isAdminSession } from '@/lib/translation/handlers/common'

const approveBatchSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(1000),
})

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async POST(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const body = await req.json().catch(() => null)
      const parsed = approveBatchSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || '参数错误' },
          { status: 400 }
        )
      }

      const result = await deps.approveMapTranslationTasksBatch(
        deps.prisma,
        parsed.data.taskIds
      )

      return NextResponse.json({
        ok: true,
        total: result.total,
        approved: result.approved,
        skipped: result.skipped,
        failed: result.failed,
        results: result.results,
      })
    },
  }
}
