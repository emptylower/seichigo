/* eslint-disable no-console */

const fs = require('node:fs/promises')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

function normalizeAlias(input) {
  const raw = String(input || '')
  const normalized = raw.normalize('NFKC')
  return normalized.trim().replace(/\s+/g, ' ').toLowerCase()
}

async function main() {
  const dir = path.join(process.cwd(), 'content', 'city')
  const files = await fs.readdir(dir).catch(() => [])
  const jsonFiles = files.filter((f) => f.endsWith('.json'))
  if (!jsonFiles.length) {
    console.log('[city-seed] no city json files found')
    return
  }

  for (const file of jsonFiles) {
    const full = path.join(dir, file)
    const raw = await fs.readFile(full, 'utf-8').catch(() => null)
    if (!raw) continue
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }

    const slug = String(parsed?.id || '').trim()
    const name_zh = String(parsed?.name_zh || '').trim()
    if (!slug || !name_zh) continue

    const city = await prisma.city.upsert({
      where: { slug },
      create: {
        slug,
        name_zh,
        name_en: parsed?.name_en ? String(parsed.name_en).trim() || null : null,
        name_ja: parsed?.name_ja ? String(parsed.name_ja).trim() || null : null,
        description_zh: parsed?.description_zh ? String(parsed.description_zh).trim() || null : null,
        description_en: parsed?.description_en ? String(parsed.description_en).trim() || null : null,
        transportTips_zh: parsed?.transportTips_zh ? String(parsed.transportTips_zh).trim() || null : null,
        transportTips_en: parsed?.transportTips_en ? String(parsed.transportTips_en).trim() || null : null,
        cover: parsed?.cover ? String(parsed.cover).trim() || null : null,
        needsReview: false,
        hidden: false,
      },
      update: {
        name_zh,
        name_en: parsed?.name_en ? String(parsed.name_en).trim() || null : null,
        name_ja: parsed?.name_ja ? String(parsed.name_ja).trim() || null : null,
        description_zh: parsed?.description_zh ? String(parsed.description_zh).trim() || null : null,
        description_en: parsed?.description_en ? String(parsed.description_en).trim() || null : null,
        transportTips_zh: parsed?.transportTips_zh ? String(parsed.transportTips_zh).trim() || null : null,
        transportTips_en: parsed?.transportTips_en ? String(parsed.transportTips_en).trim() || null : null,
        cover: parsed?.cover ? String(parsed.cover).trim() || null : null,
        needsReview: false,
      },
      select: { id: true, slug: true },
    })

    const aliasCandidates = [slug, name_zh, parsed?.name_en, parsed?.name_ja]
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean)

    const aliasRows = aliasCandidates
      .map((alias) => ({
        cityId: city.id,
        alias,
        aliasNorm: normalizeAlias(alias),
        langCode: null,
        isPrimary: alias === name_zh,
      }))
      .filter((a) => a.aliasNorm)

    if (aliasRows.length) {
      await prisma.cityAlias.createMany({ data: aliasRows, skipDuplicates: true })
    }

    console.log(`[city-seed] upserted ${slug} -> ${city.id}`)
  }
}

main()
  .catch((err) => {
    console.error('[city-seed] failed', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null)
  })
