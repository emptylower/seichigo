export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'
import { createHandlers } from '@/lib/anitabi/handlers/spriteManifest'

export async function GET() {
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
    }).GET()
  } catch (err) {
    console.error('[api/anitabi/sprite] GET failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
