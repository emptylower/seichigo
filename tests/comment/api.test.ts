import { describe, it, expect } from 'vitest'
import { InMemoryCommentRepo } from '@/lib/comment/repoMemory'
import { renderCommentMarkdown } from '@/lib/comment/markdown'
import { createHandlers as createCommentsHandlers } from '@/lib/comment/handlers/comments'
import { createHandlers as createCommentByIdHandlers } from '@/lib/comment/handlers/commentById'
import { createHandlers as createCommentLikeHandlers } from '@/lib/comment/handlers/commentLike'
import type { CommentApiDeps } from '@/lib/comment/api'

type Session = {
  user?: {
    id?: string
    email?: string
    isAdmin?: boolean
  }
} | null

function makeIncrementingNow(startIso = '2025-01-01T00:00:00.000Z') {
  let t = new Date(startIso).getTime()
  return () => {
    t += 1000
    return new Date(t)
  }
}

function makeDeps(
  overrides?: Partial<CommentApiDeps> & {
    now?: () => Date
  }
): CommentApiDeps {
  const now = overrides?.now ?? makeIncrementingNow()
  const repo = overrides?.repo ?? new InMemoryCommentRepo({ now })

  return {
    repo,
    renderMarkdown: renderCommentMarkdown,
    ...overrides,
  }
}

function makeSession(overrides?: Partial<NonNullable<Session>['user']>): NonNullable<Session> {
  return {
    user: {
      id: 'user1',
      email: 'test@example.com',
      isAdmin: false,
      ...overrides,
    },
  }
}

