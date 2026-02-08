import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { listAdminAnime } from '@/lib/anime/adminList'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  const url = new URL(req.url)
  const q = url.searchParams.get('q') || ''
  const pageRaw = Number.parseInt(url.searchParams.get('page') || '', 10)
  const pageSizeRaw = Number.parseInt(url.searchParams.get('pageSize') || '', 10)
  const page = Number.isFinite(pageRaw) ? pageRaw : 1
  const pageSize = Number.isFinite(pageSizeRaw) ? pageSizeRaw : 36

  const result = await listAdminAnime({ q, page, pageSize })

  return NextResponse.json(
    {
      ok: true,
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.hasMore,
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=120',
      },
    }
  )
}
