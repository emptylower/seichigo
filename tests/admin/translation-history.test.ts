import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    translationHistory: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    translationTask: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    article: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

function jsonReq(url: string, method: string): NextRequest {
  return new NextRequest(url, { method })
}

function jsonReqWithBody(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Keep module resolution from failing in RED phase when the route file doesn't exist yet.
const updatePublishedRoutePath: string =
  'app/api/admin/translations/[id]/update-published/route'

async function importUpdatePublishedHandlers(): Promise<any> {
  return import(/* @vite-ignore */ updatePublishedRoutePath)
}

// Keep module resolution from failing in RED phase when the route file doesn't exist yet.
const rollbackRoutePath: string = 'app/api/admin/translations/[id]/rollback/route'

async function importRollbackHandlers(): Promise<any> {
  try {
    return await import(/* @vite-ignore */ rollbackRoutePath)
  } catch {
    // RED phase: route may not exist yet. Return a placeholder handler so
    // assertions run and fail meaningfully until the real API is implemented.
    return {
      POST: async () =>
        new Response(JSON.stringify({ error: 'rollback route not implemented' }), {
          status: 501,
          headers: { 'content-type': 'application/json' },
        }),
    }
  }
}

describe('translation history API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('GET /api/admin/translations/[id]/history', () => {
    it('returns history list for translation task', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.translationHistory.findMany.mockResolvedValue([
        {
          id: 'hist-1',
          translationTaskId: 'task-1',
          title: 'Version 2',
          content: { name_en: 'Updated Name' },
          createdAt: new Date('2026-02-02T10:00:00Z'),
          createdById: 'admin-1',
          createdBy: { name: 'Admin User', email: 'admin@example.com' },
        },
        {
          id: 'hist-2',
          translationTaskId: 'task-1',
          title: 'Version 1',
          content: { name_en: 'Original Name' },
          createdAt: new Date('2026-02-01T10:00:00Z'),
          createdById: 'admin-1',
          createdBy: { name: 'Admin User', email: 'admin@example.com' },
        },
      ])

      const handlers = await import('app/api/admin/translations/[id]/history/route')
      const res = await handlers.GET(
        jsonReq('http://localhost/api/admin/translations/task-1/history', 'GET'),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.history).toHaveLength(2)
      expect(j.history[0].id).toBe('hist-1')
      expect(j.history[0].title).toBe('Version 2')
      expect(j.history[0].createdBy.name).toBe('Admin User')
      expect(j.history[1].id).toBe('hist-2')
    })

    it('returns history ordered by createdAt descending', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.translationHistory.findMany.mockResolvedValue([
        {
          id: 'hist-3',
          translationTaskId: 'task-1',
          title: 'Latest',
          content: {},
          createdAt: new Date('2026-02-03T10:00:00Z'),
          createdById: 'admin-1',
          createdBy: { name: 'Admin', email: 'admin@example.com' },
        },
        {
          id: 'hist-1',
          translationTaskId: 'task-1',
          title: 'Oldest',
          content: {},
          createdAt: new Date('2026-02-01T10:00:00Z'),
          createdById: 'admin-1',
          createdBy: { name: 'Admin', email: 'admin@example.com' },
        },
      ])

      const handlers = await import('app/api/admin/translations/[id]/history/route')
      const res = await handlers.GET(
        jsonReq('http://localhost/api/admin/translations/task-1/history', 'GET'),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.history[0].id).toBe('hist-3')
      expect(j.history[1].id).toBe('hist-1')

      expect(mocks.prisma.translationHistory.findMany).toHaveBeenCalledWith({
        where: { translationTaskId: 'task-1' },
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { name: true, email: true } } },
      })
    })

    it('includes creator information in history items', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.translationHistory.findMany.mockResolvedValue([
        {
          id: 'hist-1',
          translationTaskId: 'task-1',
          title: 'Version 1',
          content: {},
          createdAt: new Date('2026-02-01T10:00:00Z'),
          createdById: 'admin-2',
          createdBy: { name: 'Another Admin', email: 'another@example.com' },
        },
      ])

      const handlers = await import('app/api/admin/translations/[id]/history/route')
      const res = await handlers.GET(
        jsonReq('http://localhost/api/admin/translations/task-1/history', 'GET'),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.history[0].createdBy).toEqual({
        name: 'Another Admin',
        email: 'another@example.com',
      })
    })

    it('returns empty array when no history exists', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.translationHistory.findMany.mockResolvedValue([])

      const handlers = await import('app/api/admin/translations/[id]/history/route')
      const res = await handlers.GET(
        jsonReq('http://localhost/api/admin/translations/task-1/history', 'GET'),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.history).toEqual([])
    })

    it('rejects non-admin users', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

      const handlers = await import('app/api/admin/translations/[id]/history/route')
      const res = await handlers.GET(
        jsonReq('http://localhost/api/admin/translations/task-1/history', 'GET'),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(401)
      expect(mocks.prisma.translationHistory.findMany).not.toHaveBeenCalled()
    })

    it('rejects unauthenticated requests', async () => {
      mocks.getSession.mockResolvedValue(null)

      const handlers = await import('app/api/admin/translations/[id]/history/route')
      const res = await handlers.GET(
        jsonReq('http://localhost/api/admin/translations/task-1/history', 'GET'),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(401)
      expect(mocks.prisma.translationHistory.findMany).not.toHaveBeenCalled()
    })
  })

  describe('update-published', () => {
    beforeEach(() => {
      // Mirror typical Prisma transaction usage in route handlers.
      mocks.prisma.$transaction.mockImplementation(async (cbOrOps: any) => {
        if (typeof cbOrOps === 'function') return cbOrOps(mocks.prisma)
        return Promise.all(cbOrOps)
      })
    })

    it('successfully updates a published article', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

      const oldContentJson = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Old body' }] },
        ],
      }
      const newContentJson = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'New body' }] },
        ],
      }

      mocks.prisma.translationTask.findUnique.mockResolvedValue({
        id: 'task-1',
        entityType: 'article',
        entityId: 'article-1',
        targetLanguage: 'en',
        draftContent: {
          title: 'New Title',
          description: 'New Description',
          contentJson: newContentJson,
          contentHtml: '<p>New body</p>',
        },
      })

      mocks.prisma.article.findFirst.mockResolvedValue({
        id: 'article-en-1',
        title: 'Old Title',
        description: 'Old Description',
        contentJson: oldContentJson,
        contentHtml: '<p>Old body</p>',
        slug: 'test-article',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      })

      mocks.prisma.translationHistory.create.mockResolvedValue({ id: 'hist-1' })
      mocks.prisma.article.update.mockResolvedValue({ id: 'article-en-1' })

      const handlers = await importUpdatePublishedHandlers()
      const res = await handlers.POST(
        jsonReqWithBody(
          'http://localhost/api/admin/translations/task-1/update-published',
          'POST',
          { articleUpdatedAt: '2026-02-01T00:00:00.000Z' }
        ),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(200)

      expect(mocks.prisma.translationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          translationTaskId: 'task-1',
          articleId: 'article-en-1',
          createdById: 'admin-1',
          content: expect.objectContaining({
            title: 'Old Title',
            description: 'Old Description',
            contentJson: oldContentJson,
            contentHtml: '<p>Old body</p>',
          }),
        }),
      })

      expect(mocks.prisma.article.update).toHaveBeenCalledWith({
        where: { id: 'article-en-1' },
        data: expect.objectContaining({
          title: 'New Title',
          description: 'New Description',
          contentJson: newContentJson,
          contentHtml: '<p>New body</p>',
        }),
      })
    })

    it('returns 400 when contentJson is empty', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

      mocks.prisma.translationTask.findUnique.mockResolvedValue({
        id: 'task-1',
        entityType: 'article',
        entityId: 'article-1',
        targetLanguage: 'en',
        draftContent: {
          title: 'New Title',
          contentJson: { type: 'doc', content: [] },
        },
      })

      mocks.prisma.article.findFirst.mockResolvedValue({
        id: 'article-en-1',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
      })

      const handlers = await importUpdatePublishedHandlers()
      const res = await handlers.POST(
        jsonReqWithBody(
          'http://localhost/api/admin/translations/task-1/update-published',
          'POST',
          { articleUpdatedAt: '2026-02-01T00:00:00.000Z' }
        ),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(400)
      const j = await res.json()
      expect(j.error).toBeTruthy()
      expect(mocks.prisma.translationHistory.create).not.toHaveBeenCalled()
      expect(mocks.prisma.article.update).not.toHaveBeenCalled()
    })

    it('returns 409 when there is a concurrency conflict', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

      mocks.prisma.translationTask.findUnique.mockResolvedValue({
        id: 'task-1',
        entityType: 'article',
        entityId: 'article-1',
        targetLanguage: 'en',
        draftContent: {
          title: 'New Title',
          contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
        },
      })

      mocks.prisma.article.findFirst.mockResolvedValue({
        id: 'article-en-1',
        updatedAt: new Date('2026-02-02T00:00:00.000Z'),
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
      })

      const handlers = await importUpdatePublishedHandlers()
      const res = await handlers.POST(
        jsonReqWithBody(
          'http://localhost/api/admin/translations/task-1/update-published',
          'POST',
          { articleUpdatedAt: '2026-02-01T00:00:00.000Z' }
        ),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(409)
      const j = await res.json()
      expect(j.error).toBeTruthy()
      expect(mocks.prisma.translationHistory.create).not.toHaveBeenCalled()
      expect(mocks.prisma.article.update).not.toHaveBeenCalled()
    })

    it('creates a history snapshot before updating the article', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

      mocks.prisma.translationTask.findUnique.mockResolvedValue({
        id: 'task-1',
        entityType: 'article',
        entityId: 'article-1',
        targetLanguage: 'en',
        draftContent: {
          title: 'New Title',
          contentJson: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New' }] }],
          },
        },
      })

      mocks.prisma.article.findFirst.mockResolvedValue({
        id: 'article-en-1',
        title: 'Old Title',
        contentJson: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old' }] }],
        },
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      })

      mocks.prisma.translationHistory.create.mockResolvedValue({ id: 'hist-1' })
      mocks.prisma.article.update.mockResolvedValue({ id: 'article-en-1' })

      const handlers = await importUpdatePublishedHandlers()
      const res = await handlers.POST(
        jsonReqWithBody(
          'http://localhost/api/admin/translations/task-1/update-published',
          'POST',
          { articleUpdatedAt: '2026-02-01T00:00:00.000Z' }
        ),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(200)

      const createOrder = mocks.prisma.translationHistory.create.mock.invocationCallOrder[0]
      const updateOrder = mocks.prisma.article.update.mock.invocationCallOrder[0]
      expect(createOrder).toBeLessThan(updateOrder)
    })
  })

  describe('rollback', () => {
    beforeEach(() => {
      // Mirror typical Prisma transaction usage in route handlers.
      mocks.prisma.$transaction.mockImplementation(async (cbOrOps: any) => {
        if (typeof cbOrOps === 'function') return cbOrOps(mocks.prisma)
        return Promise.all(cbOrOps)
      })
    })

    it('successfully rolls back to a historical version', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

      const currentContentJson = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Current body' }] },
        ],
      }
      const rollbackContentJson = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Rolled back body' }] },
        ],
      }

      mocks.prisma.translationTask.findUnique.mockResolvedValue({
        id: 'task-1',
        entityType: 'article',
        entityId: 'article-1',
        targetLanguage: 'en',
      })

      mocks.prisma.article.findFirst.mockResolvedValue({
        id: 'article-en-1',
        title: 'Current Title',
        description: 'Current Description',
        contentJson: currentContentJson,
        contentHtml: '<p>Current body</p>',
      })

      mocks.prisma.translationHistory.findUnique.mockResolvedValue({
        id: 'hist-1',
        translationTaskId: 'task-1',
        articleId: 'article-en-1',
        content: {
          title: 'Old Title',
          description: 'Old Description',
          contentJson: rollbackContentJson,
          contentHtml: '<p>Rolled back body</p>',
        },
      })

      mocks.prisma.translationHistory.create.mockResolvedValue({ id: 'hist-snap-1' })
      mocks.prisma.article.update.mockResolvedValue({ id: 'article-en-1' })

      const handlers = await importRollbackHandlers()
      const res = await handlers.POST(
        jsonReqWithBody('http://localhost/api/admin/translations/task-1/rollback', 'POST', {
          historyId: 'hist-1',
        }),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(200)

      // Should snapshot current article before rollback.
      expect(mocks.prisma.translationHistory.create).toHaveBeenCalled()

      // Should rollback the article to historical content.
      expect(mocks.prisma.article.update).toHaveBeenCalledWith({
        where: { id: 'article-en-1' },
        data: expect.objectContaining({
          title: 'Old Title',
          description: 'Old Description',
          contentJson: rollbackContentJson,
          contentHtml: '<p>Rolled back body</p>',
        }),
      })
    })

    it('creates a snapshot of current version before rolling back', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

      const currentContentJson = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Current body' }] },
        ],
      }
      const rollbackContentJson = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Rolled back body' }] },
        ],
      }

      mocks.prisma.translationTask.findUnique.mockResolvedValue({
        id: 'task-1',
        entityType: 'article',
        entityId: 'article-1',
        targetLanguage: 'en',
      })

      mocks.prisma.article.findFirst.mockResolvedValue({
        id: 'article-en-1',
        title: 'Current Title',
        description: 'Current Description',
        contentJson: currentContentJson,
        contentHtml: '<p>Current body</p>',
      })

      mocks.prisma.translationHistory.findUnique.mockResolvedValue({
        id: 'hist-1',
        translationTaskId: 'task-1',
        articleId: 'article-en-1',
        content: {
          title: 'Old Title',
          description: 'Old Description',
          contentJson: rollbackContentJson,
          contentHtml: '<p>Rolled back body</p>',
        },
      })

      mocks.prisma.translationHistory.create.mockResolvedValue({ id: 'hist-snap-1' })
      mocks.prisma.article.update.mockResolvedValue({ id: 'article-en-1' })

      const handlers = await importRollbackHandlers()
      const res = await handlers.POST(
        jsonReqWithBody('http://localhost/api/admin/translations/task-1/rollback', 'POST', {
          historyId: 'hist-1',
        }),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(200)

      // Snapshot must be created from CURRENT content, not the rollback target.
      expect(mocks.prisma.translationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          translationTaskId: 'task-1',
          articleId: 'article-en-1',
          createdById: 'admin-1',
          content: expect.objectContaining({
            title: 'Current Title',
            description: 'Current Description',
            contentJson: currentContentJson,
            contentHtml: '<p>Current body</p>',
          }),
        }),
      })

      const createOrder = mocks.prisma.translationHistory.create.mock.invocationCallOrder[0]
      const updateOrder = mocks.prisma.article.update.mock.invocationCallOrder[0]
      expect(createOrder).toBeLessThan(updateOrder)

      // Guard against the historical "empty content" regression: rolled back contentJson must not be empty.
      const updateArg = mocks.prisma.article.update.mock.calls[0]?.[0]
      const updatedContentJson = updateArg?.data?.contentJson
      expect(updatedContentJson?.content?.length).toBeGreaterThan(0)
    })

    it('returns 404 when history version does not exist', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

      mocks.prisma.translationTask.findUnique.mockResolvedValue({
        id: 'task-1',
        entityType: 'article',
        entityId: 'article-1',
        targetLanguage: 'en',
      })

      mocks.prisma.translationHistory.findUnique.mockResolvedValue(null)

      const handlers = await importRollbackHandlers()
      const res = await handlers.POST(
        jsonReqWithBody('http://localhost/api/admin/translations/task-1/rollback', 'POST', {
          historyId: 'hist-does-not-exist',
        }),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(404)
      expect(mocks.prisma.translationHistory.create).not.toHaveBeenCalled()
      expect(mocks.prisma.article.update).not.toHaveBeenCalled()
    })
  })
})
