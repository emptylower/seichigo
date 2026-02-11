import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { fetchTextWithRetry } from '@/lib/anitabi/source/client'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET() {
      const cached = await deps.prisma.anitabiSourceCursor.findUnique({
        where: { sourceName: 'iconsSvg' },
        select: { value: true },
      })

      let svg = String(cached?.value || '').trim()
      if (!svg) {
        svg = (await fetchTextWithRetry(`${deps.getSiteBase()}/api/bangumi/icons.svg`)) || ''
        if (svg) {
          await deps.prisma.anitabiSourceCursor.upsert({
            where: { sourceName: 'iconsSvg' },
            create: { sourceName: 'iconsSvg', value: svg, lastSuccessAt: new Date() },
            update: { value: svg, lastSuccessAt: new Date() },
          })
        }
      }

      if (!svg) {
        return NextResponse.json({ error: 'icons not available' }, { status: 404 })
      }

      return new NextResponse(svg, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        },
      })
    },
  }
}
