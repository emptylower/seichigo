import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  translateAnime: vi.fn(),
  translateCity: vi.fn(),
  translateArticle: vi.fn(),
  prisma: {
    anime: {
      update: vi.fn(),
    },
    city: {
      update: vi.fn(),
    },
    article: {
      update: vi.fn(),
    },
    translationTask: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/translation/service', () => ({
  translateAnime: (...args: any[]) => mocks.translateAnime(...args),
  translateCity: (...args: any[]) => mocks.translateCity(...args),
  translateArticle: (...args: any[]) => mocks.translateArticle(...args),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

function jsonReq(url: string, method: string, body?: any): any {
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('admin retranslate api - preview', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns preview for anime translation', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.translateAnime.mockResolvedValue({
      success: true,
      sourceContent: { name: 'Original Name', summary: 'Original Summary' },
      translatedContent: { name: 'Translated Name', summary: 'Translated Summary' },
    })

    const handlers = await import('app/api/admin/retranslate/route')
    const res = await handlers.POST(
      jsonReq('http://localhost/api/admin/retranslate', 'POST', {
        entityType: 'anime',
        entityId: 'anime-1',
        targetLang: 'en',
      })
    )

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.preview).toEqual({ name: 'Translated Name', summary: 'Translated Summary' })
    expect(j.sourceContent).toEqual({ name: 'Original Name', summary: 'Original Summary' })
    expect(mocks.translateAnime).toHaveBeenCalledWith('anime-1', 'en')
  })

  it('returns preview for city translation', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.translateCity.mockResolvedValue({
      success: true,
      sourceContent: { name: 'Tokyo', description: 'Capital', transportTips: 'Use metro' },
      translatedContent: { name: 'Tokyo EN', description: 'Capital EN', transportTips: 'Use metro EN' },
    })

    const handlers = await import('app/api/admin/retranslate/route')
    const res = await handlers.POST(
      jsonReq('http://localhost/api/admin/retranslate', 'POST', {
        entityType: 'city',
        entityId: 'city-1',
        targetLang: 'en',
      })
    )

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.preview).toEqual({ name: 'Tokyo EN', description: 'Capital EN', transportTips: 'Use metro EN' })
  })

  it('returns preview for article translation', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.translateArticle.mockResolvedValue({
      success: true,
      sourceContent: { title: 'Original Title', description: 'Original Desc', contentJson: {} },
      translatedContent: { title: 'Translated Title', description: 'Translated Desc', contentJson: {} },
    })

    const handlers = await import('app/api/admin/retranslate/route')
    const res = await handlers.POST(
      jsonReq('http://localhost/api/admin/retranslate', 'POST', {
        entityType: 'article',
        entityId: 'article-1',
        targetLang: 'ja',
      })
    )

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.preview.title).toBe('Translated Title')
  })

  it('returns only specified field when field parameter provided', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.translateAnime.mockResolvedValue({
      success: true,
      sourceContent: { name: 'Original Name', summary: 'Original Summary' },
      translatedContent: { name: 'Translated Name', summary: 'Translated Summary' },
    })

    const handlers = await import('app/api/admin/retranslate/route')
    const res = await handlers.POST(
      jsonReq('http://localhost/api/admin/retranslate', 'POST', {
        entityType: 'anime',
        entityId: 'anime-1',
        targetLang: 'en',
        field: 'name',
      })
    )

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.preview).toEqual({ name: 'Translated Name' })
    expect(j.preview.summary).toBeUndefined()
  })

  it('returns 400 for invalid entityType', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const handlers = await import('app/api/admin/retranslate/route')
    const res = await handlers.POST(
      jsonReq('http://localhost/api/admin/retranslate', 'POST', {
        entityType: 'invalid',
        entityId: 'id-1',
        targetLang: 'en',
      })
    )

    expect(res.status).toBe(400)
  })

  it('returns 403 for non-admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const handlers = await import('app/api/admin/retranslate/route')
    const res = await handlers.POST(
      jsonReq('http://localhost/api/admin/retranslate', 'POST', {
        entityType: 'anime',
        entityId: 'anime-1',
        targetLang: 'en',
      })
    )

    expect(res.status).toBe(403)
    expect(mocks.translateAnime).not.toHaveBeenCalled()
  })

  it('returns 500 when translation fails', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.translateAnime.mockResolvedValue({
      success: false,
      error: 'Translation service unavailable',
    })

    const handlers = await import('app/api/admin/retranslate/route')
    const res = await handlers.POST(
      jsonReq('http://localhost/api/admin/retranslate', 'POST', {
        entityType: 'anime',
        entityId: 'anime-1',
        targetLang: 'en',
      })
    )

    expect(res.status).toBe(500)
    const j = await res.json()
    expect(j.error).toBe('Translation service unavailable')
  })
})

