import { translateText, translateTextBatch, BATCH_SIZE, MAX_BATCH_CHARS } from './gemini'
import { extractTextNodes, replaceTextNodes, type TipTapNode } from './tiptap'
import { prisma } from '@/lib/db/prisma'
import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'

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
        cover: true,
        animeIds: true,
        city: true,
        routeLength: true,
        tags: true,
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
      cover: article.cover,
      animeIds: article.animeIds,
      city: article.city,
      routeLength: article.routeLength,
      tags: article.tags,
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

    const contentHtml = renderArticleContentHtmlFromJson(translatedContentJson)

    return {
      success: true,
      sourceContent,
      translatedContent: {
        title: translatedTitle,
        description: translatedDescription,
        seoTitle: translatedSeoTitle,
        contentJson: translatedContentJson,
        contentHtml,
        cover: article.cover,
        animeIds: article.animeIds,
        city: article.city,
        routeLength: article.routeLength,
        tags: article.tags,
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

function splitIntoBatches(texts: string[], maxCount: number, maxChars: number): string[][] {
  const batches: string[][] = []
  let currentBatch: string[] = []
  let currentChars = 0
  
  for (const text of texts) {
    const textLength = text.length
    
    if (currentBatch.length >= maxCount || 
        (currentChars + textLength > maxChars && currentBatch.length > 0)) {
      batches.push(currentBatch)
      currentBatch = []
      currentChars = 0
    }
    
    currentBatch.push(text)
    currentChars += textLength
  }
  
  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }
  
  return batches
}

export async function translateTipTapContent(content: TipTapNode, targetLang: string): Promise<TipTapNode> {
  const texts = extractTextNodes(content)
  
  const validTexts = texts.filter(text => {
    if (!text.trim()) return false
    if (/^[\p{P}\p{S}\s]+$/u.test(text)) return false
    return true
  })
  
  const batches = splitIntoBatches(validTexts, BATCH_SIZE, MAX_BATCH_CHARS)
  
  const translations = new Map<string, string>()
  
  for (const batch of batches) {
    try {
      const batchResult = await translateTextBatch(batch, targetLang)
      for (const [original, translated] of batchResult) {
        translations.set(original, translated)
      }
    } catch (error) {
      console.error('[translateTipTapContent] Batch translation failed:', error)
      for (const text of batch) {
        translations.set(text, text)
      }
    }
  }
  
  return replaceTextNodes(content, translations)
}

export { translateText, extractTextNodes, replaceTextNodes }
