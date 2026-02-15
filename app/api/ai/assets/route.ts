import { NextResponse } from 'next/server'
import { getAiApiDeps } from '@/lib/ai/api'
import { createHandlers } from '@/lib/ai/handlers/assets'
import { PrismaAssetRepo } from '@/lib/asset/repoPrisma'

export const runtime = 'nodejs'

const repo = new PrismaAssetRepo()

function routeError(err: unknown) {
  const code = (err as any)?.code
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json({ error: '数据库结构未更新,请先执行迁移(prisma migrate deploy)后重试' }, { status: 503 })
  }
  const msg = String((err as any)?.message || '')
  if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }
  return NextResponse.json({ error: '服务器错误' }, { status: 500 })
}

export async function POST(req: Request) {
  try {
    const deps = await getAiApiDeps()
    return createHandlers({ ...deps, assetRepo: repo }).POST(req)
  } catch (err) {
    console.error('[api/ai/assets] POST failed', err)
    return routeError(err)
  }
}
