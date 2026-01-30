import type { CommentApiDeps } from '../api'

type CommentAuthor = {
  id: string
}

type CommentListItem = {
  id: string
  articleId: string | null
  mdxSlug: string | null
  authorId: string
  parentId: string | null
  content: string
  contentHtml: string
  createdAt: Date
  likeCount: number
  author: CommentAuthor
  replies: CommentListItem[]
}

export function createHandlers(deps: CommentApiDeps) {
  const { repo, renderMarkdown } = deps

  return {
    async list(params: { articleId?: string; mdxSlug?: string }) {
      try {
        const articleId = params.articleId
        const mdxSlug = params.mdxSlug

        if (!articleId && !mdxSlug) {
          return { ok: false as const, error: '缺少目标参数' }
        }

        const comments = await repo.findByTarget({ articleId, mdxSlug })
        const likeCounts = await Promise.all(comments.map((c) => repo.getLikeCount(c.id)))

        const byId = new Map<string, CommentListItem>()
        for (let i = 0; i < comments.length; i++) {
          const c = comments[i]
          const item: CommentListItem = {
            id: c.id,
            articleId: c.articleId,
            mdxSlug: c.mdxSlug,
            authorId: c.authorId,
            parentId: c.parentId,
            content: c.content,
            contentHtml: c.contentHtml,
            createdAt: c.createdAt,
            likeCount: likeCounts[i] ?? 0,
            author: { id: c.authorId },
            replies: [],
          }
          byId.set(c.id, item)
        }

        const roots: CommentListItem[] = []

        for (const item of byId.values()) {
          if (!item.parentId) {
            roots.push(item)
            continue
          }

          const parent = byId.get(item.parentId)
          if (!parent) {
            // Orphan reply: keep visible as top-level.
            roots.push(item)
            continue
          }

          if (parent.parentId) {
            // Flatten accidental deeper nesting to 2 levels: attach to root parent if possible.
            const rootParent = byId.get(parent.parentId)
            if (rootParent) {
              rootParent.replies.push(item)
            } else {
              roots.push(item)
            }
            continue
          }

          parent.replies.push(item)
        }

        return { ok: true as const, comments: roots }
      } catch (err) {
        console.error('[comment handler]', err)
        return { ok: false as const, error: '服务器错误' }
      }
    },

    async create(
      session: any,
      data: {
        articleId?: string | null
        mdxSlug?: string | null
        parentId?: string | null
        content: string
      }
    ) {
      try {
        if (!session?.user?.id) {
          return { ok: false as const, error: '请先登录' }
        }

        if (!data.content || data.content.trim().length === 0) {
          return { ok: false as const, error: '评论内容不能为空' }
        }

        const articleId = data.articleId ? data.articleId.trim() : null
        const mdxSlug = data.mdxSlug ? data.mdxSlug.trim() : null
        const hasArticle = !!articleId
        const hasMdx = !!mdxSlug
        if ((hasArticle && hasMdx) || (!hasArticle && !hasMdx)) {
          return { ok: false as const, error: '目标参数错误' }
        }

        const parentId = data.parentId ? data.parentId.trim() : null
        if (parentId) {
          const parent = await repo.findById(parentId)
          if (!parent) {
            return { ok: false as const, error: '父评论不存在' }
          }
          if (parent.parentId) {
            return { ok: false as const, error: '不支持多级回复' }
          }

          // Validate reply target matches parent comment.
          if (parent.articleId) {
            if (!articleId || parent.articleId !== articleId) {
              return { ok: false as const, error: '目标参数错误' }
            }
          } else if (parent.mdxSlug) {
            if (!mdxSlug || parent.mdxSlug !== mdxSlug) {
              return { ok: false as const, error: '目标参数错误' }
            }
          }
        }

        const contentHtml = renderMarkdown(data.content)

        const comment = await repo.create({
          articleId: articleId || null,
          mdxSlug: mdxSlug || null,
          authorId: session.user.id,
          parentId: parentId || null,
          content: data.content,
          contentHtml,
        })

        return { ok: true as const, comment }
      } catch (err) {
        console.error('[comment handler]', err)
        return { ok: false as const, error: '服务器错误' }
      }
    },
  }
}
