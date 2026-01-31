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
  const language = url.searchParams.get('language') || 'zh'

  const items = await searchCities(q, limit)
  
  // Add convenience 'name' field based on language
  const localized = items.map(city => ({
    ...city,
    name: language === 'en' ? (city.name_en || city.name_zh) :
          language === 'ja' ? (city.name_ja || city.name_zh) :
          city.name_zh
  }))
  
  return NextResponse.json({ ok: true, items: localized })
}
