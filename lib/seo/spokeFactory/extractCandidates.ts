import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { isSeoSpokePost } from '@/lib/posts/visibility'
import { generateSlugFromTitle } from '@/lib/article/slug'
import { callGemini } from '@/lib/translation/gemini'
import type { SpokeCandidate, SpokeSelectedTopic, SpokeSourceOrigin, SpokeSourcePost } from './types'

function slugifyAscii(input: string): string {
  return input
    .trim()
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizePlaceKey(input: string): string {
  return slugifyAscii(input).slice(0, 80)
}

function safeDecodeURIComponent(input: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(input)) return input
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function parseSlugFromPath(postPath: string): string {
  const cleaned = String(postPath || '').split('?')[0]
  const parts = cleaned.split('/').filter(Boolean)
  if (!parts.length) return ''
  return safeDecodeURIComponent(parts[parts.length - 1] || '').trim().toLowerCase()
}

function parseJsonBlock(input: string): any {
  const raw = String(input || '').trim()
  if (!raw) return null
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  const direct = (() => {
    try {
      return JSON.parse(cleaned)
    } catch {
      return null
    }
  })()
  if (direct) return direct

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const piece = cleaned.slice(start, end + 1)
    try {
      return JSON.parse(piece)
    } catch {
      // ignore
    }
  }

  const arrStart = cleaned.indexOf('[')
  const arrEnd = cleaned.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) {
    const piece = cleaned.slice(arrStart, arrEnd + 1)
    try {
      return JSON.parse(piece)
    } catch {
      // ignore
    }
  }

  return null
}

function normalizeSourcePost(input: Partial<SpokeSourcePost>): SpokeSourcePost | null {
  const path = String(input.path || '').trim()
  const title = String(input.title || '').trim()
  const city = String(input.city || '').trim()
  const animeIds = Array.isArray(input.animeIds)
    ? input.animeIds.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  const tags = Array.isArray(input.tags) ? input.tags.map((x) => String(x || '').trim()).filter(Boolean) : []

  if (!path || !title || animeIds.length === 0) return null
  return { path, title, city, animeIds, tags }
}

function dedupeSourcePosts(posts: SpokeSourcePost[]): SpokeSourcePost[] {
  const byPath = new Map<string, SpokeSourcePost>()
  for (const post of posts) {
    const existing = byPath.get(post.path)
    if (!existing) {
      byPath.set(post.path, post)
      continue
    }
    byPath.set(post.path, {
      path: post.path,
      title: existing.title || post.title,
      city: existing.city || post.city,
      animeIds: Array.from(new Set([...existing.animeIds, ...post.animeIds])).filter(Boolean),
      tags: Array.from(new Set([...existing.tags, ...post.tags])).filter(Boolean),
    })
  }
  return Array.from(byPath.values())
}

function getAiApiSourceConfigFromEnv(): { baseUrl: string; token: string } | null {
  const baseUrl = String(process.env.SEO_AUTOMATION_AI_API_BASE_URL || process.env.AI_API_BASE_URL || '').trim()
  const token = String(
    process.env.SEO_AUTOMATION_AI_API_KEY || process.env.SEICHIGO_AI_API_KEY || process.env.AI_API_KEY || ''
  ).trim()
  if (!baseUrl || !token) return null
  return { baseUrl, token }
}

async function fetchSourcePostsFromAiApi(): Promise<SpokeSourcePost[]> {
  const config = getAiApiSourceConfigFromEnv()
  if (!config) return []

  let endpoint: URL
  try {
    const normalizedBase = config.baseUrl.replace(/\/+$/, '')
    endpoint = new URL(normalizedBase.endsWith('/articles') ? normalizedBase : `${normalizedBase}/articles`)
  } catch {
    return []
  }

  endpoint.searchParams.set('status', 'published')
  endpoint.searchParams.set('language', 'zh')

  try {
    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'X-AI-KEY': config.token,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!response.ok) return []

    const data = (await response.json().catch(() => ({}))) as { items?: any[] }
    const rows = Array.isArray(data.items) ? data.items : []

    return rows
      .map((row) =>
        normalizeSourcePost({
          path: String(row?.slug || '').trim() ? `/posts/${String(row.slug).trim()}` : String(row?.path || '').trim(),
          title: String(row?.title || '').trim(),
          city: String(row?.city || '').trim(),
          animeIds: Array.isArray(row?.animeIds)
            ? row.animeIds.map((x: unknown) => String(x || '').trim()).filter(Boolean)
            : [],
          tags: Array.isArray(row?.tags) ? row.tags.map((x: unknown) => String(x || '').trim()).filter(Boolean) : [],
        })
      )
      .filter((post): post is SpokeSourcePost => Boolean(post))
      .filter((post) => !isSeoSpokePost(post))
  } catch {
    return []
  }
}

