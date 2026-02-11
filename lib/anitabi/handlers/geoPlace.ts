import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { fetchJsonWithRetry } from '@/lib/anitabi/source/client'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      const url = new URL(req.url)
      const lng = Number(url.searchParams.get('lng'))
      const lat = Number(url.searchParams.get('lat'))

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return NextResponse.json({ error: '参数错误' }, { status: 400 })
      }

      const endpoint = `${deps.getApiBase()}/geo/place?lng=${encodeURIComponent(String(lng))}&lat=${encodeURIComponent(String(lat))}`
      const data = (await fetchJsonWithRetry<unknown>(endpoint)) ?? null

      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
        },
      })
    },
  }
}
