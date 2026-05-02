export const runtime = 'nodejs'

import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { createRenderProxyHandlers } from '@/lib/anitabi/handlers/imageDownload'

function routeError() {
  return NextResponse.json({ error: '服务器错误' }, { status: 500 })
}

export async function GET(req: Request) {
  try {
    const deps = await getAnitabiApiDeps()
    try {
      const cf = await getCloudflareContext({ async: true })
      return createRenderProxyHandlers({
        ...deps,
        env: cf.env as typeof deps.env,
        ctx: cf.ctx as typeof deps.ctx,
      }).GET(req)
    } catch {
      return createRenderProxyHandlers(deps).GET(req)
    }
  } catch (err) {
    console.error('[api/anitabi/image-render] GET failed', err)
    return routeError()
  }
}