export async function collectSourcePostsForSpokeFactory(): Promise<{ posts: SpokeSourcePost[]; origin: SpokeSourceOrigin }> {
  const localPosts = await getAllPublicPosts('zh').catch(() => [])
  const localSources = dedupeSourcePosts(
    localPosts
      .filter((post) => !isSeoSpokePost(post))
      .map((post) =>
        normalizeSourcePost({
          path: String(post.path || ''),
          title: String(post.title || ''),
          city: String(post.city || ''),
          animeIds: Array.isArray(post.animeIds) ? post.animeIds.map((x) => String(x || '').trim()).filter(Boolean) : [],
          tags: Array.isArray(post.tags) ? post.tags.map((x) => String(x || '').trim()).filter(Boolean) : [],
        })
      )
      .filter((post): post is SpokeSourcePost => Boolean(post))
  )

  const remoteSources = dedupeSourcePosts(await fetchSourcePostsFromAiApi())
  if (localSources.length > 0 && remoteSources.length > 0) {
    return { posts: dedupeSourcePosts([...localSources, ...remoteSources]), origin: 'local+ai-api' }
  }
  if (localSources.length > 0) {
    return { posts: localSources, origin: 'local' }
  }
  if (remoteSources.length > 0) {
    return { posts: remoteSources, origin: 'ai-api' }
  }
  return { posts: [], origin: 'none' }
}

function fallbackCandidatesFromSources(sources: SpokeSourcePost[]): SpokeCandidate[] {
  const candidates: SpokeCandidate[] = []
  for (const source of sources) {
    const animeId = source.animeIds[0] || ''
    if (!animeId) continue
    const primaryTitle = source.title.split(/[\|\-—｜]/)[0]?.trim() || source.title
    const canonicalPlaceKey = normalizePlaceKey(primaryTitle || source.city || source.title)
    if (!canonicalPlaceKey) continue

    const slugBaseCandidate = slugifyAscii(`${primaryTitle}-${animeId}`)
    const slugBase = slugBaseCandidate || generateSlugFromTitle(`${primaryTitle} ${animeId}`, new Date())
    candidates.push({
      canonicalPlaceKey,
      placeName: primaryTitle || source.title,
      animeId,
      city: source.city || 'unknown',
      slugBase,
      reason: `Derived from existing post: ${source.title}`,
      confidence: 0.55,
      sourcePaths: [source.path],
    })
  }
  return candidates
}

