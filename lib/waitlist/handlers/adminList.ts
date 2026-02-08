import { NextResponse } from 'next/server'
import type { WaitlistApiDeps } from '@/lib/waitlist/api'

function toItem(e: { userId: string; email: string; createdAt: Date }) {
  return {
    userId: e.userId,
    email: e.email,
    createdAt: e.createdAt.toISOString(),
  }
}

function clampInt(value: string | null, fallback: number, opts?: { min?: number; max?: number }): number {
  const min = opts?.min ?? 1
  const max = opts?.max ?? 100
  const raw = value ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

export function createHandlers(deps: WaitlistApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }
      if (!session.user.isAdmin) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      const { searchParams } = new URL(req.url)
      const page = clampInt(searchParams.get('page'), 1, { min: 1, max: 10_000 })
      const pageSize = clampInt(searchParams.get('pageSize'), 20, { min: 5, max: 100 })
      const q = String(searchParams.get('q') || '').trim()

      const data = await deps.repo.listPage({ page, pageSize, q })
      return NextResponse.json({
        ok: true,
        items: data.items.map(toItem),
        total: data.total,
        page: data.page,
        pageSize: data.pageSize,
      })
    },
  }
}
