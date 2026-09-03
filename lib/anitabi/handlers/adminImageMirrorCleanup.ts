import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { cleanupObsoleteMirrorState } from '@/lib/anitabi/mirror/cleanup'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async POST() {
      const session = await deps.getSession()
      if (!session?.user?.isAdmin) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }

      const result = await cleanupObsoleteMirrorState(deps.prisma)
      return NextResponse.json({ ok: true, ...result })
    },
  }
}