describe('Comment Handlers', () => {
  describe('list', () => {
    it('returns empty array when no comments exist', async () => {
      const deps = makeDeps()
      const handlers = createCommentsHandlers(deps)

      const result = await handlers.list({ articleId: 'article1' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.comments).toEqual([])
      }
    })

    it('returns comments with likeCount defaulting to 0', async () => {
      const deps = makeDeps()
      await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'test',
        contentHtml: '<p>test</p>',
      })

      const handlers = createCommentsHandlers(deps)
      const result = await handlers.list({ articleId: 'article1' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.comments).toHaveLength(1)
        expect(result.comments[0]?.likeCount).toBe(0)
        expect(result.comments[0]?.author.id).toBe('user1')
        expect(result.comments[0]?.replies).toEqual([])
      }
    })

    it('nests replies under parent comments', async () => {
      const deps = makeDeps()
      const parent = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'parent',
        contentHtml: '<p>parent</p>',
      })
      const reply = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user2',
        parentId: parent.id,
        content: 'reply',
        contentHtml: '<p>reply</p>',
      })

      const handlers = createCommentsHandlers(deps)
      const result = await handlers.list({ articleId: 'article1' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.comments).toHaveLength(1)
        expect(result.comments[0]?.id).toBe(parent.id)
        expect(result.comments[0]?.replies).toHaveLength(1)
        expect(result.comments[0]?.replies[0]?.id).toBe(reply.id)
        expect(result.comments[0]?.replies[0]?.parentId).toBe(parent.id)
      }
    })

    it('returns error when no target provided', async () => {
      const deps = makeDeps()
      const handlers = createCommentsHandlers(deps)

      const result = await handlers.list({})
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('缺少目标参数')
      }
    })

    it('filters by mdxSlug', async () => {
      const deps = makeDeps()
      await deps.repo.create({
        mdxSlug: 'post-1',
        authorId: 'user1',
        content: 'test',
        contentHtml: '<p>test</p>',
      })

      const handlers = createCommentsHandlers(deps)
      const result = await handlers.list({ mdxSlug: 'post-1' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.comments).toHaveLength(1)
        expect(result.comments[0]?.mdxSlug).toBe('post-1')
        expect(result.comments[0]?.articleId).toBeNull()
      }
    })

    it('includes like counts from the repo', async () => {
      const deps = makeDeps()
      const comment = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'test',
        contentHtml: '<p>test</p>',
      })
      await deps.repo.toggleLike(comment.id, 'user1')
      await deps.repo.toggleLike(comment.id, 'user2')

      const handlers = createCommentsHandlers(deps)
      const result = await handlers.list({ articleId: 'article1' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.comments[0]?.likeCount).toBe(2)
      }
    })

    it('keeps orphan replies visible as top-level items', async () => {
      const deps = makeDeps()
      const orphan = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        parentId: 'missing-parent',
        content: 'orphan reply',
        contentHtml: '<p>orphan</p>',
      })

      const handlers = createCommentsHandlers(deps)
      const result = await handlers.list({ articleId: 'article1' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.comments).toHaveLength(1)
        expect(result.comments[0]?.id).toBe(orphan.id)
        expect(result.comments[0]?.parentId).toBe('missing-parent')
      }
    })

    it('flattens deeper nesting to at most 2 levels', async () => {
      const deps = makeDeps()
      const root = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'root',
        contentHtml: '<p>root</p>',
      })
      const reply1 = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user2',
        parentId: root.id,
        content: 'reply 1',
        contentHtml: '<p>reply1</p>',
      })
      const reply2 = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user3',
        parentId: reply1.id,
        content: 'reply 2',
        contentHtml: '<p>reply2</p>',
      })

      const handlers = createCommentsHandlers(deps)
      const result = await handlers.list({ articleId: 'article1' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.comments).toHaveLength(1)
        expect(result.comments[0]?.replies.map((r) => r.id)).toEqual([
          reply1.id,
          reply2.id,
        ])
        expect(result.comments[0]?.replies[0]?.replies).toEqual([])
      }
    })
  })

  describe('create', () => {
    it('returns 401 when not authenticated', async () => {
      const deps = makeDeps()
      const handlers = createCommentsHandlers(deps)

      const result = await handlers.create(null, {
        articleId: 'article1',
        content: 'test',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('请先登录')
      }
    })

    it('returns 400 when content is empty', async () => {
      const deps = makeDeps()
      const handlers = createCommentsHandlers(deps)
      const session = makeSession()

      const result = await handlers.create(session, {
        articleId: 'article1',
        content: '   ',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('评论内容不能为空')
      }
    })

    it('returns 400 when both articleId and mdxSlug are provided', async () => {
      const deps = makeDeps()
      const handlers = createCommentsHandlers(deps)
      const session = makeSession()

      const result = await handlers.create(session, {
        articleId: 'article1',
        mdxSlug: 'post-1',
        content: 'test',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('目标参数错误')
      }
    })

    it('returns 400 when neither articleId nor mdxSlug are provided', async () => {
      const deps = makeDeps()
      const handlers = createCommentsHandlers(deps)
      const session = makeSession()

      const result = await handlers.create(session, {
        content: 'test',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('目标参数错误')
      }
    })

    it('creates comment successfully with articleId and renders markdown', async () => {
      const deps = makeDeps()
      const handlers = createCommentsHandlers(deps)
      const session = makeSession({ id: 'user1' })

      const result = await handlers.create(session, {
        articleId: 'article1',
        content: '**bold** text',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.comment.articleId).toBe('article1')
        expect(result.comment.mdxSlug).toBeNull()
        expect(result.comment.authorId).toBe('user1')
        expect(result.comment.parentId).toBeNull()
        expect(result.comment.contentHtml).toContain('<strong>bold</strong>')
        expect(result.comment.createdAt).toBeInstanceOf(Date)
        expect(typeof result.comment.id).toBe('string')
      }
    })

    it('creates comment successfully with mdxSlug', async () => {
      const deps = makeDeps()
      const handlers = createCommentsHandlers(deps)
      const session = makeSession({ id: 'user1' })

      const result = await handlers.create(session, {
        mdxSlug: 'post-1',
        content: 'test',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.comment.articleId).toBeNull()
        expect(result.comment.mdxSlug).toBe('post-1')
      }
    })

    it('creates reply successfully (only one level deep)', async () => {
      const deps = makeDeps()
      const parent = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'parent',
        contentHtml: '<p>parent</p>',
      })
      const handlers = createCommentsHandlers(deps)
      const session = makeSession({ id: 'user2' })

      const result = await handlers.create(session, {
        articleId: 'article1',
        parentId: parent.id,
        content: 'reply',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.comment.parentId).toBe(parent.id)
        expect(result.comment.authorId).toBe('user2')
      }
    })

    it('rejects reply-to-reply', async () => {
      const deps = makeDeps()
      const parent = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'parent',
        contentHtml: '<p>parent</p>',
      })
      const reply = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user2',
        parentId: parent.id,
        content: 'reply',
        contentHtml: '<p>reply</p>',
      })

      const handlers = createCommentsHandlers(deps)
      const session = makeSession({ id: 'user3' })
      const result = await handlers.create(session, {
        articleId: 'article1',
        parentId: reply.id,
        content: 'reply to reply',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('不支持多级回复')
      }
    })

    it('rejects reply when parent comment does not exist', async () => {
      const deps = makeDeps()
      const handlers = createCommentsHandlers(deps)
      const session = makeSession({ id: 'user2' })

      const result = await handlers.create(session, {
        articleId: 'article1',
        parentId: 'missing',
        content: 'reply',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('父评论不存在')
      }
    })

    it('rejects reply when target does not match parent comment', async () => {
      const deps = makeDeps()
      const parent = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'parent',
        contentHtml: '<p>parent</p>',
      })

      const handlers = createCommentsHandlers(deps)
      const session = makeSession({ id: 'user2' })
      const result = await handlers.create(session, {
        articleId: 'article2',
        parentId: parent.id,
        content: 'reply',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('目标参数错误')
      }
    })
  })

  describe('remove', () => {
    it('returns 401 when not authenticated', async () => {
      const deps = makeDeps()
      const handlers = createCommentByIdHandlers(deps)

      const result = await handlers.remove(null, 'c1')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('请先登录')
      }
    })

    it('returns 404 when comment not found', async () => {
      const deps = makeDeps()
      const handlers = createCommentByIdHandlers(deps)
      const session = makeSession()

      const result = await handlers.remove(session, 'nonexistent')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('评论不存在')
      }
    })

    it('returns 403 when user is not author and not admin', async () => {
      const deps = makeDeps()
      const comment = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'test',
        contentHtml: '<p>test</p>',
      })
      const handlers = createCommentByIdHandlers(deps)
      const session = makeSession({ id: 'user2', isAdmin: false })

      const result = await handlers.remove(session, comment.id)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('无权限')
      }
    })

    it('deletes own comment successfully', async () => {
      const deps = makeDeps()
      const comment = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'test',
        contentHtml: '<p>test</p>',
      })
      const handlers = createCommentByIdHandlers(deps)
      const session = makeSession({ id: 'user1' })

      const result = await handlers.remove(session, comment.id)
      expect(result.ok).toBe(true)

      const deleted = await deps.repo.findById(comment.id)
      expect(deleted).toBeNull()
    })

    it('admin can delete any comment', async () => {
      const deps = makeDeps()
      const comment = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'test',
        contentHtml: '<p>test</p>',
      })
      const handlers = createCommentByIdHandlers(deps)
      const session = makeSession({ id: 'admin', isAdmin: true })

      const result = await handlers.remove(session, comment.id)
      expect(result.ok).toBe(true)
    })

    it('cascades deletion to replies', async () => {
      const deps = makeDeps()
      const parent = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'parent',
        contentHtml: '<p>parent</p>',
      })
      const reply = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user2',
        parentId: parent.id,
        content: 'reply',
        contentHtml: '<p>reply</p>',
      })
      await deps.repo.toggleLike(reply.id, 'user1')

      const handlers = createCommentByIdHandlers(deps)
      const session = makeSession({ id: 'user1' })
      const result = await handlers.remove(session, parent.id)
      expect(result.ok).toBe(true)

      expect(await deps.repo.findById(parent.id)).toBeNull()
      expect(await deps.repo.findById(reply.id)).toBeNull()
      expect(await deps.repo.getLikeCount(reply.id)).toBe(0)
    })
  })

  describe('toggle', () => {
    it('returns 401 when not authenticated', async () => {
      const deps = makeDeps()
      const handlers = createCommentLikeHandlers(deps)

      const result = await handlers.toggle(null, 'c1')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('请先登录')
      }
    })

    it('likes comment on first toggle', async () => {
      const deps = makeDeps()
      const comment = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'test',
        contentHtml: '<p>test</p>',
      })

      const handlers = createCommentLikeHandlers(deps)
      const session = makeSession({ id: 'user1' })
      const result = await handlers.toggle(session, comment.id)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.liked).toBe(true)
        expect(result.count).toBe(1)
      }

      expect(await deps.repo.getLikeStatus(comment.id, 'user1')).toBe(true)
    })

    it('unlikes comment on second toggle', async () => {
      const deps = makeDeps()
      const comment = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'test',
        contentHtml: '<p>test</p>',
      })

      const handlers = createCommentLikeHandlers(deps)
      const session = makeSession({ id: 'user1' })

      const first = await handlers.toggle(session, comment.id)
      expect(first.ok).toBe(true)

      const second = await handlers.toggle(session, comment.id)
      expect(second.ok).toBe(true)
      if (second.ok) {
        expect(second.liked).toBe(false)
        expect(second.count).toBe(0)
      }
    })

    it('tracks counts across multiple users', async () => {
      const deps = makeDeps()
      const comment = await deps.repo.create({
        articleId: 'article1',
        authorId: 'user1',
        content: 'test',
        contentHtml: '<p>test</p>',
      })

      const handlers = createCommentLikeHandlers(deps)
      const s1 = makeSession({ id: 'user1' })
      const s2 = makeSession({ id: 'user2' })

      const r1 = await handlers.toggle(s1, comment.id)
      expect(r1.ok).toBe(true)
      const r2 = await handlers.toggle(s2, comment.id)
      expect(r2.ok).toBe(true)
      if (r2.ok) {
        expect(r2.count).toBe(2)
      }

      const r3 = await handlers.toggle(s1, comment.id)
      expect(r3.ok).toBe(true)
      if (r3.ok) {
        expect(r3.count).toBe(1)
      }
    })
  })
})