function mergeDuplicateCandidates(items: SpokeCandidate[]): SpokeCandidate[] {
  const byKey = new Map<string, SpokeCandidate>()
  for (const item of items) {
    const key = `${item.animeId}::${item.canonicalPlaceKey}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        ...item,
        sourcePaths: Array.from(new Set(item.sourcePaths)),
      })
      continue
    }
    const sourcePaths = Array.from(new Set([...existing.sourcePaths, ...item.sourcePaths]))
    if (item.confidence > existing.confidence) {
      byKey.set(key, { ...item, sourcePaths })
    } else {
      byKey.set(key, { ...existing, sourcePaths })
    }
  }
  return Array.from(byKey.values())
}

export async function extractCandidatesWithAi(sources: SpokeSourcePost[]): Promise<SpokeCandidate[]> {
  if (!sources.length) return []

  const limitedSources = sources.slice(0, 120)
  const prompt = [
    'You are an SEO strategist for anime pilgrimage content.',
    'From the following source posts, identify location-intent long-tail topic candidates for standalone pages.',
    'Return strict JSON only.',
    'Output format:',
    '{"candidates":[{"canonicalPlaceKey":"k","placeName":"name","animeId":"id","city":"city","slugBase":"ascii-slug","reason":"short","confidence":0.0,"sourcePaths":["/posts/..."]}]}',
    'Rules:',
    '- Only include concrete places that can become standalone pilgrimage pages.',
    '- confidence is 0~1.',
    '- slugBase must be lowercase ASCII with hyphens.',
    '- sourcePaths must only contain provided paths.',
    '- No markdown, no explanation.',
    '',
    JSON.stringify({ sources: limitedSources }),
  ].join('\n')

  const result = await callGemini(prompt)
  const parsed = parseJsonBlock(result)
  const rows: any[] = Array.isArray(parsed?.candidates)
    ? parsed.candidates
    : Array.isArray(parsed)
      ? parsed
      : []

  const normalized: SpokeCandidate[] = rows
    .map((row) => {
      const animeId = String(row?.animeId || '').trim()
      const placeName = String(row?.placeName || '').trim()
      const canonicalPlaceKey = normalizePlaceKey(String(row?.canonicalPlaceKey || placeName))
      const slugBase = slugifyAscii(String(row?.slugBase || `${placeName}-${animeId}`))
      const confidenceRaw =
        typeof row?.confidence === 'number' ? row.confidence : Number.parseFloat(String(row?.confidence || '0'))
      const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0
      const sourcePaths = Array.isArray(row?.sourcePaths)
        ? row.sourcePaths.map((x: unknown) => String(x || '').trim()).filter(Boolean)
        : []
      const city = String(row?.city || '').trim()
      const reason = String(row?.reason || '').trim()
      if (!animeId || !placeName || !canonicalPlaceKey || !slugBase || sourcePaths.length === 0) return null
      return {
        animeId,
        placeName,
        canonicalPlaceKey,
        slugBase,
        city: city || 'unknown',
        reason: reason || `Derived from source posts for ${placeName}`,
        confidence,
        sourcePaths,
      } as SpokeCandidate
    })
    .filter((x): x is SpokeCandidate => Boolean(x))

  return mergeDuplicateCandidates(normalized)
}

export async function loadExistingSpokeIndex(): Promise<{ existingSlugs: Set<string>; existingCanonicalKeys: Set<string> }> {
  const existingSlugs = new Set<string>()
  const existingCanonicalKeys = new Set<string>()

  for (const locale of ['zh', 'en', 'ja']) {
    const posts = await getAllPublicPosts(locale).catch(() => [])
    for (const post of posts) {
      if (!isSeoSpokePost(post)) continue
      const slug = parseSlugFromPath(post.path)
      if (slug) existingSlugs.add(slug)
    }

    const dir = path.join(process.cwd(), 'content', locale, 'posts')
    const files = await fs.readdir(dir).catch(() => [])
    for (const file of files.filter((f) => f.endsWith('.mdx'))) {
      const fullPath = path.join(dir, file)
      const raw = await fs.readFile(fullPath, 'utf-8').catch(() => '')
      if (!raw) continue
      const parsed = matter(raw)
      const tags = Array.isArray((parsed.data as any)?.tags)
        ? ((parsed.data as any).tags as unknown[]).map((x) => String(x || '').trim().toLowerCase())
        : []
      if (!tags.includes('seo-spoke')) continue
      const animeId = String((parsed.data as any)?.animeId || '').trim()
      const canonicalPlaceKey = normalizePlaceKey(String((parsed.data as any)?.canonicalPlaceKey || ''))
      if (animeId && canonicalPlaceKey) {
        existingCanonicalKeys.add(`${animeId}::${canonicalPlaceKey}`)
      }
    }
  }

  return { existingSlugs, existingCanonicalKeys }
}

function normalizeCandidate(input: SpokeCandidate): SpokeCandidate {
  const animeId = String(input.animeId || '').trim()
  const placeName = String(input.placeName || '').trim()
  const canonicalPlaceKey = normalizePlaceKey(String(input.canonicalPlaceKey || placeName))
  const city = String(input.city || '').trim() || 'unknown'
  const slugBase = slugifyAscii(String(input.slugBase || `${placeName}-${animeId}`))
  const reason = String(input.reason || '').trim() || `Derived from source posts for ${placeName}`
  const confidence = Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : 0
  const sourcePaths = Array.isArray(input.sourcePaths)
    ? input.sourcePaths.map((x) => String(x || '').trim()).filter(Boolean)
    : []

  return { animeId, placeName, canonicalPlaceKey, city, slugBase, reason, confidence, sourcePaths }
}

export function selectTopicsForGeneration(
  candidates: SpokeCandidate[],
  existing: { existingSlugs: Set<string>; existingCanonicalKeys: Set<string> },
  maxTopics: number
): {
  selected: SpokeSelectedTopic[]
  skippedExisting: number
  skippedLowConfidence: number
  skipped: Array<{ reason: string; value: string }>
} {
  const selected: SpokeSelectedTopic[] = []
  const selectedSlugs = new Set<string>()
  const selectedCanonical = new Set<string>()
  const skipped: Array<{ reason: string; value: string }> = []
  let skippedExisting = 0
  let skippedLowConfidence = 0

  const sorted = candidates
    .map(normalizeCandidate)
    .filter((x) => x.animeId && x.placeName && x.canonicalPlaceKey && x.slugBase)
    .sort((a, b) => b.confidence - a.confidence)

  for (const candidate of sorted) {
    if (selected.length >= maxTopics) break

    if (candidate.confidence < 0.45) {
      skippedLowConfidence++
      skipped.push({ reason: 'low-confidence', value: `${candidate.placeName} (${candidate.confidence.toFixed(2)})` })
      continue
    }

    const canonicalJoin = `${candidate.animeId}::${candidate.canonicalPlaceKey}`
    if (existing.existingCanonicalKeys.has(canonicalJoin) || selectedCanonical.has(canonicalJoin)) {
      skippedExisting++
      skipped.push({ reason: 'canonical-exists', value: canonicalJoin })
      continue
    }

    const slug = slugifyAscii(candidate.slugBase)
    if (!slug) {
      skipped.push({ reason: 'invalid-slug', value: candidate.slugBase })
      continue
    }

    if (existing.existingSlugs.has(slug) || selectedSlugs.has(slug)) {
      skippedExisting++
      skipped.push({ reason: 'slug-exists', value: slug })
      continue
    }

    selected.push({
      canonicalPlaceKey: candidate.canonicalPlaceKey,
      placeName: candidate.placeName,
      animeId: candidate.animeId,
      city: candidate.city,
      slug,
      reason: candidate.reason,
      confidence: candidate.confidence,
      sourcePaths: candidate.sourcePaths,
    })
    selectedSlugs.add(slug)
    selectedCanonical.add(canonicalJoin)
  }

  return {
    selected,
    skippedExisting,
    skippedLowConfidence,
    skipped,
  }
}

export type SpokeCandidateExtractionStats = {
  sourceOrigin: SpokeSourceOrigin
  sourcePostCount: number
  candidateCount: number
  candidates: SpokeCandidate[]
}

export async function extractSpokeCandidatesWithStats(): Promise<SpokeCandidateExtractionStats> {
  const sourceResult = await collectSourcePostsForSpokeFactory()
  const sources = sourceResult.posts
  if (!sources.length) {
    return {
      sourceOrigin: sourceResult.origin,
      sourcePostCount: 0,
      candidateCount: 0,
      candidates: [],
    }
  }

  const byAi = await extractCandidatesWithAi(sources).catch(() => [])
  const candidates = byAi.length > 0 ? mergeDuplicateCandidates(byAi) : mergeDuplicateCandidates(fallbackCandidatesFromSources(sources))

  return {
    sourceOrigin: sourceResult.origin,
    sourcePostCount: sources.length,
    candidateCount: candidates.length,
    candidates,
  }
}

export async function extractSpokeCandidates(): Promise<SpokeCandidate[]> {
  const result = await extractSpokeCandidatesWithStats()
  return result.candidates
}
