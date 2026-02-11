import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { getBangumiDetail } from '@/lib/anitabi/read'
import { normalizeLocale } from '@/lib/anitabi/utils'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request, params: { id: string }) {
      const id = Number(params.id)
      if (!Number.isFinite(id)) {
        return NextResponse.json({ error: '参数错误' }, { status: 400 })
      }

      const url = new URL(req.url)
      const locale = normalizeLocale(url.searchParams.get('locale'))

      const data = await getBangumiDetail({ prisma: deps.prisma, id, locale })
      if (!data) {
        return NextResponse.json({ error: '作品不存在' }, { status: 404 })
      }

      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      })
    },
  }
}
