import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { getBootstrap } from '@/lib/anitabi/read'
import { normalizeLocale, parseTab, parseUserLocation } from '@/lib/anitabi/utils'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      const url = new URL(req.url)
      const locale = normalizeLocale(url.searchParams.get('locale'))
      const tab = parseTab(url.searchParams.get('tab'))
      const city = url.searchParams.get('city')
      const q = url.searchParams.get('q')
      const userLocation = parseUserLocation(url.searchParams)

      const data = await getBootstrap({
        prisma: deps.prisma,
        locale,
        tab,
        city,
        q,
        userLocation,
      })

      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600',
        },
      })
    },
  }
}
