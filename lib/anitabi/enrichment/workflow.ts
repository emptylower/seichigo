import type { PrismaClient } from '@prisma/client'
import { enrichBangumiWithAniList } from './anilist'

export interface EnrichBatchOptions {
  limit?: number
  concurrency?: number
  minConfidence?: number
}

export interface EnrichBatchResult {
  total: number
  enriched: number
  skipped: number
  failed: number
}

/**
 * Batch-enrich bangumi entries that have no anilistId yet.
 *
 * - Queries AnitabiBangumi where anilistId IS NULL and mapEnabled = true
 * - Calls enrichBangumiWithAniList for each
 * - Writes results back (including low-confidence matches, flagged by confidence value)
 * - Uses a worker-pool concurrency model (same pattern as sync workflow)
 *
 * Stats breakdown:
 * - total: number of bangumi queried
 * - enriched: matched with confidence >= minConfidence
 * - skipped: no match found OR confidence < minConfidence
 * - failed: errors during enrichment
 */
export async function enrichBatch(
  prisma: PrismaClient,
  options: EnrichBatchOptions = {},
): Promise<EnrichBatchResult> {
  const {
    limit = 100,
    concurrency = 2,
    minConfidence = 0.5,
  } = options

  const bangumi = await prisma.anitabiBangumi.findMany({
    where: { anilistId: null, mapEnabled: true },
    take: limit,
    select: { id: true, titleZh: true, titleJaRaw: true },
  })

  const results: EnrichBatchResult = {
    total: bangumi.length,
    enriched: 0,
    skipped: 0,
    failed: 0,
  }

  if (bangumi.length === 0) return results

  // Worker-pool concurrency (same pattern as sync/workflow.ts)
  const queue = bangumi.slice()
  const workers = Math.min(concurrency, Math.max(1, queue.length))

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const item = queue.shift()
        if (!item) break

        try {
          const match = await enrichBangumiWithAniList({
            titleJaRaw: item.titleJaRaw ?? '',
            titleZh: item.titleZh ?? '',
          })

          if (match.anilistId) {
            await prisma.anitabiBangumi.update({
              where: { id: item.id },
              data: {
                anilistId: match.anilistId,
                titleOriginal: match.titleOriginal,
                titleRomaji: match.titleRomaji,
                titleEnglish: match.titleEnglish,
                aliases: match.aliases,
                anilistMatchConfidence: match.anilistMatchConfidence,
              },
            })

            if ((match.anilistMatchConfidence ?? 0) >= minConfidence) {
              results.enriched++
            } else {
              results.skipped++ // Low confidence — still written but flagged
            }
          } else {
            results.skipped++ // No match
          }
        } catch (err) {
          console.error(`[enrichBatch] Failed for bangumi ${item.id}:`, err)
          results.failed++
        }
      }
    }),
  )

  return results
}
