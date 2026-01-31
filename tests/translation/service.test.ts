import { describe, it, expect } from 'vitest'
import { extractTextNodes, replaceTextNodes } from '@/lib/translation/tiptap'

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
})
