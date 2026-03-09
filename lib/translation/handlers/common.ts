import { NextResponse } from 'next/server'

export function isAdminSession(session: unknown): boolean {
  const user = (session as { user?: { isAdmin?: unknown } } | null)?.user
  return Boolean(user?.isAdmin)
}

export function routeError(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json({ error: 'Database schema not migrated' }, { status: 503 })
  }

  const message = String((error as { message?: unknown } | null)?.message || '')
  if (message.includes('Environment variable not found') && message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
