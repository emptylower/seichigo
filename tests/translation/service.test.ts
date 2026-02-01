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

      const translateTextBatchSpy = vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) {
          result.set(text, `translated_${text}`)
        }
        return result
      })

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      expect(translateTextBatchSpy).toHaveBeenCalledTimes(1)
      expect(translateTextBatchSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['你好世界', '这是测试']),
        'en'
      )
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

      const translateTextBatchSpy = vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) {
          result.set(text, `translated_${text}`)
        }
        return result
      })

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      // Should only be called once for the normal text
      expect(translateTextBatchSpy).toHaveBeenCalledTimes(1)
      expect(translateTextBatchSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['正常文本']),
        'en'
      )
      
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

      const translateTextBatchSpy = vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) {
          result.set(text, `translated_${text}`)
        }
        return result
      })

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      // Should only be called once for the normal text
      expect(translateTextBatchSpy).toHaveBeenCalledTimes(1)
      expect(translateTextBatchSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['正常文本']),
        'en'
      )
      
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

      const translateTextBatchSpy = vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) {
          result.set(text, `translated_${text}`)
        }
        return result
      })

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      // All single Chinese characters should be translated in one batch
      expect(translateTextBatchSpy).toHaveBeenCalledTimes(1)
      expect(translateTextBatchSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['是', '的', '了', '我']),
        'en'
      )
      
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

      const translateTextBatchSpy = vi.spyOn(gemini, 'translateTextBatch')
        .mockRejectedValue(new Error('API failure'))

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      // Batch call should have been attempted once
      expect(translateTextBatchSpy).toHaveBeenCalledTimes(1)
      expect(translateTextBatchSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['第一段', '会失败', '第三段']),
        'en'
      )
      
      // All texts should keep original on batch failure
      expect(result.content?.[0].content?.[0].text).toBe('第一段')
      expect(result.content?.[0].content?.[1].text).toBe('会失败')
      expect(result.content?.[0].content?.[2].text).toBe('第三段')
      
      // Error should have been logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[translateTipTapContent]'),
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

      const translateTextBatchSpy = vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) {
          result.set(text, `translated_${text}`)
        }
        return result
      })

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      // Only normal text should be translated in one batch
      expect(translateTextBatchSpy).toHaveBeenCalledTimes(1)
      expect(translateTextBatchSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['你好', '世界']),
        'en'
      )
      
      expect(result.content?.[0].content?.[0].text).toBe('translated_你好')
      expect(result.content?.[0].content?.[1].text).toBe('。')
      expect(result.content?.[0].content?.[2].text).toBe('   ')
      expect(result.content?.[0].content?.[3].text).toBe('translated_世界')
      expect(result.content?.[0].content?.[4].text).toBe('！')
    })
  })

  describe('translateTipTapContent - batch translation', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('batch reduces API calls', async () => {
      // Mock translateTextBatch to track calls
      const batchSpy = vi.spyOn(gemini, 'translateTextBatch')
        .mockImplementation(async (texts: string[]) => {
          const result = new Map<string, string>()
          for (const text of texts) {
            result.set(text, `translated_${text}`)
          }
          return result
        })
      
      // Create document with 50 text nodes
      const doc: TipTapNode = {
        type: 'doc',
        content: Array.from({ length: 50 }, (_, i) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: `text${i}` }]
        }))
      }
      
      const { translateTipTapContent } = await import('@/lib/translation/service')
      await translateTipTapContent(doc, 'en')
      
      // Should call translateTextBatch ≤5 times (50 / 15 = ~4 batches)
      expect(batchSpy).toHaveBeenCalled()
      expect(batchSpy.mock.calls.length).toBeLessThanOrEqual(5)
      expect(batchSpy.mock.calls.length).toBeGreaterThan(0)
    })
    
    it('batch handles JSON parse failure gracefully', async () => {
      const batchSpy = vi.spyOn(gemini, 'translateTextBatch')
        .mockRejectedValueOnce(new Error('JSON parse error'))
      
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'original' }] }
        ]
      }
      
      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')
      
      // Should keep original text on failure
      expect(result.content?.[0].content?.[0].text).toBe('original')
      
      // Error should have been logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[translateTipTapContent]'),
        expect.any(Error)
      )
      
      consoleErrorSpy.mockRestore()
    })
    
    it('batch preserves glossary terms', async () => {
      // Mock translateTextBatch to simulate glossary term preservation
      // The actual glossary protection happens in translateTextBatch, 
      // so we verify the batch function is called with the right texts
      const batchSpy = vi.spyOn(gemini, 'translateTextBatch')
        .mockImplementation(async (texts: string[]) => {
          const result = new Map<string, string>()
          for (const text of texts) {
            // Simulate glossary term preservation ({{TERM_N}} placeholders)
            result.set(text, `translated_${text}`)
          }
          return result
        })
      
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'text with terms' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'another text' }] }
        ]
      }
      
      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')
      
      // Verify batch was called with the texts
      expect(batchSpy).toHaveBeenCalledTimes(1)
      expect(batchSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['text with terms', 'another text']),
        'en'
      )
      
      // Verify translations were applied
      expect(result.content?.[0].content?.[0].text).toBe('translated_text with terms')
      expect(result.content?.[1].content?.[0].text).toBe('translated_another text')
    })
    
    it('batch respects character limit', async () => {
      const batchSpy = vi.spyOn(gemini, 'translateTextBatch')
        .mockImplementation(async (texts: string[]) => {
          const result = new Map<string, string>()
          for (const text of texts) {
            result.set(text, `translated_${text}`)
          }
          return result
        })
      
      // Create texts that exceed MAX_BATCH_CHARS (3000) when combined
      // Each text is 1600 chars, so 2 texts = 3200 chars (exceeds 3000)
      const longText1 = 'a'.repeat(1600)
      const longText2 = 'b'.repeat(1600)
      const longText3 = 'c'.repeat(1600)
      
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: longText1 }] },
          { type: 'paragraph', content: [{ type: 'text', text: longText2 }] },
          { type: 'paragraph', content: [{ type: 'text', text: longText3 }] }
        ]
      }
      
      const { translateTipTapContent } = await import('@/lib/translation/service')
      await translateTipTapContent(doc, 'en')
      
      // Should split into multiple batches due to character limit
      // First text (1600) fits, second text would make 3200 > 3000, so splits into 2+ batches
      expect(batchSpy).toHaveBeenCalled()
      expect(batchSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
      
      // Verify each batch respects the character limit
      for (const call of batchSpy.mock.calls) {
        const texts = call[0] as string[]
        const totalChars = texts.reduce((sum, text) => sum + text.length, 0)
        expect(totalChars).toBeLessThanOrEqual(3000)
      }
    })
  })
})
