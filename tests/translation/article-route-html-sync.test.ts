import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const tx = {
    translationHistory: { create: vi.fn() },
    article: { update: vi.fn() },
    translationTask: { update: vi.fn() },
  }

  return {
    getSession: vi.fn(),
    renderArticleContentHtmlFromJson: vi.fn(),
    safeRevalidatePath: vi.fn(),
    getArticleCityIds: vi.fn(),
    setArticleCityIds: vi.fn(),
    tx,
    prisma: {
      translationTask: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      article: {
        findFirst: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
        findUnique: vi.fn(),
      },
      city: {
        update: vi.fn(),
        findUnique: vi.fn(),
      },
      anime: {
        update: vi.fn(),
      },
      anitabiBangumiI18n: {
        upsert: vi.fn(),
      },
      anitabiPointI18n: {
        upsert: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  }
})

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/city/links', () => ({
  getArticleCityIds: (...args: any[]) => mocks.getArticleCityIds(...args),
  setArticleCityIds: (...args: any[]) => mocks.setArticleCityIds(...args),
}))

vi.mock('@/lib/next/revalidate', () => ({
  safeRevalidatePath: (...args: any[]) => mocks.safeRevalidatePath(...args),
}))

vi.mock('@/lib/article/repair', () => ({
  renderArticleContentHtmlFromJson: (...args: any[]) => mocks.renderArticleContentHtmlFromJson(...args),
}))

function postReq(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('translation article publish html sync', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.prisma.$transaction.mockImplementation(async (cb: any) => cb(mocks.tx as any))
  })

  it('approve route regenerates contentHtml from contentJson for article drafts', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.renderArticleContentHtmlFromJson.mockReturnValue('<p>rebuilt-from-json</p>')
    mocks.getArticleCityIds.mockResolvedValue(['city-1'])
    mocks.setArticleCityIds.mockResolvedValue(undefined)

    mocks.prisma.translationTask.findUnique.mockResolvedValue({
      id: 'task-1',
      entityType: 'article',
      entityId: 'article-zh-1',
      targetLanguage: 'en',
      draftContent: {
        title: 'EN title',
        contentHtml: '<p>stale-html</p>',
        contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    })

    mocks.prisma.article.findFirst.mockResolvedValue({
      id: 'article-en-1',
      slug: 'sound-euphonium-keihan-uji-uji-bridge-and-mt-daikichi',
    })

    const handlers = await import('app/api/admin/translations/[id]/approve/route')
    const res = await handlers.POST(
      postReq('http://localhost/api/admin/translations/task-1/approve'),
      { params: Promise.resolve({ id: 'task-1' }) }
    )

    expect(res.status).toBe(200)

    expect(mocks.renderArticleContentHtmlFromJson).toHaveBeenCalledWith({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })

    expect(mocks.prisma.article.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'article-en-1' },
        data: expect.objectContaining({
          title: 'EN title',
          contentHtml: '<p>rebuilt-from-json</p>',
          contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
        }),
      })
    )

    expect(mocks.prisma.translationTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'approved',
          finalContent: expect.objectContaining({
            contentHtml: '<p>rebuilt-from-json</p>',
          }),
        }),
      })
    )
  })

  it('update-published route regenerates contentHtml from contentJson for published article', async () => {
    const updatedAt = new Date('2026-02-17T00:00:00.000Z')

    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.renderArticleContentHtmlFromJson.mockReturnValue('<p>rebuilt-published-html</p>')

    mocks.prisma.translationTask.findUnique.mockResolvedValue({
      id: 'task-2',
      entityType: 'article',
      entityId: 'article-zh-1',
      targetLanguage: 'en',
      draftContent: {
        title: 'EN title v2',
        contentHtml: '<p>stale-published-html</p>',
        contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    })

    mocks.prisma.article.findFirst.mockResolvedValue({
      id: 'article-en-1',
      title: 'old title',
      description: 'old desc',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'old' }] }] },
      contentHtml: '<p>old-html</p>',
      slug: 'sound-euphonium-keihan-uji-uji-bridge-and-mt-daikichi',
      updatedAt,
    })

    const handlers = await import('app/api/admin/translations/[id]/update-published/route')
    const res = await handlers.POST(
      postReq('http://localhost/api/admin/translations/task-2/update-published', {
        articleUpdatedAt: updatedAt.toISOString(),
      }),
      { params: Promise.resolve({ id: 'task-2' }) }
    )

    expect(res.status).toBe(200)

    expect(mocks.renderArticleContentHtmlFromJson).toHaveBeenCalledWith({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })

    expect(mocks.tx.article.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'article-en-1' },
        data: expect.objectContaining({
          title: 'EN title v2',
          contentHtml: '<p>rebuilt-published-html</p>',
          contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
        }),
      })
    )

    expect(mocks.tx.translationTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-2' },
        data: expect.objectContaining({
          finalContent: expect.objectContaining({
            contentHtml: '<p>rebuilt-published-html</p>',
          }),
        }),
      })
    )
  })
})
