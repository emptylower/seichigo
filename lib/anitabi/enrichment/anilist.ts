import { fetchAniListMetadata } from '@/lib/anitabi/anilist'
import type { AniListMedia } from '@/lib/anitabi/anilist'

const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 200
const MAX_BACKOFF_MS = 4000

export interface AniListEnrichmentResult {
  anilistId: number | null
  titleOriginal: string | null
  titleRomaji: string | null
  titleEnglish: string | null
  aliases: string[]
  anilistMatchConfidence: number | null
}

function emptyResult(): AniListEnrichmentResult {
  return {
    anilistId: null,
    titleOriginal: null,
    titleRomaji: null,
    titleEnglish: null,
    aliases: [],
    anilistMatchConfidence: null,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Calculate confidence score by comparing search key against AniList media entry.
 * - Exact match on native title → 1.0
 * - Contains match → 0.7–0.9 (scaled by length ratio)
 * - Synonym exact match → 0.8
 * - No match → 0.0
 */
export function calculateConfidence(searchKey: string, media: AniListMedia): number {
  const native = media.title.native?.trim() ?? ''

  if (!native || !searchKey) return 0.0

  // Exact match
  if (native === searchKey) return 1.0

  // Contains: longer string contains shorter
  if (native.includes(searchKey) || searchKey.includes(native)) {
    const shorter = Math.min(native.length, searchKey.length)
    const longer = Math.max(native.length, searchKey.length)
    const ratio = shorter / longer
    // Scale between 0.7 and 0.9
    return 0.7 + ratio * 0.2
  }

  // Check synonyms for exact match
  for (const synonym of media.synonyms) {
    if (synonym === searchKey) return 0.8
  }

  return 0.0
}

function mediaToResult(
  media: AniListMedia,
  confidence: number,
): AniListEnrichmentResult {
  return {
    anilistId: media.id,
    titleOriginal: media.title.native ?? null,
    titleRomaji: media.title.romaji ?? null,
    titleEnglish: media.title.english ?? null,
    aliases: media.synonyms ?? [],
    anilistMatchConfidence: confidence,
  }
}

/**
 * Enrich a Bangumi entry with AniList data.
 * Uses titleJaRaw as primary search key (matches AniList's native field).
 * Falls back to titleZh with a confidence penalty of -0.3.
 *
 * Handles rate limiting (429) with exponential backoff (max 3 retries).
 * Network errors are caught gracefully — returns null fields, never throws.
 */
export async function enrichBangumiWithAniList(input: {
  titleJaRaw: string
  titleZh: string
}): Promise<AniListEnrichmentResult> {
  const { titleJaRaw, titleZh } = input

  if (!titleJaRaw && !titleZh) return emptyResult()

  const searchKey = titleJaRaw || titleZh
  let lastError: unknown = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const media = await fetchAniListMetadata(searchKey)

      if (!media) return emptyResult()

      const confidence = calculateConfidence(searchKey, media)
      const result = mediaToResult(media, confidence)

      // If using titleZh fallback, reduce confidence
      if (!titleJaRaw && result.anilistMatchConfidence !== null && result.anilistMatchConfidence > 0) {
        result.anilistMatchConfidence = Math.max(0, result.anilistMatchConfidence - 0.3)
      }

      return result
    } catch (error: unknown) {
      lastError = error

      // Retry on 429 (rate limit)
      const status = (error as { status?: number }).status
      if (status === 429 && attempt < MAX_RETRIES) {
        const backoffMs = Math.min(
          INITIAL_BACKOFF_MS * Math.pow(2, attempt),
          MAX_BACKOFF_MS,
        )
        await sleep(backoffMs)
        continue
      }

      // Non-retryable errors or max retries exceeded: return empty
      break
    }
  }

  console.error('[enrichment/anilist] enrichBangumiWithAniList failed', lastError)
  return emptyResult()
}
