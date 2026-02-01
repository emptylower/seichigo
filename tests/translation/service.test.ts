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

  describe('translateTipTapContent', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should translate normal text nodes', async () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '你好世界' },
              { type: 'text', text: '这是测试' }
            ]
          }
        ]
      }

      const translateTextSpy = vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      expect(translateTextSpy).toHaveBeenCalledWith('你好世界', 'en')
      expect(translateTextSpy).toHaveBeenCalledWith('这是测试', 'en')
      expect(result.content?.[0].content?.[0].text).toBe('translated_你好世界')
      expect(result.content?.[0].content?.[1].text).toBe('translated_这是测试')
    })

    it('should skip empty and whitespace-only nodes', async () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '' },
              { type: 'text', text: '   ' },
              { type: 'text', text: '\n\t  ' },
              { type: 'text', text: '正常文本' }
            ]
          }
        ]
      }

      const translateTextSpy = vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      // Should only be called once for the normal text
      expect(translateTextSpy).toHaveBeenCalledTimes(1)
      expect(translateTextSpy).toHaveBeenCalledWith('正常文本', 'en')
      expect(translateTextSpy).not.toHaveBeenCalledWith('', expect.any(String))
      expect(translateTextSpy).not.toHaveBeenCalledWith('   ', expect.any(String))
      expect(translateTextSpy).not.toHaveBeenCalledWith('\n\t  ', expect.any(String))
      
      // Empty/whitespace nodes should remain unchanged
      expect(result.content?.[0].content?.[0].text).toBe('')
      expect(result.content?.[0].content?.[1].text).toBe('   ')
      expect(result.content?.[0].content?.[2].text).toBe('\n\t  ')
      expect(result.content?.[0].content?.[3].text).toBe('translated_正常文本')
    })

    it('should skip punctuation-only nodes', async () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '。' },
              { type: 'text', text: '！' },
              { type: 'text', text: '、' },
              { type: 'text', text: '「」' },
              { type: 'text', text: ' -> ' },
              { type: 'text', text: ']' },
              { type: 'text', text: '正常文本' }
            ]
          }
        ]
      }

      const translateTextSpy = vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      // Should only be called once for the normal text
      expect(translateTextSpy).toHaveBeenCalledTimes(1)
      expect(translateTextSpy).toHaveBeenCalledWith('正常文本', 'en')
      expect(translateTextSpy).not.toHaveBeenCalledWith('。', expect.any(String))
      expect(translateTextSpy).not.toHaveBeenCalledWith('！', expect.any(String))
      expect(translateTextSpy).not.toHaveBeenCalledWith('、', expect.any(String))
      expect(translateTextSpy).not.toHaveBeenCalledWith('「」', expect.any(String))
      expect(translateTextSpy).not.toHaveBeenCalledWith(' -> ', expect.any(String))
      expect(translateTextSpy).not.toHaveBeenCalledWith(']', expect.any(String))
      
      // Punctuation nodes should remain unchanged
      expect(result.content?.[0].content?.[0].text).toBe('。')
      expect(result.content?.[0].content?.[1].text).toBe('！')
      expect(result.content?.[0].content?.[6].text).toBe('translated_正常文本')
    })

    it('should translate single Chinese characters', async () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '是' },
              { type: 'text', text: '的' },
              { type: 'text', text: '了' },
              { type: 'text', text: '我' }
            ]
          }
        ]
      }

      const translateTextSpy = vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      // All single Chinese characters should be translated
      expect(translateTextSpy).toHaveBeenCalledTimes(4)
      expect(translateTextSpy).toHaveBeenCalledWith('是', 'en')
      expect(translateTextSpy).toHaveBeenCalledWith('的', 'en')
      expect(translateTextSpy).toHaveBeenCalledWith('了', 'en')
      expect(translateTextSpy).toHaveBeenCalledWith('我', 'en')
      
      expect(result.content?.[0].content?.[0].text).toBe('translated_是')
      expect(result.content?.[0].content?.[1].text).toBe('translated_的')
      expect(result.content?.[0].content?.[2].text).toBe('translated_了')
      expect(result.content?.[0].content?.[3].text).toBe('translated_我')
    })

    it('should continue on API failure and keep original text', async () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '第一段' },
              { type: 'text', text: '会失败' },
              { type: 'text', text: '第三段' }
            ]
          }
        ]
      }

      const translateTextSpy = vi.spyOn(gemini, 'translateText')
        .mockImplementationOnce(async (text: string) => `translated_${text}`)
        .mockImplementationOnce(async () => {
          throw new Error('API failure')
        })
        .mockImplementationOnce(async (text: string) => `translated_${text}`)

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      // All three nodes should have been attempted
      expect(translateTextSpy).toHaveBeenCalledTimes(3)
      expect(translateTextSpy).toHaveBeenCalledWith('第一段', 'en')
      expect(translateTextSpy).toHaveBeenCalledWith('会失败', 'en')
      expect(translateTextSpy).toHaveBeenCalledWith('第三段', 'en')
      
      // First and third should be translated, second should keep original
      expect(result.content?.[0].content?.[0].text).toBe('translated_第一段')
      expect(result.content?.[0].content?.[1].text).toBe('会失败')
      expect(result.content?.[0].content?.[2].text).toBe('translated_第三段')
      
      // Error should have been logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[translateTipTapContent] Failed to translate node:'),
        expect.any(Error)
      )

      consoleErrorSpy.mockRestore()
    })

    it('should handle mixed content with filters and translations', async () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '你好' },
              { type: 'text', text: '。' },
              { type: 'text', text: '   ' },
              { type: 'text', text: '世界' },
              { type: 'text', text: '！' }
            ]
          }
        ]
      }

      const translateTextSpy = vi.spyOn(gemini, 'translateText').mockImplementation(async (text: string) => `translated_${text}`)

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      // Only normal text should be translated
      expect(translateTextSpy).toHaveBeenCalledTimes(2)
      expect(translateTextSpy).toHaveBeenCalledWith('你好', 'en')
      expect(translateTextSpy).toHaveBeenCalledWith('世界', 'en')
      
      expect(result.content?.[0].content?.[0].text).toBe('translated_你好')
      expect(result.content?.[0].content?.[1].text).toBe('。')
      expect(result.content?.[0].content?.[2].text).toBe('   ')
      expect(result.content?.[0].content?.[3].text).toBe('translated_世界')
      expect(result.content?.[0].content?.[4].text).toBe('！')
    })
  })
})
