import fs from 'fs'
import path from 'path'
import type { PrismaClient } from '@prisma/client'

type GlossaryEntry = Record<string, string>
type Glossary = Record<string, GlossaryEntry>

const MANUAL_GLOSSARY_PATH = path.join(process.cwd(), 'lib/i18n/glossary.json')
const GENERATED_GLOSSARY_PATH = path.join(process.cwd(), 'lib/i18n/glossary.generated.json')

export function loadManualGlossary(): Glossary {
  if (!fs.existsSync(MANUAL_GLOSSARY_PATH)) {
    return {}
  }
  return JSON.parse(fs.readFileSync(MANUAL_GLOSSARY_PATH, 'utf-8')) as Glossary
}

export function loadGeneratedGlossary(): Glossary {
  if (!fs.existsSync(GENERATED_GLOSSARY_PATH)) {
    return {}
  }
  return JSON.parse(fs.readFileSync(GENERATED_GLOSSARY_PATH, 'utf-8')) as Glossary
}

/**
 * Merge manual + generated glossaries.
 * Manual entries always take priority over generated ones.
 */
export function mergeGlossaries(manual: Glossary, generated: Glossary): Glossary {
  return { ...generated, ...manual }
}

/**
 * Build glossary entries from AniList enrichment data in AnitabiBangumi.
 * - Queries bangumi where anilistId IS NOT NULL
 * - Generates entries: { [titleZh]: { en: titleEnglish, ja: titleJaRaw } }
 * - Skips entries where titleZh already exists in manual glossary
 * - Skips entries missing titleZh
 * - Additive only: does not overwrite existing generated entries that have been manually verified
 */
export async function buildGlossaryFromEnrichment(prisma: PrismaClient): Promise<{
  generated: Glossary
  stats: { total: number; skippedManual: number; skippedNoZh: number; added: number }
}> {
  const enrichedBangumi = await prisma.anitabiBangumi.findMany({
    where: { anilistId: { not: null } },
    select: {
      titleZh: true,
      titleEnglish: true,
      titleJaRaw: true,
      titleOriginal: true,
    },
  })

  const manual = loadManualGlossary()
  const generated: Glossary = {}

  let skippedManual = 0
  let skippedNoZh = 0
  let added = 0

  for (const b of enrichedBangumi) {
    if (!b.titleZh) {
      skippedNoZh++
      continue
    }

    if (manual[b.titleZh]) {
      skippedManual++
      continue
    }

    const en = b.titleEnglish || b.titleOriginal
    const ja = b.titleJaRaw

    // Only add if we have at least one translation
    if (!en && !ja) {
      continue
    }

    const entry: GlossaryEntry = {}
    if (en) entry.en = en
    if (ja) entry.ja = ja

    generated[b.titleZh] = entry
    added++
  }

  return {
    generated,
    stats: {
      total: enrichedBangumi.length,
      skippedManual,
      skippedNoZh,
      added,
    },
  }
}

/**
 * Write generated glossary to disk.
 * Sorts keys for stable, diffable output.
 */
export function writeGeneratedGlossary(glossary: Glossary): void {
  const sorted = Object.keys(glossary)
    .sort()
    .reduce<Glossary>((acc, key) => {
      acc[key] = glossary[key]
      return acc
    }, {})

  fs.writeFileSync(
    GENERATED_GLOSSARY_PATH,
    JSON.stringify(sorted, null, 2) + '\n',
    'utf-8'
  )
}
