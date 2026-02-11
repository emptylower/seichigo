import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { clampInt } from '@/lib/anitabi/utils'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const url = new URL(req.url)
      const take = clampInt(url.searchParams.get('take'), 50, 1, 200)
      const rows = await deps.prisma.anitabiSyncRun.findMany({
        orderBy: { createdAt: 'desc' },
        take,
      })

      return NextResponse.json({ ok: true, items: rows })
    },
  }
}
