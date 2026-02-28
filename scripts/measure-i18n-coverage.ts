#!/usr/bin/env ts-node
/* eslint-disable no-console */

import { prisma } from '../lib/db/prisma'

async function main() {
  try {
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      console.error('ERROR: DATABASE_URL is not set')
      process.exit(1)
    }

    // Query total bangumi with mapEnabled=true
    const totalBangumi = await prisma.anitabiBangumi.count({
      where: { mapEnabled: true }
    })

    // Query English translations
    const enTranslations = await prisma.anitabiBangumiI18n.groupBy({
      by: ['bangumiId'],
      where: { language: 'en' }
    })
    const enCount = enTranslations.length

    // Query Japanese translations
    const jaTranslations = await prisma.anitabiBangumiI18n.groupBy({
      by: ['bangumiId'],
      where: { language: 'ja' }
    })
    const jaCount = jaTranslations.length

    // Calculate percentages
    const enPercent = totalBangumi > 0 ? ((enCount / totalBangumi) * 100).toFixed(1) : '0.0'
    const jaPercent = totalBangumi > 0 ? ((jaCount / totalBangumi) * 100).toFixed(1) : '0.0'

    // Output results
    console.log(`Total: ${totalBangumi} | EN: ${enCount} (${enPercent}%) | JA: ${jaCount} (${jaPercent}%)`)

    process.exit(0)
  } catch (err) {
    console.error('ERROR:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
