import { NextResponse } from 'next/server'
import type { WaitlistApiDeps } from '@/lib/waitlist/api'

function toItem(e: { userId: string; email: string; createdAt: Date }) {
  return {
    userId: e.userId,
    email: e.email,
    createdAt: e.createdAt.toISOString(),
  }
}

export function createHandlers(deps: WaitlistApiDeps) {
  return {
    async GET(_req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }
      if (!session.user.isAdmin) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      const list = await deps.repo.listAll()
      return NextResponse.json({ ok: true, items: list.map(toItem) })
    },
  }
}
