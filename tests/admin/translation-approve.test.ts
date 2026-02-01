import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    translationTask: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    article: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
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

describe('POST /api/admin/translations/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('copies cover and metadata from source article when creating new translation', async () => {
    // Arrange: Admin session
    mocks.getSession.mockResolvedValue({
      user: { id: 'admin-1', isAdmin: true },
    })

    // Arrange: Translation task with draft content
    mocks.prisma.translationTask.findUnique.mockResolvedValue({
      id: 'task-1',
      entityType: 'article',
      entityId: 'article-1',
      targetLanguage: 'en',
      draftContent: {
        title: 'Translated Title',
        description: 'Translated Description',
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
        contentHtml: '<p>Hello</p>',
      },
    })

    // Arrange: No existing translation
    mocks.prisma.article.findFirst.mockResolvedValue(null)

    // Arrange: Source article with cover and metadata
    mocks.prisma.article.findUnique.mockResolvedValue({
      id: 'article-1',
      authorId: 'author-1',
      slug: 'test-article',
      translationGroupId: null,
      cover: 'https://example.com/cover.jpg',
      animeIds: ['anime-1', 'anime-2'],
      city: 'tokyo',
      routeLength: '5km',
      tags: ['tag1', 'tag2'],
    })

    // Act
    const { POST } = await import('@/app/api/admin/translations/[id]/approve/route')
    const req = jsonReq('http://localhost:3000/api/admin/translations/task-1/approve', 'POST')
    const res = await POST(req, { params: Promise.resolve({ id: 'task-1' }) })

    // Assert: Response is successful
    expect(res.status).toBe(200)

    // Assert: Article.create was called with cover and metadata from source
    expect(mocks.prisma.article.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Translated Title',
        description: 'Translated Description',
        contentHtml: '<p>Hello</p>',
        slug: 'test-article',
        authorId: 'author-1',
        language: 'en',
        cover: 'https://example.com/cover.jpg',
        animeIds: ['anime-1', 'anime-2'],
        city: 'tokyo',
        routeLength: '5km',
        tags: ['tag1', 'tag2'],
        status: 'published',
      }),
    })
  })

  it('sets bidirectional translationGroupId when creating first translation', async () => {
    // Arrange: Admin session
    mocks.getSession.mockResolvedValue({
      user: { id: 'admin-1', isAdmin: true },
    })

    // Arrange: Translation task
    mocks.prisma.translationTask.findUnique.mockResolvedValue({
      id: 'task-1',
      entityType: 'article',
      entityId: 'article-1',
      targetLanguage: 'en',
      draftContent: {
        title: 'Translated Title',
        contentJson: { type: 'doc', content: [] },
      },
    })

    // Arrange: No existing translation
    mocks.prisma.article.findFirst.mockResolvedValue(null)

    // Arrange: Source article WITHOUT translationGroupId
    mocks.prisma.article.findUnique.mockResolvedValue({
      id: 'article-1',
      authorId: 'author-1',
      slug: 'test-article',
      translationGroupId: null,
      cover: null,
      animeIds: [],
      city: null,
      routeLength: null,
      tags: [],
    })

    // Act
    const { POST } = await import('@/app/api/admin/translations/[id]/approve/route')
    const req = jsonReq('http://localhost:3000/api/admin/translations/task-1/approve', 'POST')
    const res = await POST(req, { params: Promise.resolve({ id: 'task-1' }) })

    // Assert: Response is successful
    expect(res.status).toBe(200)

    // Assert: New article's translationGroupId points to source article
    expect(mocks.prisma.article.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        translationGroupId: 'article-1',
      }),
    })

    // Assert: Source article's translationGroupId is updated to its own ID
    expect(mocks.prisma.article.update).toHaveBeenCalledWith({
      where: { id: 'article-1' },
      data: { translationGroupId: 'article-1' },
    })
  })

  it('does not update source translationGroupId if already set', async () => {
    // Arrange: Admin session
    mocks.getSession.mockResolvedValue({
      user: { id: 'admin-1', isAdmin: true },
    })

    // Arrange: Translation task
    mocks.prisma.translationTask.findUnique.mockResolvedValue({
      id: 'task-1',
      entityType: 'article',
      entityId: 'article-1',
      targetLanguage: 'ja',
      draftContent: {
        title: 'Japanese Title',
        contentJson: { type: 'doc', content: [] },
      },
    })

    // Arrange: No existing translation
    mocks.prisma.article.findFirst.mockResolvedValue(null)

    // Arrange: Source article WITH translationGroupId already set
    mocks.prisma.article.findUnique.mockResolvedValue({
      id: 'article-1',
      authorId: 'author-1',
      slug: 'test-article',
      translationGroupId: 'article-1', // Already set
      cover: null,
      animeIds: [],
      city: null,
      routeLength: null,
      tags: [],
    })

    // Act
    const { POST } = await import('@/app/api/admin/translations/[id]/approve/route')
    const req = jsonReq('http://localhost:3000/api/admin/translations/task-1/approve', 'POST')
    const res = await POST(req, { params: Promise.resolve({ id: 'task-1' }) })

    // Assert: Response is successful
    expect(res.status).toBe(200)

    // Assert: New article uses existing translationGroupId
    expect(mocks.prisma.article.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        translationGroupId: 'article-1',
      }),
    })

    // Assert: Source article is NOT updated (translationGroupId already set)
    expect(mocks.prisma.article.update).not.toHaveBeenCalled()
  })
})
