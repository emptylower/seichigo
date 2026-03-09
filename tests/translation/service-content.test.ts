import { beforeEach, describe, expect, it, vi } from 'vitest'
import { translateArticle, translateAnime, translateCity } from '@/lib/translation/service'
import * as gemini from '@/lib/translation/gemini'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    article: {
      findUnique: vi.fn(),
    },
    city: {
      findUnique: vi.fn(),
    },
    anime: {
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'

describe('Translation Service', () => {
  describe('translateArticle sourceContent', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should return sourceContent with original article data', async () => {
      const mockArticle = {
        id: 'article-1',
        title: '测试标题',
        description: '测试描述',
        seoTitle: 'SEO标题',
        contentJson: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '内容' }] }],
        },
      }

      vi.spyOn(prisma.article, 'findUnique').mockResolvedValue(mockArticle as any)
      vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)
      vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) {
          result.set(text, `translated_${text}`)
        }
        return result
      })

      const result = await translateArticle('article-1', 'en')

      expect(result.success).toBe(true)
      expect(result.sourceContent).toEqual({
        title: '测试标题',
        description: '测试描述',
        seoTitle: 'SEO标题',
        contentJson: mockArticle.contentJson,
      })
      expect(result.translatedContent).toBeDefined()
      expect(result.translatedContent.title).toBe('translated_测试标题')
    })

    it('should preserve cover and metadata fields in both sourceContent and translatedContent', async () => {
      const mockArticle = {
        id: 'article-meta-1',
        title: '测试标题',
        description: '测试描述',
        seoTitle: 'SEO标题',
        contentJson: { type: 'doc', content: [] },
        cover: '/images/test-cover.jpg',
        animeIds: ['anime-1', 'anime-2'],
        city: 'tokyo',
        routeLength: '5km',
        tags: ['tag1', 'tag2'],
      }

      vi.spyOn(prisma.article, 'findUnique').mockResolvedValue(mockArticle as any)
      vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const result = await translateArticle('article-meta-1', 'en')

      expect(result.success).toBe(true)
      expect(result.sourceContent).toMatchObject({
        title: '测试标题',
        description: '测试描述',
        seoTitle: 'SEO标题',
        cover: '/images/test-cover.jpg',
        animeIds: ['anime-1', 'anime-2'],
        city: 'tokyo',
        routeLength: '5km',
        tags: ['tag1', 'tag2'],
      })
      expect(result.translatedContent).toMatchObject({
        title: 'translated_测试标题',
        description: 'translated_测试描述',
        seoTitle: 'translated_SEO标题',
        cover: '/images/test-cover.jpg',
        animeIds: ['anime-1', 'anime-2'],
        city: 'tokyo',
        routeLength: '5km',
        tags: ['tag1', 'tag2'],
      })
    })

    it('should handle null optional fields in sourceContent', async () => {
      const mockArticle = {
        id: 'article-2',
        title: '标题',
        description: null,
        seoTitle: null,
        contentJson: null,
      }

      vi.spyOn(prisma.article, 'findUnique').mockResolvedValue(mockArticle as any)
      vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const result = await translateArticle('article-2', 'en')

      expect(result.success).toBe(true)
      expect(result.sourceContent).toEqual({
        title: '标题',
        description: null,
        seoTitle: null,
        contentJson: null,
      })
      expect(result.translatedContent.description).toBe(null)
      expect(result.translatedContent.seoTitle).toBe(null)
    })

    it('should handle null/undefined metadata fields gracefully', async () => {
      const mockArticle = {
        id: 'article-null-meta',
        title: '最小文章',
        description: null,
        seoTitle: null,
        contentJson: null,
        cover: null,
        animeIds: [],
        city: null,
        routeLength: null,
        tags: [],
      }

      vi.spyOn(prisma.article, 'findUnique').mockResolvedValue(mockArticle as any)
      vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const result = await translateArticle('article-null-meta', 'en')

      expect(result.success).toBe(true)
      expect(result.sourceContent?.cover).toBeNull()
      expect(result.translatedContent?.cover).toBeNull()
      expect(result.translatedContent?.animeIds).toEqual([])
      expect(result.translatedContent?.tags).toEqual([])
      expect(result.translatedContent?.city).toBeNull()
      expect(result.translatedContent?.routeLength).toBeNull()
    })
  })

  describe('translateCity sourceContent', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should return sourceContent with original city data', async () => {
      const mockCity = {
        id: 'city-1',
        name_zh: '东京',
        description_zh: '日本首都',
        transportTips_zh: '交通提示',
      }

      vi.spyOn(prisma.city, 'findUnique').mockResolvedValue(mockCity as any)
      vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const result = await translateCity('city-1', 'en')

      expect(result.success).toBe(true)
      expect(result.sourceContent).toEqual({
        name: '东京',
        description: '日本首都',
        transportTips: '交通提示',
      })
      expect(result.translatedContent).toBeDefined()
      expect(result.translatedContent.name).toBe('translated_东京')
    })
  })

  describe('translateAnime sourceContent', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should return sourceContent with original anime data', async () => {
      const mockAnime = {
        id: 'anime-1',
        name: '你的名字',
        summary: '动画简介',
      }

      vi.spyOn(prisma.anime, 'findUnique').mockResolvedValue(mockAnime as any)
      vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const result = await translateAnime('anime-1', 'en')

      expect(result.success).toBe(true)
      expect(result.sourceContent).toEqual({
        name: '你的名字',
        summary: '动画简介',
      })
      expect(result.translatedContent).toBeDefined()
      expect(result.translatedContent.name).toBe('translated_你的名字')
    })
  })

  describe('translateArticle - seichiRoute embed translation', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should translate seichiRoute embed data in article content', async () => {
      const mockArticle = {
        id: 'article-route-1',
        title: '测试路线文章',
        description: '包含路线的文章',
        seoTitle: 'SEO路线标题',
        contentJson: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '文章开头' }] },
            {
              type: 'seichiRoute',
              attrs: {
                id: 'r1',
                data: {
                  version: 1,
                  title: '东京动漫巡礼路线',
                  spots: [
                    {
                      id: 's1',
                      name_zh: '新宿站',
                      lat: 35.6896,
                      lng: 139.7006,
                      nearestStation_zh: '新宿站',
                      photoTip: '最佳拍摄时间是早上',
                      note: '注意人流量',
                      animeScene: '你的名字场景',
                      googleMapsUrl: 'https://maps.google.com/?q=35.6896,139.7006',
                    },
                    {
                      id: 's2',
                      name_zh: '涩谷站',
                      lat: 35.658,
                      lng: 139.7016,
                      nearestStation_zh: '涩谷站',
                      photoTip: '傍晚光线最好',
                      note: '周末人多',
                      animeScene: '天气之子场景',
                      googleMapsUrl: 'https://maps.google.com/?q=35.6580,139.7016',
                    },
                  ],
                },
              },
            },
            { type: 'paragraph', content: [{ type: 'text', text: '文章结尾' }] },
          ],
        },
      }

      vi.spyOn(prisma.article, 'findUnique').mockResolvedValue(mockArticle as any)
      vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) {
          result.set(text, `translated_${text}`)
        }
        return result
      })

      const result = await translateArticle('article-route-1', 'en')

      expect(result.success).toBe(true)
      expect(result.translatedContent).toBeDefined()

      const translatedContent = result.translatedContent.contentJson
      expect(translatedContent.content[0].content[0].text).toBe('translated_文章开头')
      expect(translatedContent.content[2].content[0].text).toBe('translated_文章结尾')

      const routeNode = translatedContent.content[1]
      expect(routeNode.type).toBe('seichiRoute')
      expect(routeNode.attrs.id).toBe('r1')
      expect(routeNode.attrs.data.version).toBe(1)
      expect(routeNode.attrs.data.title).toBe('translated_东京动漫巡礼路线')

      const spot1 = routeNode.attrs.data.spots[0]
      expect(spot1.name_zh).toBe('translated_新宿站')
      expect(spot1.nearestStation_zh).toBe('translated_新宿站')
      expect(spot1.photoTip).toBe('translated_最佳拍摄时间是早上')
      expect(spot1.note).toBe('translated_注意人流量')
      expect(spot1.animeScene).toBe('translated_你的名字场景')

      const spot2 = routeNode.attrs.data.spots[1]
      expect(spot2.name_zh).toBe('translated_涩谷站')
      expect(spot2.nearestStation_zh).toBe('translated_涩谷站')
      expect(spot2.photoTip).toBe('translated_傍晚光线最好')
      expect(spot2.note).toBe('translated_周末人多')
      expect(spot2.animeScene).toBe('translated_天气之子场景')

      expect(spot1.id).toBe('s1')
      expect(spot1.lat).toBe(35.6896)
      expect(spot1.lng).toBe(139.7006)
      expect(spot1.googleMapsUrl).toBe('https://maps.google.com/?q=35.6896,139.7006')
      expect(spot2.id).toBe('s2')
      expect(spot2.lat).toBe(35.658)
      expect(spot2.lng).toBe(139.7016)
      expect(spot2.googleMapsUrl).toBe('https://maps.google.com/?q=35.6580,139.7016')
    })
  })
})
