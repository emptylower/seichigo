export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { createHandlers } from '@/lib/anitabi/handlers/imageDownload'

function routeError() {
  return NextResponse.json({ error: '服务器错误' }, { status: 500 })
}

export async function GET(req: Request) {
  try {
    const deps = await getAnitabiApiDeps()
    return createHandlers(deps).GET(req)
  } catch (err) {
    console.error('[api/anitabi/image-download] GET failed', err)
    return routeError()
  }
}
