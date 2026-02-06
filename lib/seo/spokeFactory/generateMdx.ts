import type { SpokeGeneratedDoc, SpokeLocale, SpokeSelectedTopic } from './types'
import { callGemini } from '@/lib/translation/gemini'

type GeneratedPayload = {
  title: string
  seoTitle: string
  description: string
  bodyMarkdown: string
}

function parseJsonBlock(input: string): any {
  const raw = String(input || '').trim()
  if (!raw) return null
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    // ignore
  }

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1))
    } catch {
      // ignore
    }
  }
  return null
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function localeName(locale: SpokeLocale): string {
  if (locale === 'en') return 'English'
  if (locale === 'ja') return 'Japanese'
  return 'Chinese Simplified'
}

function fallbackBody(locale: SpokeLocale, topic: SpokeSelectedTopic): GeneratedPayload {
  const lang = localeName(locale)
  const place = topic.placeName
  const anime = topic.animeId
  const city = topic.city

  const bodyMarkdown = [
    `## ${place} 与《${anime}》巡礼定位`,
    `${place} 是围绕《${anime}》巡礼意图非常明确的地点之一。这个页面面向“我该怎么去、怎么拍、什么时候去更好”的搜索需求，重点给出可执行的信息，而不是泛泛背景介绍。`,
    `从 SEO 角度，这类地点独立页可以承接更具体的长尾词，并把用户再导回作品 Hub 页面，形成稳定的专题内链结构。`,
    '',
    '## 交通与到达建议',
    `建议把 ${place} 作为 ${city} 行程中的明确停靠点，先确认最近交通节点，再规划步行路线。`,
    '如果是第一次到访，优先在白天完成取景点踩线，晚间只做补拍，避免现场判断压力过大。',
    '',
    '## 机位与拍摄节奏',
    '建议先完成“还原构图”再拍“个人视角”：先确认高概率机位，再补细节与氛围画面，效率更高。',
    '若现场人流较多，可先拍远景和环境，再等待空档补主机位，避免影响其他行人。',
    '',
    '## 时间窗口与体验差异',
    '清晨通常更利于空镜与稳定构图；傍晚适合氛围和光线层次。',
    '如果要复刻动画情绪，建议提前准备参考截图并在现场对齐方向，而不是临时猜测角度。',
    '',
    '## 现场礼仪与风险控制',
    '巡礼内容要长期可持续，前提是尊重场地与周边秩序。拍摄时避免占道、避免高声交流、避免影响场馆和居民。',
    '遇到明确限制拍摄的区域，应优先遵守规则。与其追求单张画面，不如保证整趟路线顺畅完成。',
    '',
    '## 与作品 Hub 的联动',
    `完成 ${place} 后，可继续串联《${anime}》其他地点页，按“交通可达性 + 场景关联”组织半日或一日路线。`,
    '这种结构既方便用户决策，也能让搜索引擎更清晰理解页面层级与主题边界。',
  ].join('\n')

  return {
    title: `${place} | 《${anime}》圣地巡礼地点详解`,
    seoTitle: `${place} 圣地巡礼攻略｜${anime} 交通、机位与时间建议`,
    description: `${place} 的《${anime}》巡礼实用指南：交通路线、拍摄机位、到访时段与现场礼仪，一页完成行前准备。`,
    bodyMarkdown: lang === 'Chinese Simplified' ? bodyMarkdown : bodyMarkdown,
  }
}

function buildPrompt(locale: SpokeLocale, topic: SpokeSelectedTopic): string {
  const language = localeName(locale)
  return [
    `Write in ${language}.`,
    'Return strict JSON only. Do not use markdown code block.',
    'Format:',
    '{"title":"","seoTitle":"","description":"","bodyMarkdown":""}',
    'Rules:',
    '- bodyMarkdown must be at least 500 Chinese characters or 500 visible characters in target language.',
    '- Include practical details such as transit, shooting angles, timing, etiquette/safety.',
    '- Avoid generic filler and repeated sentences.',
    '- Keep description concise and search-friendly.',
    '',
    `Topic place: ${topic.placeName}`,
    `Anime id: ${topic.animeId}`,
    `City: ${topic.city}`,
    `Reference reason: ${topic.reason}`,
    `Source paths: ${topic.sourcePaths.join(', ')}`,
  ].join('\n')
}

function sanitizeGeneratedPayload(input: unknown, fallback: GeneratedPayload): GeneratedPayload {
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const title = String(data.title || '').trim() || fallback.title
  const seoTitle = String(data.seoTitle || '').trim() || fallback.seoTitle
  const description = String(data.description || '').trim() || fallback.description
  const bodyMarkdown = String(data.bodyMarkdown || '').trim() || fallback.bodyMarkdown
  return { title, seoTitle, description, bodyMarkdown }
}

function buildMdx(frontmatter: Record<string, unknown>, bodyMarkdown: string): string {
  const fm = [
    '---',
    `title: ${JSON.stringify(String(frontmatter.title || ''))}`,
    `seoTitle: ${JSON.stringify(String(frontmatter.seoTitle || ''))}`,
    `description: ${JSON.stringify(String(frontmatter.description || ''))}`,
    `slug: ${JSON.stringify(String(frontmatter.slug || ''))}`,
    `animeId: ${JSON.stringify(String(frontmatter.animeId || ''))}`,
    `city: ${JSON.stringify(String(frontmatter.city || ''))}`,
    `language: ${JSON.stringify(String(frontmatter.language || ''))}`,
    `tags: ${JSON.stringify(frontmatter.tags || [])}`,
    `publishDate: ${JSON.stringify(String(frontmatter.publishDate || ''))}`,
    `status: ${JSON.stringify(String(frontmatter.status || 'published'))}`,
    `canonicalPlaceKey: ${JSON.stringify(String(frontmatter.canonicalPlaceKey || ''))}`,
    '---',
    '',
  ].join('\n')
  return `${fm}${bodyMarkdown.trim()}\n`
}

export async function generateMdxForTopicLocale(
  topic: SpokeSelectedTopic,
  locale: SpokeLocale,
  now: Date = new Date()
): Promise<SpokeGeneratedDoc> {
  const fallback = fallbackBody(locale, topic)
  const prompt = buildPrompt(locale, topic)
  const aiRaw = await callGemini(prompt).catch(() => '')
  const aiJson = parseJsonBlock(aiRaw)
  const payload = sanitizeGeneratedPayload(aiJson, fallback)

  const frontmatter = {
    title: payload.title,
    seoTitle: payload.seoTitle,
    description: payload.description,
    slug: topic.slug,
    animeId: topic.animeId,
    city: topic.city,
    language: locale,
    tags: ['seo-spoke', topic.animeId, topic.city],
    publishDate: formatDate(now),
    status: 'published' as const,
    canonicalPlaceKey: topic.canonicalPlaceKey,
  }

  const localeFolder = locale === 'zh' ? 'zh' : locale
  const filePath = `content/${localeFolder}/posts/${topic.slug}.mdx`
  const rawMdx = buildMdx(frontmatter, payload.bodyMarkdown)

  return {
    locale,
    slug: topic.slug,
    path: filePath,
    frontmatter,
    content: payload.bodyMarkdown,
    rawMdx,
  }
}

export async function generateMdxForTopics(topics: SpokeSelectedTopic[], locales: SpokeLocale[]): Promise<SpokeGeneratedDoc[]> {
  const docs: SpokeGeneratedDoc[] = []
  for (const topic of topics) {
    for (const locale of locales) {
      const doc = await generateMdxForTopicLocale(topic, locale)
      docs.push(doc)
    }
  }
  return docs
}
