import { translateText } from './gemini'
import { extractTextNodes, replaceTextNodes, type TipTapNode } from './tiptap'

export type TranslationResult = {
  success: boolean
  translatedContent?: any
  error?: string
}

export async function translateArticle(articleId: string, targetLang: string): Promise<TranslationResult> {
  throw new Error('Not implemented yet - will be implemented in Wave 2')
}

export async function translateCity(cityId: string, targetLang: string): Promise<TranslationResult> {
  throw new Error('Not implemented yet - will be implemented in Wave 2')
}

export async function translateAnime(animeId: string, targetLang: string): Promise<TranslationResult> {
  throw new Error('Not implemented yet - will be implemented in Wave 2')
}

export async function translateTipTapContent(content: TipTapNode, targetLang: string): Promise<TipTapNode> {
  const texts = extractTextNodes(content)
  
  const translations = new Map<string, string>()
  for (const text of texts) {
    if (text.trim()) {
      const translated = await translateText(text, targetLang)
      translations.set(text, translated)
    }
  }
  
  return replaceTextNodes(content, translations)
}

export { translateText, extractTextNodes, replaceTextNodes }
