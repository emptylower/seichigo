/* eslint-disable no-console */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

function normalizeAlias(input) {
  const raw = String(input || '')
  const normalized = raw.normalize('NFKC')
  return normalized.trim().replace(/\s+/g, ' ').toLowerCase()
}

function slugifyAscii(input) {
  const raw = String(input || '')
  const normalized = raw.normalize('NFKC').toLowerCase()
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
  return slug
}

async function ensureUniqueSlug(preferred) {
  const base = String(preferred || '').trim() || 'city'
  let candidate = base
  for (let i = 0; i < 50; i++) {
    const exists = await prisma.city.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!exists) return candidate
    candidate = `${base}-${i + 2}`
  }
  return `${base}-${Math.random().toString(16).slice(2, 10)}`
}

async function resolveOrCreateCityIdFromName(name) {
  const alias = String(name || '').trim()
  if (!alias) return null
  const aliasNorm = normalizeAlias(alias)
  if (!aliasNorm) return null

  const hit = await prisma.cityAlias.findUnique({ where: { aliasNorm }, select: { cityId: true } })
  if (hit?.cityId) return hit.cityId

  const preferredSlug = slugifyAscii(alias) || `city-${Math.random().toString(16).slice(2, 10)}`
  const slug = await ensureUniqueSlug(preferredSlug)
  const created = await prisma.city.create({
    data: {
      slug,
      name_zh: alias,
      needsReview: true,
      hidden: false,
      aliases: {
        create: {
          alias,
          aliasNorm,
          isPrimary: true,
          langCode: null,
        },
      },
    },
    select: { id: true },
  })
  console.log(`[city-backfill] created city for '${alias}' -> ${created.id}`)
  return created.id
}

async function main() {
  const distinctArticles = await prisma.article.findMany({
    where: { city: { not: null } },
    select: { city: true },
    distinct: ['city'],
  })
  const distinctRevisions = await prisma.articleRevision.findMany({
    where: { city: { not: null } },
    select: { city: true },
    distinct: ['city'],
  })
  const distinctSubmissions = await prisma.submission.findMany({
    select: { city: true },
    distinct: ['city'],
  })

  const rawCities = new Set()
  for (const r of distinctArticles) if (r.city) rawCities.add(String(r.city))
  for (const r of distinctRevisions) if (r.city) rawCities.add(String(r.city))
  for (const r of distinctSubmissions) if (r.city) rawCities.add(String(r.city))

  const cityMap = new Map() // raw string -> cityId
  for (const raw of rawCities) {
    const cleaned = String(raw || '').trim()
    if (!cleaned) continue
    const cityId = await resolveOrCreateCityIdFromName(cleaned)
    if (cityId) cityMap.set(cleaned, cityId)
  }

  const articles = await prisma.article.findMany({
    where: { city: { not: null } },
    select: { id: true, city: true },
  })
  const articleLinks = []
  for (const a of articles) {
    const raw = String(a.city || '').trim()
    const cityId = cityMap.get(raw)
    if (!cityId) continue
    articleLinks.push({ articleId: a.id, cityId })
  }
  if (articleLinks.length) {
    await prisma.articleCity.createMany({ data: articleLinks, skipDuplicates: true })
    console.log(`[city-backfill] linked ${articleLinks.length} articles`)
  }

  const revisions = await prisma.articleRevision.findMany({
    where: { city: { not: null } },
    select: { id: true, city: true },
  })
  const revisionLinks = []
  for (const r of revisions) {
    const raw = String(r.city || '').trim()
    const cityId = cityMap.get(raw)
    if (!cityId) continue
    revisionLinks.push({ revisionId: r.id, cityId })
  }
  if (revisionLinks.length) {
    await prisma.articleRevisionCity.createMany({ data: revisionLinks, skipDuplicates: true })
    console.log(`[city-backfill] linked ${revisionLinks.length} revisions`)
  }

  const submissions = await prisma.submission.findMany({
    select: { id: true, city: true },
  })
  const submissionLinks = []
  for (const s of submissions) {
    const raw = String(s.city || '').trim()
    const cityId = cityMap.get(raw)
    if (!cityId) continue
    submissionLinks.push({ submissionId: s.id, cityId })
  }
  if (submissionLinks.length) {
    await prisma.submissionCity.createMany({ data: submissionLinks, skipDuplicates: true })
    console.log(`[city-backfill] linked ${submissionLinks.length} submissions`)
  }
}

main()
  .catch((err) => {
    console.error('[city-backfill] failed', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null)
  })
