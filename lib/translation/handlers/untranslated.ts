import { NextResponse } from 'next/server'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { isAdminSession } from '@/lib/translation/handlers/common'

function clampInt(
  value: string | null,
  fallback: number,
  opts?: { min?: number; max?: number }
): number {
  const min = opts?.min ?? 1
  const max = opts?.max ?? 100
  const raw = value ? Number.parseInt(value, 10) : Number.NaN
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { searchParams } = new URL(req.url)
      const result = await deps.listUntranslatedItemsForAdmin(deps.prisma, {
        entityType: deps.parseAdminTranslationEntityType(
          searchParams.get('entityType')
        ),
        q: searchParams.get('q'),
        page: clampInt(searchParams.get('page'), 1, { min: 1, max: 10_000 }),
        pageSize: clampInt(searchParams.get('pageSize'), 30, {
          min: 5,
          max: 100,
        }),
      })

      return NextResponse.json(result)
    },
  }
}
