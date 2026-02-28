#!/usr/bin/env tsx
/* eslint-disable no-console */

import { prisma } from '../lib/db/prisma'
import {
  buildGlossaryFromEnrichment,
  writeGeneratedGlossary,
  loadManualGlossary,
  mergeGlossaries,
  loadGeneratedGlossary,
} from '../lib/i18n/glossaryBuilder'

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set')
    process.exit(1)
  }

  console.log('🔤 Building glossary from AniList enrichment data...\n')

  const { generated, stats } = await buildGlossaryFromEnrichment(prisma)

  console.log(`📊 Stats:`)
  console.log(`   Total enriched bangumi: ${stats.total}`)
  console.log(`   Skipped (in manual glossary): ${stats.skippedManual}`)
  console.log(`   Skipped (no titleZh): ${stats.skippedNoZh}`)
  console.log(`   New terms added: ${stats.added}`)

  writeGeneratedGlossary(generated)
  console.log(`\n✅ Written to lib/i18n/glossary.generated.json`)

  // Show merge summary
  const manual = loadManualGlossary()
  const merged = mergeGlossaries(manual, loadGeneratedGlossary())
  console.log(`\n📖 Merged glossary:`)
  console.log(`   Manual entries: ${Object.keys(manual).length}`)
  console.log(`   Generated entries: ${Object.keys(generated).length}`)
  console.log(`   Total (after merge): ${Object.keys(merged).length}`)

  // Sample some entries
  const sampleKeys = Object.keys(generated).slice(0, 5)
  if (sampleKeys.length > 0) {
    console.log(`\n📝 Sample generated entries:`)
    for (const key of sampleKeys) {
      const entry = generated[key]
      console.log(`   "${key}" → en: "${entry.en || '—'}", ja: "${entry.ja || '—'}"`)
    }
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
