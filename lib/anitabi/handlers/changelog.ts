import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { listChangelog } from '@/lib/anitabi/read'
import { clampInt } from '@/lib/anitabi/utils'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      const url = new URL(req.url)
      const take = clampInt(url.searchParams.get('take'), 80, 1, 500)
      const rows = await listChangelog(deps.prisma, take)

      return NextResponse.json({ ok: true, items: rows }, {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
        },
      })
    },
  }
}
