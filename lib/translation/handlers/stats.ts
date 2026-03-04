import { NextResponse } from 'next/server'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { isAdminSession } from '@/lib/translation/handlers/common'

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { searchParams } = new URL(req.url)
      const filter = deps.parseTranslationTaskStatsFilter({
        entityType: searchParams.get('entityType'),
        targetLanguage: searchParams.get('targetLanguage'),
      })

      const counts = await deps.getTranslationTaskStatsForAdmin(filter)
      return NextResponse.json({ ok: true, counts })
    },
  }
}
