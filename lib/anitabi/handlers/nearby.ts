import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { listNearbyPoints } from '@/lib/anitabi/read'
import { clampInt, normalizeLocale, normalizeText } from '@/lib/anitabi/utils'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      const url = new URL(req.url)
      const locale = normalizeLocale(url.searchParams.get('locale'))
      const lat = Number(url.searchParams.get('lat'))
      const lng = Number(url.searchParams.get('lng'))

      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return NextResponse.json({ error: '参数错误' }, { status: 400 })
      }

      const limit = clampInt(url.searchParams.get('limit'), 12, 1, 40)
      const city = normalizeText(url.searchParams.get('city'))
      const q = normalizeText(url.searchParams.get('q'))
      const items = await listNearbyPoints({
        prisma: deps.prisma,
        locale,
        lat,
        lng,
        city,
        q,
        limit,
      })

      return NextResponse.json({ items }, {
        headers: {
          'Cache-Control': 'private, max-age=0, no-store',
        },
      })
    },
  }
}
