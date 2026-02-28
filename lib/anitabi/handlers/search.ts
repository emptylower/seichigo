import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { searchWithFallback } from '@/lib/anitabi/searchCache'
import { normalizeLocale, normalizeText } from '@/lib/anitabi/utils'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      const url = new URL(req.url)
      const q = normalizeText(url.searchParams.get('q'))
      const locale = normalizeLocale(url.searchParams.get('locale'))
      if (!q) {
        return NextResponse.json({ bangumi: [], points: [], cities: [] })
      }

      const data = await searchWithFallback(deps.prisma, locale, q)
      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
        },
      })
    },
  }
}
