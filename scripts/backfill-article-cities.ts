import { prisma } from '@/lib/db/prisma'
import { getArticleCityIds, setArticleCityIds } from '@/lib/city/links'
import { resolveCitiesByNames } from '@/lib/city/resolve'

const isDryRun = !process.argv.includes('--execute')
const allowCreateMissingCity = process.argv.includes('--create-missing-city')

async function findSourceCityIds(input: { slug: string; translationGroupId: string | null }): Promise<string[]> {
  if (input.translationGroupId) {
    const ids = await getArticleCityIds(input.translationGroupId).catch(() => [])
    if (ids.length) return ids
  }

  // Best-effort: legacy translations often share the same slug across languages.
  const zh = await prisma.article
    .findUnique({
      where: { slug_language: { slug: input.slug, language: 'zh' } },
      select: { id: true },
    })
    .catch(() => null)

  if (zh?.id) {
    const ids = await getArticleCityIds(zh.id).catch(() => [])
    if (ids.length) return ids
  }

  return []
}

async function resolveLegacyCityId(cityName: string): Promise<string | null> {
  const raw = String(cityName || '').trim()
  if (!raw) return null

  const { cities } = await resolveCitiesByNames([raw], {
    createIfMissing: allowCreateMissingCity,
  }).catch(() => ({ cities: [] as any[] }))

  const primary = cities[0] || null
  return primary?.id ? String(primary.id) : null
}

async function main() {
  console.log(isDryRun ? '=== DRY RUN MODE ===' : '=== EXECUTE MODE ===')
  console.log(`Create missing cities: ${allowCreateMissingCity ? 'YES' : 'NO'}`)
  console.log('Starting backfill of ArticleCity records for non-zh published articles...\n')

  // 1. Find all published non-Chinese articles.
  // NOTE: legacy translations may have translationGroupId = NULL, so discovery must not rely on it.
  const translatedArticles = await prisma.article.findMany({
    where: {
      status: 'published',
      language: { in: ['en', 'ja'] },
    },
    select: { id: true, language: true, slug: true, translationGroupId: true, city: true },
  })

  console.log(`Found ${translatedArticles.length} translated articles\n`)

  let processedCount = 0
  let skippedCount = 0
  let errorCount = 0
  let filledFromGroupCount = 0
  let filledFromSlugCount = 0
  let filledFromLegacyCityCount = 0

  // 2. For each, check if it has cities
  for (const article of translatedArticles) {
    try {
      const existingCities = await getArticleCityIds(article.id).catch(() => [])
      if (existingCities.length > 0) {
        skippedCount++
        continue // Already has cities
      }

      // 3. Get cities from source (translation group or matching zh slug)
      const slug = String(article.slug || '').trim()
      if (!slug) {
        console.warn(`WARN: Article ${article.id} (${article.language}): empty slug, skipping`)
        skippedCount++
        continue
      }

      const sourceCities = await findSourceCityIds({
        slug,
        translationGroupId: article.translationGroupId,
      })

      let cityIdsToApply: string[] = []
      if (sourceCities.length > 0) {
        cityIdsToApply = sourceCities
        if (article.translationGroupId) filledFromGroupCount++
        else filledFromSlugCount++
      } else {
        // 4. Fallback: resolve legacy `city` string into City.id
        const legacyCityId = await resolveLegacyCityId(String(article.city || ''))
        if (legacyCityId) {
          cityIdsToApply = [legacyCityId]
          filledFromLegacyCityCount++
        }
      }

      if (cityIdsToApply.length === 0) {
        console.warn(`WARN: Article ${article.id} (${article.language}, slug: ${slug}): no source cities found, skipping`)
        skippedCount++
        continue
      }

      // 5. Log and copy (if execute mode)
      console.log(`Article ${article.id} (${article.language}, slug: ${slug}): backfilling ${cityIdsToApply.length} city link(s)`)

      if (!isDryRun) {
        await setArticleCityIds(article.id, cityIdsToApply)
        console.log(`  OK: created ${cityIdsToApply.length} ArticleCity record(s)`)
      } else {
        console.log(`  DRY: would create ${cityIdsToApply.length} ArticleCity record(s)`)
      }

      processedCount++
    } catch (err) {
      errorCount++
      console.error(`ERROR: processing article ${article.id} failed:`, err)
    }
  }

  console.log('\n=== Summary ===')
  console.log(`Total translated articles: ${translatedArticles.length}`)
  console.log(`Articles needing backfill: ${processedCount}`)
  console.log(`Articles skipped: ${skippedCount}`)
  console.log(`Filled from translationGroupId: ${filledFromGroupCount}`)
  console.log(`Filled from matching zh slug: ${filledFromSlugCount}`)
  console.log(`Filled from legacy city string: ${filledFromLegacyCityCount}`)
  console.log(`Errors: ${errorCount}`)

  if (isDryRun && processedCount > 0) {
    console.log('\nTip: re-run with --execute to apply changes.')
    if (!allowCreateMissingCity) {
      console.log('Tip: add --create-missing-city to auto-create missing City records from legacy city names.')
    }
  } else if (!isDryRun && processedCount > 0) {
    console.log('\nBackfill completed successfully')
  } else if (processedCount === 0) {
    console.log('\nNo articles need backfilling (all articles already have city records or no city source is available)')
  }
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
