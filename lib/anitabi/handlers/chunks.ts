import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { listChunk } from '@/lib/anitabi/read'
import { clampInt, normalizeLocale, parseTab } from '@/lib/anitabi/utils'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request, params: { index: string }) {
      const url = new URL(req.url)
      const locale = normalizeLocale(url.searchParams.get('locale'))
      const tab = parseTab(url.searchParams.get('tab'))
      const index = clampInt(params.index, 0, 0, 999)
      const size = clampInt(url.searchParams.get('size'), 100, 20, 200)

      const cards = await listChunk({
        prisma: deps.prisma,
        locale,
        tab,
        index,
        size,
      })

      return NextResponse.json({ ok: true, index, size, items: cards }, {
        headers: {
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600',
        },
      })
    },
  }
}
