import { NextRequest, NextResponse } from 'next/server'
import { getArticleRepairApiDeps } from '@/lib/article/adminRepairApi'
import { createHandlers } from '@/lib/article/handlers/adminRepairArticle'

function routeError(error: unknown) {
  return NextResponse.json(
    {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    },
    { status: 500 }
  )
}

export async function POST(req: NextRequest) {
  try {
    const deps = await getArticleRepairApiDeps()
    return createHandlers(deps).POST(req)
  } catch (error) {
    console.error('[api/admin/repair-article] POST failed', error)
    return routeError(error)
  }
}