describe('admin retranslate api - apply', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('applies anime translation', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.anime.update.mockResolvedValue({
      id: 'anime-1',
      name: 'Applied Name',
      summary: 'Applied Summary',
    })

    const handlers = await import('app/api/admin/retranslate/apply/route')
    const res = await handlers.POST(
      jsonReq('http://localhost/api/admin/retranslate/apply', 'POST', {
        entityType: 'anime',
        entityId: 'anime-1',
        targetLang: 'en',
        preview: { name: 'Applied Name', summary: 'Applied Summary' },
      })
    )

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.updated.name).toBe('Applied Name')
    expect(mocks.prisma.anime.update).toHaveBeenCalledWith({
      where: { id: 'anime-1' },
      data: { name_en: 'Applied Name', summary_en: 'Applied Summary' },
    })
  })

  it('applies city translation to correct language fields', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.city.update.mockResolvedValue({
      id: 'city-1',
      name_en: 'Tokyo EN',
      description_en: 'Capital EN',
    })

    const handlers = await import('app/api/admin/retranslate/apply/route')
    const res = await handlers.POST(
      jsonReq('http://localhost/api/admin/retranslate/apply', 'POST', {
        entityType: 'city',
        entityId: 'city-1',
        targetLang: 'en',
        preview: { name: 'Tokyo EN', description: 'Capital EN' },
      })
    )

    expect(res.status).toBe(200)
    expect(mocks.prisma.city.update).toHaveBeenCalledWith({
      where: { id: 'city-1' },
      data: { name_en: 'Tokyo EN', description_en: 'Capital EN' },
    })
  })

  it('applies article translation', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.translationTask.update.mockResolvedValue({
      id: 'task-1',
      draftContent: { title: 'Applied Title', description: 'Applied Desc' },
    })

    const handlers = await import('app/api/admin/retranslate/apply/route')
    const res = await handlers.POST(
      jsonReq('http://localhost/api/admin/retranslate/apply', 'POST', {
        entityType: 'article',
        entityId: 'article-1',
        targetLang: 'en',
        translationTaskId: 'task-1',
        preview: { title: 'Applied Title', description: 'Applied Desc' },
      })
    )

    expect(res.status).toBe(200)
    expect(mocks.prisma.translationTask.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({
        draftContent: { title: 'Applied Title', description: 'Applied Desc' },
        updatedAt: expect.any(Date),
      }),
    })
  })

  it('returns 403 for non-admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const handlers = await import('app/api/admin/retranslate/apply/route')
    const res = await handlers.POST(
      jsonReq('http://localhost/api/admin/retranslate/apply', 'POST', {
        entityType: 'anime',
        entityId: 'anime-1',
        targetLang: 'en',
        preview: { name: 'Test' },
      })
    )

    expect(res.status).toBe(403)
    expect(mocks.prisma.anime.update).not.toHaveBeenCalled()
  })

  it('returns 404 when entity not found', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.anime.update.mockRejectedValue(new Error('Record to update not found'))

    const handlers = await import('app/api/admin/retranslate/apply/route')
    const res = await handlers.POST(
      jsonReq('http://localhost/api/admin/retranslate/apply', 'POST', {
        entityType: 'anime',
        entityId: 'nonexistent',
        targetLang: 'en',
        preview: { name: 'Test' },
      })
    )

    expect(res.status).toBe(404)
  })
})
