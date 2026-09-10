export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'
import { createHandlers } from '@/lib/anitabi/handlers/spriteSheet'

export async function GET(req: Request) {
  try {
    const deps = await getAnitabiApiDeps()
    const bindings = getCfBindings()
    return createHandlers({
      ...deps,
      ...(bindings?.env || bindings?.ctx
        ? {
            env: (bindings.env ?? deps.env) as typeof deps.env,
            ctx: (bindings.ctx ?? deps.ctx) as typeof deps.ctx,
          }
        : {}),
    }).GET(req)
  } catch (err) {
    console.error('[api/anitabi/sprite/sheet] GET failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
