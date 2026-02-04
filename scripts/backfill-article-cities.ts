import { prisma } from '@/lib/db/prisma'
import { getArticleCityIds, setArticleCityIds } from '@/lib/city/links'

const isDryRun = !process.argv.includes('--execute')

async function main() {
  console.log(isDryRun ? '=== DRY RUN MODE ===' : '=== EXECUTE MODE ===')
  console.log('Starting backfill of ArticleCity records for translated articles...\n')

  // 1. Find all translated articles
  const translatedArticles = await prisma.article.findMany({
    where: { translationGroupId: { not: null } },
    select: { id: true, language: true, slug: true, translationGroupId: true },
  })

  console.log(`Found ${translatedArticles.length} translated articles\n`)

  let processedCount = 0
  let skippedCount = 0
  let errorCount = 0

  // 2. For each, check if it has cities
  for (const article of translatedArticles) {
    try {
      const existingCities = await getArticleCityIds(article.id)
      if (existingCities.length > 0) {
        skippedCount++
        continue // Already has cities
      }

      // 3. Get source cities
      if (!article.translationGroupId) {
        console.warn(`⚠️  Article ${article.id} has no translationGroupId, skipping`)
        skippedCount++
        continue
      }

      const sourceCities = await getArticleCityIds(article.translationGroupId)
      if (sourceCities.length === 0) {
        skippedCount++
        continue // Source has no cities
      }

      // 4. Log and copy (if execute mode)
      console.log(
        `Article ${article.id} (${article.language}, slug: ${article.slug}): copying ${sourceCities.length} city links from source ${article.translationGroupId}`
      )

      if (!isDryRun) {
        await setArticleCityIds(article.id, sourceCities)
        console.log(`  ✓ Created ${sourceCities.length} ArticleCity records`)
      } else {
        console.log(`  → Would create ${sourceCities.length} ArticleCity records`)
      }

      processedCount++
    } catch (err) {
      errorCount++
      console.error(`❌ Error processing article ${article.id}:`, err)
    }
  }

  console.log('\n=== Summary ===')
  console.log(`Total translated articles: ${translatedArticles.length}`)
  console.log(`Articles needing backfill: ${processedCount}`)
  console.log(`Articles skipped (already have cities or source has none): ${skippedCount}`)
  console.log(`Errors: ${errorCount}`)

  if (isDryRun && processedCount > 0) {
    console.log('\n💡 Run with --execute flag to apply changes')
  } else if (!isDryRun && processedCount > 0) {
    console.log('\n✅ Backfill completed successfully')
  } else if (processedCount === 0) {
    console.log('\n✅ No articles need backfilling (all articles already have city records or source has none)')
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
