import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { getMeState } from '@/lib/anitabi/me'
import { normalizeLocale } from '@/lib/anitabi/utils'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const url = new URL(req.url)
      const locale = normalizeLocale(url.searchParams.get('locale'))
      const data = await getMeState({ prisma: deps.prisma, userId: session.user.id, locale })

      return NextResponse.json({ ok: true, ...data })
    },
  }
}
