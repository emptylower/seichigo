import { NextResponse } from 'next/server'
import type { WaitlistApiDeps } from '@/lib/waitlist/api'

export function createHandlers(deps: WaitlistApiDeps) {
  return {
    async GET(_req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const existing = await deps.repo.findByUserId(session.user.id)
      return NextResponse.json({ ok: true, joined: Boolean(existing) })
    },

    async POST(_req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }
      const email = String(session.user.email || '').trim()
      if (!email) {
        return NextResponse.json({ error: '无法获取邮箱，请重新登录后重试' }, { status: 400 })
      }

      await deps.repo.upsertForUser(session.user.id, email)
      return NextResponse.json({ ok: true, joined: true })
    },
  }
}
