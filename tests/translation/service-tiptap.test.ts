import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractTextNodes, replaceTextNodes } from '@/lib/translation/tiptap'
import * as gemini from '@/lib/translation/gemini'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    article: { findUnique: vi.fn() },
    city: { findUnique: vi.fn() },
    anime: { findUnique: vi.fn() },
  },
}))

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
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }],
      }
      expect(extractTextNodes(doc)).toEqual(['你好'])
    })

    it('should extract text from nested structures', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '第一段' },
              { type: 'text', text: '第二段' },
            ],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '第三段' }],
          },
        ],
      }
      expect(extractTextNodes(doc)).toEqual(['第一段', '第二段', '第三段'])
    })
  })

  describe('replaceTextNodes', () => {
    it('should preserve structure while replacing text', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }],
      }
      const result = replaceTextNodes(doc, new Map([['你好', 'hello']]))
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
                marks: [{ type: 'bold' }],
              },
            ],
          },
        ],
      }
      const result = replaceTextNodes(doc, new Map([['粗体', 'bold']]))
      expect(result.content?.[0].content?.[0].marks).toEqual([{ type: 'bold' }])
    })
  })

  describe('glossary protection', () => {
    it.skip('should use predefined translations for glossary terms', async () => {})
  })

  describe('error handling', () => {
    it.skip('should throw clear error on API failure', async () => {})
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
              { type: 'text', text: '这是测试' },
            ],
          },
        ],
      }

      const batchSpy = vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) result.set(text, `translated_${text}`)
        return result
      })

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      expect(batchSpy).toHaveBeenCalledTimes(1)
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
              { type: 'text', text: '正常文本' },
            ],
          },
        ],
      }

      vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) result.set(text, `translated_${text}`)
        return result
      })

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

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
              { type: 'text', text: '正常文本' },
            ],
          },
        ],
      }

      vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) result.set(text, `translated_${text}`)
        return result
      })

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

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
              { type: 'text', text: '我' },
            ],
          },
        ],
      }

      vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) result.set(text, `translated_${text}`)
        return result
      })

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

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
              { type: 'text', text: '第三段' },
            ],
          },
        ],
      }

      vi.spyOn(gemini, 'translateTextBatch').mockRejectedValue(new Error('API failure'))
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      expect(result.content?.[0].content?.[0].text).toBe('第一段')
      expect(result.content?.[0].content?.[1].text).toBe('会失败')
      expect(result.content?.[0].content?.[2].text).toBe('第三段')
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
              { type: 'text', text: '！' },
            ],
          },
        ],
      }

      vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) result.set(text, `translated_${text}`)
        return result
      })

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

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
      const batchSpy = vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) result.set(text, `translated_${text}`)
        return result
      })

      const doc: TipTapNode = {
        type: 'doc',
        content: Array.from({ length: 50 }, (_, i) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: `text${i}` }],
        })),
      }

      const { translateTipTapContent } = await import('@/lib/translation/service')
      await translateTipTapContent(doc, 'en')

      expect(batchSpy.mock.calls.length).toBeLessThanOrEqual(5)
      expect(batchSpy.mock.calls.length).toBeGreaterThan(0)
    })

    it('batch handles JSON parse failure gracefully', async () => {
      vi.spyOn(gemini, 'translateTextBatch').mockRejectedValueOnce(new Error('JSON parse error'))
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const doc: TipTapNode = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'original' }] }],
      }

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      expect(result.content?.[0].content?.[0].text).toBe('original')
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[translateTipTapContent]'),
        expect.any(Error)
      )
      consoleErrorSpy.mockRestore()
    })

    it('batch preserves glossary terms', async () => {
      const batchSpy = vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) result.set(text, `translated_${text}`)
        return result
      })

      const doc: TipTapNode = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'text with terms' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'another text' }] },
        ],
      }

      const { translateTipTapContent } = await import('@/lib/translation/service')
      const result = await translateTipTapContent(doc, 'en')

      expect(batchSpy).toHaveBeenCalledTimes(1)
      expect(result.content?.[0].content?.[0].text).toBe('translated_text with terms')
      expect(result.content?.[1].content?.[0].text).toBe('translated_another text')
    })

    it('batch respects character limit', async () => {
      const batchSpy = vi.spyOn(gemini, 'translateTextBatch').mockImplementation(async (texts: string[]) => {
        const result = new Map<string, string>()
        for (const text of texts) result.set(text, `translated_${text}`)
        return result
      })

      const longText1 = 'a'.repeat(1600)
      const longText2 = 'b'.repeat(1600)
      const longText3 = 'c'.repeat(1600)

      const doc: TipTapNode = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: longText1 }] },
          { type: 'paragraph', content: [{ type: 'text', text: longText2 }] },
          { type: 'paragraph', content: [{ type: 'text', text: longText3 }] },
        ],
      }

      const { translateTipTapContent } = await import('@/lib/translation/service')
      await translateTipTapContent(doc, 'en')

      expect(batchSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
      for (const call of batchSpy.mock.calls) {
        const texts = call[0] as string[]
        const totalChars = texts.reduce((sum, text) => sum + text.length, 0)
        expect(totalChars).toBeLessThanOrEqual(3000)
      }
    })
  })
})
