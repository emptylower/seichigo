import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  translateText: vi.fn(),
}))

vi.mock('@/lib/translation/gemini', () => ({
  translateText: (...args: any[]) => mocks.translateText(...args),
}))

function createPrismaMock() {
  return {
    queryTranslationCache: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  }
}

describe('Query translation cache for cross-language search', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('First query calls Gemini and writes cache', async () => {
    const prisma = createPrismaMock()
    prisma.queryTranslationCache.findUnique.mockResolvedValue(null)
    prisma.queryTranslationCache.upsert.mockResolvedValue({
      id: 'cache-1',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      sourceText: 'Hyouka',
      translatedText: '氷菓',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    mocks.translateText.mockResolvedValue('氷菓')

    const { translateQueryWithCache } = await import('@/lib/anitabi/queryTranslation')
    const result = await translateQueryWithCache({
      prisma: prisma as any,
      query: 'Hyouka',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
    })

    expect(result).toBe('氷菓')
    expect(mocks.translateText).toHaveBeenCalledWith('Hyouka', 'en', 'ja')
    expect(prisma.queryTranslationCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceLanguage_targetLanguage_sourceText: {
            sourceLanguage: 'en',
            targetLanguage: 'ja',
            sourceText: 'Hyouka',
          },
        }),
        create: expect.objectContaining({
          sourceLanguage: 'en',
          targetLanguage: 'ja',
          sourceText: 'Hyouka',
          translatedText: '氷菓',
        }),
      })
    )
  })

  it('Second query uses cache hit, no Gemini call', async () => {
    const prisma = createPrismaMock()
    const cachedEntry = {
      id: 'cache-1',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      sourceText: 'Hyouka',
      translatedText: '氷菓',
      createdAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }
    prisma.queryTranslationCache.findUnique.mockResolvedValue(cachedEntry)

    const { translateQueryWithCache } = await import('@/lib/anitabi/queryTranslation')
    const result = await translateQueryWithCache({
      prisma: prisma as any,
      query: 'Hyouka',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
    })

    expect(result).toBe('氷菓')
    expect(mocks.translateText).not.toHaveBeenCalled()
    expect(prisma.queryTranslationCache.upsert).not.toHaveBeenCalled()
  })

  it('Cache expiry triggers re-translation', async () => {
    const prisma = createPrismaMock()
    const expiredEntry = {
      id: 'cache-1',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      sourceText: 'Hyouka',
      translatedText: '氷菓',
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1000), // Expired
    }
    prisma.queryTranslationCache.findUnique.mockResolvedValue(expiredEntry)
    prisma.queryTranslationCache.upsert.mockResolvedValue({
      ...expiredEntry,
      translatedText: '氷菓 (updated)',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    mocks.translateText.mockResolvedValue('氷菓 (updated)')

    const { translateQueryWithCache } = await import('@/lib/anitabi/queryTranslation')
    const result = await translateQueryWithCache({
      prisma: prisma as any,
      query: 'Hyouka',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
    })

    expect(result).toBe('氷菓 (updated)')
    expect(mocks.translateText).toHaveBeenCalledWith('Hyouka', 'en', 'ja')
    expect(prisma.queryTranslationCache.upsert).toHaveBeenCalled()
  })

  it('Gemini failure falls back to original query', async () => {
    const prisma = createPrismaMock()
    prisma.queryTranslationCache.findUnique.mockResolvedValue(null)
    mocks.translateText.mockRejectedValue(new Error('Gemini quota exceeded'))

    const { translateQueryWithCache } = await import('@/lib/anitabi/queryTranslation')
    const result = await translateQueryWithCache({
      prisma: prisma as any,
      query: 'Hyouka',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
    })

    // Should fall back to original query
    expect(result).toBe('Hyouka')
    expect(mocks.translateText).toHaveBeenCalled()
    expect(prisma.queryTranslationCache.upsert).not.toHaveBeenCalled()
  })

  it('Cache TTL is 7 days by default', async () => {
    const prisma = createPrismaMock()
    prisma.queryTranslationCache.findUnique.mockResolvedValue(null)
    
    const now = Date.now()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    
    prisma.queryTranslationCache.upsert.mockImplementation((args: any) => {
      const expiresAt = args.create.expiresAt
      const ttl = expiresAt.getTime() - now
      
      // Allow 1 second tolerance for test execution time
      expect(ttl).toBeGreaterThanOrEqual(sevenDaysMs - 1000)
      expect(ttl).toBeLessThanOrEqual(sevenDaysMs + 1000)
      
      return Promise.resolve({
        id: 'cache-1',
        ...args.create,
      })
    })

    mocks.translateText.mockResolvedValue('氷菓')

    const { translateQueryWithCache } = await import('@/lib/anitabi/queryTranslation')
    await translateQueryWithCache({
      prisma: prisma as any,
      query: 'Hyouka',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
    })

    expect(prisma.queryTranslationCache.upsert).toHaveBeenCalled()
  })

  it('Different source/target language pairs are cached separately', async () => {
    const prisma = createPrismaMock()
    prisma.queryTranslationCache.findUnique.mockResolvedValue(null)
    prisma.queryTranslationCache.upsert.mockResolvedValue({
      id: 'cache-1',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      sourceText: 'Hyouka',
      translatedText: '冰菓',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    mocks.translateText.mockResolvedValue('冰菓')

    const { translateQueryWithCache } = await import('@/lib/anitabi/queryTranslation')
    await translateQueryWithCache({
      prisma: prisma as any,
      query: 'Hyouka',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
    })

    expect(prisma.queryTranslationCache.findUnique).toHaveBeenCalledWith({
      where: {
        sourceLanguage_targetLanguage_sourceText: {
          sourceLanguage: 'en',
          targetLanguage: 'zh',
          sourceText: 'Hyouka',
        },
      },
    })
  })

  it('Case-insensitive query normalization for cache lookup', async () => {
    const prisma = createPrismaMock()
    const cachedEntry = {
      id: 'cache-1',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      sourceText: 'hyouka', // lowercase in cache
      translatedText: '氷菓',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }
    prisma.queryTranslationCache.findUnique.mockResolvedValue(cachedEntry)

    const { translateQueryWithCache } = await import('@/lib/anitabi/queryTranslation')
    const result = await translateQueryWithCache({
      prisma: prisma as any,
      query: 'HYOUKA', // uppercase query
      sourceLanguage: 'en',
      targetLanguage: 'ja',
    })

    expect(result).toBe('氷菓')
    expect(mocks.translateText).not.toHaveBeenCalled()
  })
})
