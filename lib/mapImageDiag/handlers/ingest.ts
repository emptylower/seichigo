import { NextResponse } from 'next/server'
import type { MapImageDiagApiDeps } from '@/lib/mapImageDiag/api'
import { ingestMapImageDiagBatch } from '@/lib/mapImageDiag/service'

export function createHandlers(deps: MapImageDiagApiDeps) {
  return {
    async POST(req: Request) {
      try {
        const body = (await req.json().catch(() => null)) as unknown
        const result = await ingestMapImageDiagBatch(deps, body)
        return NextResponse.json({ ok: true, sessionId: result.sessionId, inserted: result.inserted })
      } catch (error) {
        if (error instanceof Error && error.message === 'Unauthorized') {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        if (error instanceof Error && error.name === 'ZodError') {
          return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
        }
        console.error('[map-image-diagnostics] POST failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
  }
}
