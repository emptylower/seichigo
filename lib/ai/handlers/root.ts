import { NextResponse } from 'next/server'
import type { AiApiDeps } from '@/lib/ai/api'

export function createHandlers(deps: AiApiDeps) {
  return {
    async GET(_req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      if (!deps.isAdminEmail(session.user.email)) {
        return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
      }

      return NextResponse.json({
        ok: true,
        baseUrl: '/api/ai',
        endpoints: {
          articles: '/api/ai/articles',
          articleById: '/api/ai/articles/:id',
          submit: '/api/ai/articles/:id/submit',
        },
      })
    },
  }
}
