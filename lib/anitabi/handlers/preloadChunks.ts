import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { listPreloadChunk } from '@/lib/anitabi/read'
import { clampInt, normalizeLocale } from '@/lib/anitabi/utils'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request, params: { index: string }) {
      const url = new URL(req.url)
      const locale = normalizeLocale(url.searchParams.get('locale'))
      const index = clampInt(params.index, 0, 0, 9999)
      const data = await listPreloadChunk({
        prisma: deps.prisma,
        locale,
        index,
      })

      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
        },
      })
    },
  }
}
