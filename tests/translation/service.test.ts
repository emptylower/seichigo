import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractTextNodes, replaceTextNodes } from '@/lib/translation/tiptap'
import { translateArticle, translateCity, translateAnime } from '@/lib/translation/service'
import * as gemini from '@/lib/translation/gemini'

// Mock prisma module
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    article: {
      findUnique: vi.fn()
    },
    city: {
      findUnique: vi.fn()
    },
    anime: {
      findUnique: vi.fn()
    }
  }
}))

import { prisma } from '@/lib/db/prisma'

type TipTapNode = {
  type: string
  content?: TipTapNode[]
  text?: string
  [key: string]: any
}

describe('Translation Service', () => {

  describe('extractTextNodes', () => {
    it('should extract all text from TipTap JSON', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '你好' }] }
        ]
      }
      const texts = extractTextNodes(doc)
      expect(texts).toEqual(['你好'])
    })

    it('should extract text from nested structures', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '第一段' },
              { type: 'text', text: '第二段' }
            ]
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '第三段' }]
          }
        ]
      }
      const texts = extractTextNodes(doc)
      expect(texts).toEqual(['第一段', '第二段', '第三段'])
    })
  })

  describe('replaceTextNodes', () => {
    it('should preserve structure while replacing text', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '你好' }] }
        ]
      }
      const translations = new Map([['你好', 'hello']])
      const result = replaceTextNodes(doc, translations)
      expect(result.content?.[0].content?.[0].text).toBe('hello')
      expect(result.type).toBe('doc')
    })

    it('should preserve marks and attributes', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '粗体',
                marks: [{ type: 'bold' }]
              }
            ]
          }
        ]
      }
      const translations = new Map([['粗体', 'bold']])
      const result = replaceTextNodes(doc, translations)
      expect(result.content?.[0].content?.[0].marks).toEqual([{ type: 'bold' }])
    })
  })

  describe('glossary protection', () => {
    it.skip('should use predefined translations for glossary terms', async () => {
      // Skipped: Requires GEMINI_API_KEY for integration test
    })
  })

  describe('error handling', () => {
    it.skip('should throw clear error on API failure', async () => {
      // Skipped: Requires GEMINI_API_KEY for integration test
    })
  })

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
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '内容' }] }
          ]
        }
      }

      vi.spyOn(prisma.article, 'findUnique').mockResolvedValue(mockArticle as any)
      vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const result = await translateArticle('article-1', 'en')

      expect(result.success).toBe(true)
      expect(result.sourceContent).toEqual({
        title: '测试标题',
        description: '测试描述',
        seoTitle: 'SEO标题',
        contentJson: mockArticle.contentJson
      })
      expect(result.translatedContent).toBeDefined()
      expect(result.translatedContent.title).toBe('translated_测试标题')
    })

    it('should handle null optional fields in sourceContent', async () => {
      const mockArticle = {
        id: 'article-2',
        title: '标题',
        description: null,
        seoTitle: null,
        contentJson: null
      }

      vi.spyOn(prisma.article, 'findUnique').mockResolvedValue(mockArticle as any)
      vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const result = await translateArticle('article-2', 'en')

      expect(result.success).toBe(true)
      expect(result.sourceContent).toEqual({
        title: '标题',
        description: null,
        seoTitle: null,
        contentJson: null
      })
      expect(result.translatedContent.description).toBe(null)
      expect(result.translatedContent.seoTitle).toBe(null)
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
        transportTips_zh: '交通提示'
      }

      vi.spyOn(prisma.city, 'findUnique').mockResolvedValue(mockCity as any)
      vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const result = await translateCity('city-1', 'en')

      expect(result.success).toBe(true)
      expect(result.sourceContent).toEqual({
        name: '东京',
        description: '日本首都',
        transportTips: '交通提示'
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
        summary: '动画简介'
      }

      vi.spyOn(prisma.anime, 'findUnique').mockResolvedValue(mockAnime as any)
      vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const result = await translateAnime('anime-1', 'en')

      expect(result.success).toBe(true)
      expect(result.sourceContent).toEqual({
        name: '你的名字',
        summary: '动画简介'
      })
      expect(result.translatedContent).toBeDefined()
      expect(result.translatedContent.name).toBe('translated_你的名字')
    })
  })
})
