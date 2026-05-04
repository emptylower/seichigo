export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'
import { createRenderProxyHandlers } from '@/lib/anitabi/handlers/imageDownload'

function routeError() {
  return NextResponse.json({ error: '服务器错误' }, { status: 500 })
}

export async function GET(req: Request) {
  try {
    const deps = await getAnitabiApiDeps()
    const bindings = getCfBindings()
    if (bindings?.env || bindings?.ctx) {
      return createRenderProxyHandlers({
        ...deps,
        env: (bindings.env ?? deps.env) as typeof deps.env,
        ctx: (bindings.ctx ?? deps.ctx) as typeof deps.ctx,
      }).GET(req)
    }
    return createRenderProxyHandlers(deps).GET(req)
  } catch (err) {
    console.error('[api/anitabi/image-render] GET failed', err)
    return routeError()
  }
}
