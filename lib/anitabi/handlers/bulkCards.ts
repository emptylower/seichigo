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
          { error: 'nearby tab is not supported for bulk cards' },
          { status: 400 },
        )
      }

      const [datasetVersion, { items, total }] = await Promise.all([
        getActiveDatasetVersion(deps.prisma),
        listAllBangumiCards({
          prisma: deps.prisma,
          locale,
          tab,
          city: url.searchParams.get('city'),
          q: url.searchParams.get('q'),
        }),
      ])

      return NextResponse.json(
        { datasetVersion, items, total },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
          },
        },
      )
    },
  }
}
