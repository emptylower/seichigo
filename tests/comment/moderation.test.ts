import { describe, expect, it } from 'vitest'
import { renderCommentMarkdown } from '@/lib/comment/markdown'
import { createHandlers as createPublicHandlers } from '@/lib/comment/handlers/comments'
import { createHandlers as createModerationHandlers } from '@/lib/comment/handlers/commentModeration'
import { createHandlers as createReportHandlers } from '@/lib/comment/handlers/commentReport'
import { InMemoryCommentRepo } from '@/lib/comment/repoMemory'
import type { CommentApiDeps } from '@/lib/comment/api'

type Session = {
  user?: { id?: string; isAdmin?: boolean }
} | null

function makeDeps(): CommentApiDeps {
  const now = () => new Date('2025-01-01T00:00:00.000Z')
  return {
    repo: new InMemoryCommentRepo({ now }),
    renderMarkdown: renderCommentMarkdown,
  }
}

function session(id = 'user-1', isAdmin = false): NonNullable<Session> {
  return { user: { id, isAdmin } }
}

async function createComment(deps: CommentApiDeps, authorId = 'author-1') {
  return deps.repo.create({
    articleId: 'article-1',
    authorId,
    content: 'comment',
    contentHtml: '<p>comment</p>',
  })
}

describe('comment moderation repository contract', () => {
  it('creates comments visible by default and filters hidden comments from public targets', async () => {
    const deps = makeDeps()
    const comment = await createComment(deps)

    expect(comment.status).toBe('visible')
    expect(await deps.repo.findByTarget({ articleId: 'article-1' })).toHaveLength(1)

    const hidden = await deps.repo.hide(comment.id, 'admin-1')
    expect(hidden).toMatchObject({ status: 'hidden', hiddenBy: 'admin-1' })
    expect(await deps.repo.findByTarget({ articleId: 'article-1' })).toEqual([])

    const moderation = await deps.repo.listForModeration()
    expect(moderation[0]).toMatchObject({ id: comment.id, status: 'hidden', hiddenBy: 'admin-1' })

    const restored = await deps.repo.restore(comment.id)
    expect(restored).toMatchObject({ status: 'visible', hiddenAt: null, hiddenBy: null })
    expect(await deps.repo.findByTarget({ articleId: 'article-1' })).toHaveLength(1)
  })

  it('cascades reports, likes, and replies when a comment is deleted', async () => {
    const deps = makeDeps()
    const parent = await createComment(deps)
    const reply = await deps.repo.create({
      articleId: 'article-1',
      authorId: 'reply-author',
      parentId: parent.id,
      content: 'reply',
      contentHtml: '<p>reply</p>',
    })
    await deps.repo.createReport({ commentId: parent.id, reporterId: 'reporter-1', reason: 'spam' })
    await deps.repo.toggleLike(reply.id, 'user-1')

    await deps.repo.delete(parent.id)

    expect(await deps.repo.findById(parent.id)).toBeNull()
    expect(await deps.repo.findById(reply.id)).toBeNull()
    expect(await deps.repo.findReport(parent.id, 'reporter-1')).toBeNull()
    expect(await deps.repo.getLikeCount(reply.id)).toBe(0)
    expect(await deps.repo.listForModeration()).toEqual([])
  })

  it('enforces one report per comment and reporter', async () => {
    const deps = makeDeps()
    const comment = await createComment(deps)
    await deps.repo.createReport({ commentId: comment.id, reporterId: 'reporter-1', reason: 'spam' })

    await expect(
      deps.repo.createReport({ commentId: comment.id, reporterId: 'reporter-1', reason: 'other' })
    ).rejects.toThrow('comment report already exists')
  })
})

describe('comment moderation handlers', () => {
  it('keeps hidden comments out of the public list', async () => {
    const deps = makeDeps()
    const comment = await createComment(deps)
    await deps.repo.hide(comment.id, 'admin-1')

    const result = await createPublicHandlers(deps).list({ articleId: 'article-1' })
    expect(result).toMatchObject({ ok: true, comments: [] })
  })

  it('requires admin access and supports hide, restore, and delete', async () => {
    const deps = makeDeps()
    const comment = await createComment(deps)
    const handlers = createModerationHandlers(deps)

    expect(await handlers.list(session('user-1', false))).toMatchObject({ ok: false, error: '无权限' })
    expect(await handlers.update(session('user-1', false), comment.id, 'hide')).toMatchObject({ ok: false, error: '无权限' })

    const hidden = await handlers.update(session('admin-1', true), comment.id, 'hide')
    expect(hidden).toMatchObject({ ok: true, comment: { status: 'hidden', hiddenBy: 'admin-1' } })
    const restored = await handlers.update(session('admin-1', true), comment.id, 'restore')
    expect(restored).toMatchObject({ ok: true, comment: { status: 'visible', hiddenBy: null } })
    expect(await handlers.remove(session('admin-1', true), comment.id)).toMatchObject({ ok: true })
    expect(await deps.repo.findById(comment.id)).toBeNull()
  })
})

describe('comment report handlers', () => {
  it('requires login, validates reason, handles missing comments, and rejects duplicates', async () => {
    const deps = makeDeps()
    const handlers = createReportHandlers(deps)

    expect(await handlers.report(null, 'comment-1', 'spam')).toMatchObject({ ok: false, error: '请先登录' })
    expect(await handlers.report(session(), 'comment-1', 'invalid')).toMatchObject({ ok: false, error: '举报原因无效' })
    expect(await handlers.report(session(), 'comment-1', 'spam')).toMatchObject({ ok: false, error: '评论不存在' })

    const comment = await createComment(deps)
    expect(await handlers.report(session('reporter-1'), comment.id, 'spam')).toMatchObject({ ok: true })
    expect(await handlers.report(session('reporter-1'), comment.id, 'spam')).toMatchObject({ ok: false, error: '你已经举报过该评论' })
  })
})
