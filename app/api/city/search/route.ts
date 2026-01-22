import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { searchCities } from '@/lib/city/search'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const url = new URL(req.url)
  const q = String(url.searchParams.get('q') || '').trim()
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw ? Number(limitRaw) : 12

  const items = await searchCities(q, limit)
  return NextResponse.json({ ok: true, items })
}
