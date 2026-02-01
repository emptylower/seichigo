import { translateText } from './gemini'
import { extractTextNodes, replaceTextNodes, type TipTapNode } from './tiptap'
import { prisma } from '@/lib/db/prisma'

export type TranslationResult = {
  success: boolean
  sourceContent?: any
  translatedContent?: any
  error?: string
}

export async function translateArticle(articleId: string, targetLang: string): Promise<TranslationResult> {
  try {
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: {
        id: true,
        title: true,
        description: true,
        contentJson: true,
        seoTitle: true,
      },
    })

    if (!article) {
      return { success: false, error: 'Article not found' }
    }

    const sourceContent = {
      title: article.title,
      description: article.description,
      seoTitle: article.seoTitle,
      contentJson: article.contentJson,
    }

    const translatedTitle = await translateText(article.title, targetLang)
    const translatedDescription = article.description
      ? await translateText(article.description, targetLang)
      : null
    const translatedSeoTitle = article.seoTitle
      ? await translateText(article.seoTitle, targetLang)
      : null

    let translatedContentJson = article.contentJson
    if (article.contentJson && typeof article.contentJson === 'object') {
      translatedContentJson = await translateTipTapContent(
        article.contentJson as TipTapNode,
        targetLang
      )
    }

    return {
      success: true,
      sourceContent,
      translatedContent: {
        title: translatedTitle,
        description: translatedDescription,
        seoTitle: translatedSeoTitle,
        contentJson: translatedContentJson,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Translation failed' }
  }
}

export async function translateCity(cityId: string, targetLang: string): Promise<TranslationResult> {
  try {
    const city = await prisma.city.findUnique({
      where: { id: cityId },
      select: {
        id: true,
        name_zh: true,
        description_zh: true,
        transportTips_zh: true,
      },
    })

    if (!city) {
      return { success: false, error: 'City not found' }
    }

    const sourceContent = {
      name: city.name_zh,
      description: city.description_zh,
      transportTips: city.transportTips_zh,
    }

    const translatedName = await translateText(city.name_zh, targetLang)
    const translatedDescription = city.description_zh
      ? await translateText(city.description_zh, targetLang)
      : null
    const translatedTransportTips = city.transportTips_zh
      ? await translateText(city.transportTips_zh, targetLang)
      : null

    return {
      success: true,
      sourceContent,
      translatedContent: {
        name: translatedName,
        description: translatedDescription,
        transportTips: translatedTransportTips,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Translation failed' }
  }
}

export async function translateAnime(animeId: string, targetLang: string): Promise<TranslationResult> {
  try {
    const anime = await prisma.anime.findUnique({
      where: { id: animeId },
      select: {
        id: true,
        name: true,
        summary: true,
      },
    })

    if (!anime) {
      return { success: false, error: 'Anime not found' }
    }

    const sourceContent = {
      name: anime.name,
      summary: anime.summary,
    }

    const translatedName = await translateText(anime.name, targetLang)
    const translatedSummary = anime.summary
      ? await translateText(anime.summary, targetLang)
      : null

    return {
      success: true,
      sourceContent,
      translatedContent: {
        name: translatedName,
        summary: translatedSummary,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Translation failed' }
  }
}

export async function translateTipTapContent(content: TipTapNode, targetLang: string): Promise<TipTapNode> {
  const texts = extractTextNodes(content)
  
  const translations = new Map<string, string>()
  for (const text of texts) {
    // Skip empty or whitespace-only
    if (!text.trim()) {
      continue
    }
    // Skip punctuation/symbols only (including CJK punctuation)
    if (/^[\p{P}\p{S}\s]+$/u.test(text)) {
      continue
    }
    
    try {
      const translated = await translateText(text, targetLang)
      translations.set(text, translated)
    } catch (error) {
      console.error(`[translateTipTapContent] Failed to translate node: "${text.slice(0, 50)}..."`, error)
      // Keep original text on failure
      translations.set(text, text)
    }
  }
  
  return replaceTextNodes(content, translations)
}

export { translateText, extractTextNodes, replaceTextNodes }
