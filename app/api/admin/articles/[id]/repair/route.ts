import { NextResponse } from 'next/server'

import { getServerAuthSession } from '@/lib/auth/session'
import { PrismaArticleRepo } from '@/lib/article/repoPrisma'
import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'

export const runtime = 'nodejs'

type RepairStage = 'auth' | 'params' | 'load' | 'render' | 'update'

function safeErrorMeta(err: unknown) {
  const anyErr = err as any
  const code = typeof anyErr?.code === 'string' ? anyErr.code : undefined
  const message = typeof anyErr?.message === 'string' ? anyErr.message : String(anyErr)
  return { code, message: message.slice(0, 500) }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let stage: RepairStage = 'auth'
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }
    if (!session.user.isAdmin) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    stage = 'params'
    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

    const url = new URL(req.url)
    const dryRun = url.searchParams.get('dryRun') === '1'

    stage = 'load'
    const repo = new PrismaArticleRepo()
    const article = await repo.findById(id)
    if (!article) return NextResponse.json({ error: '未找到文章' }, { status: 404 })

    stage = 'render'
    const nextHtml = renderArticleContentHtmlFromJson(article.contentJson)

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        id: article.id,
        status: article.status,
        htmlLength: nextHtml.length,
        hasSeichiRouteTag: nextHtml.includes('<seichi-route'),
        hasAssetRefs: nextHtml.includes('/assets/'),
      })
    }

    stage = 'update'
    const updated = await repo.updateDraft(id, { contentHtml: nextHtml })
    if (!updated) return NextResponse.json({ error: '未找到文章' }, { status: 404 })

    return NextResponse.json({ ok: true, id: updated.id, status: updated.status })
  } catch (err) {
    const meta = safeErrorMeta(err)
    console.error('[api/admin/articles/[id]/repair] failed', { stage, ...meta })
    return NextResponse.json({ error: '修复失败', stage, ...meta }, { status: 500 })
  }
}
