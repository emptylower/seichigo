import { NextResponse } from 'next/server'
import { approveRevision } from '@/lib/articleRevision/workflow'
import type { ArticleRevisionApiDeps } from '@/lib/articleRevision/api'
import { getRevisionCityIds, setArticleCityIds } from '@/lib/city/links'
import { resolveCitiesByNames } from '@/lib/city/resolve'

export function createHandlers(deps: ArticleRevisionApiDeps) {
  return {
    async POST(_req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }
      if (!session.user.isAdmin) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const revision = await deps.revisionRepo.findById(id)
      if (!revision) {
        return NextResponse.json({ error: '未找到更新稿' }, { status: 404 })
      }

      const article = await deps.articleRepo.findById(revision.articleId)
      if (!article) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }
      if (article.status !== 'published') {
        return NextResponse.json({ error: '当前文章未发布，无法应用更新' }, { status: 409 })
      }

      const r = approveRevision(
        { status: revision.status, authorId: revision.authorId, rejectReason: revision.rejectReason },
        { userId: session.user.id, isAdmin: true }
      )
      if (!r.ok) {
        return NextResponse.json({ error: r.error.message }, { status: 409 })
      }

      const applied = await deps.articleRepo.updateDraft(article.id, {
        title: revision.title,
        seoTitle: revision.seoTitle,
        description: revision.description,
        animeIds: revision.animeIds,
        city: revision.city,
        routeLength: revision.routeLength,
        tags: revision.tags,
        cover: revision.cover,
        contentJson: revision.contentJson,
        contentHtml: revision.contentHtml,
      })
      if (!applied) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      // Best-effort: keep article city links aligned.
      try {
        const revisionCityIds = await getRevisionCityIds(revision.id)
        if (revisionCityIds.length) {
          await setArticleCityIds(article.id, revisionCityIds)
        } else {
          const rawCity = String(revision.city || '').trim()
          if (rawCity) {
            const resolved = await resolveCitiesByNames([rawCity], { createIfMissing: true })
            const primary = resolved.cities[0] || null
            if (primary) {
              await setArticleCityIds(article.id, [primary.id])
            }
          }
        }
      } catch (err) {
        console.error('[articleRevision/adminApprove] city link sync failed', err)
      }

      await deps.articleRepo.updateState(article.id, { lastApprovedAt: deps.now() })

      const updated = await deps.revisionRepo.updateState(id, { status: 'approved', rejectReason: null })
      if (!updated) {
        return NextResponse.json({ error: '未找到更新稿' }, { status: 404 })
      }

      return NextResponse.json({ ok: true, revision: { id: updated.id, status: updated.status } })
    },
  }
}
