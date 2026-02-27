import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { getActiveDatasetVersion, listAllBangumiCards } from '@/lib/anitabi/read'
import { normalizeLocale, parseTab } from '@/lib/anitabi/utils'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      const url = new URL(req.url)
      const locale = normalizeLocale(url.searchParams.get('locale'))
      const tab = parseTab(url.searchParams.get('tab'))

      if (tab === 'nearby') {
        return NextResponse.json(
          { error: 'Nearby tab not supported for bulk loading' },
          { status: 400 },
        )
      }

      const [cards, datasetVersion] = await Promise.all([
        listAllBangumiCards({ prisma: deps.prisma, locale, tab }),
        getActiveDatasetVersion(deps.prisma),
      ])

      return NextResponse.json(
        { datasetVersion, items: cards, total: cards.length },
        {
          status: 200,
          headers: {
            'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
          },
        },
      )
    },
  }
}
