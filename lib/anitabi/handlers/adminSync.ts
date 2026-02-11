import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { runAnitabiSync } from '@/lib/anitabi/sync/workflow'

const schema = z.object({
  mode: z.enum(['full', 'delta', 'dryRun']).default('delta'),
})

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async POST(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const body = await req.json().catch(() => ({}))
      const parsed = schema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const report = await runAnitabiSync(deps, { mode: parsed.data.mode })
      if (report.status === 'failed') {
        return NextResponse.json(report, { status: 502 })
      }
      return NextResponse.json(report)
    },
  }
}
