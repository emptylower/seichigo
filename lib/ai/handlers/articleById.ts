import { NextResponse } from 'next/server'
import type { AiApiDeps } from '@/lib/ai/api'
import { renderRichTextEmbeds } from '@/lib/richtext/embeds'

function toDetail(a: any, sanitizeHtml: (html: string) => string) {
  const sanitized = sanitizeHtml(String(a.contentHtml || ''))
  const rendered = renderRichTextEmbeds(sanitized, a.contentJson)
  return {
    id: a.id,
    authorId: a.authorId,
    slug: a.slug,
    language: a.language ?? 'zh',
    translationGroupId: a.translationGroupId ?? null,
    title: a.title,
    seoTitle: a.seoTitle ?? null,
    description: a.description ?? null,
    animeIds: a.animeIds,
    city: a.city,
    routeLength: a.routeLength,
    tags: a.tags,
    cover: a.cover ?? null,
    contentJson: a.contentJson,
    contentHtml: rendered,
    status: a.status,
    rejectReason: a.rejectReason,
    needsRevision: a.needsRevision,
    publishedAt: a.publishedAt,
    lastApprovedAt: a.lastApprovedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

export function createHandlers(deps: AiApiDeps) {
  return {
    async GET(_req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const isAdmin = deps.isAdminEmail(session.user.email)
      if (!isAdmin) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const found = await deps.repo.findById(id)
      if (!found) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      const article = toDetail(found, deps.sanitizeHtml)
      return NextResponse.json({ ok: true, article })
    },
  }
}
