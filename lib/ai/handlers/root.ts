import { NextResponse } from 'next/server'
import type { AiApiDeps } from '@/lib/ai/api'
import { authorizeAiRequest } from '@/lib/ai/auth'

export function createHandlers(deps: AiApiDeps) {
  return {
    async GET(req: Request) {
      const auth = await authorizeAiRequest(req, deps)
      if (!auth.ok) {
        const status = auth.reason === 'forbidden' ? 403 : 401
        const error = auth.reason === 'forbidden' ? 'Forbidden: Admin access required' : 'Unauthorized'
        return NextResponse.json({ error }, { status })
      }

      return NextResponse.json({
        ok: true,
        baseUrl: '/api/ai',
        endpoints: {
          articles: '/api/ai/articles',
          articleById: '/api/ai/articles/:id',
          import: '/api/ai/articles/:id/import',
          submit: '/api/ai/articles/:id/submit',
        },
      })
    },
  }
}
