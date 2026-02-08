import { prisma } from '@/lib/db/prisma'
import { getArticleCityIds, setArticleCityIds } from '@/lib/city/links'
import { resolveCitiesByNames } from '@/lib/city/resolve'

export type BackfillCityLinksSource = 'translationGroupId' | 'zhSlug' | 'legacyCity' | 'none'

export type BackfillCityLinksAction = {
  articleId: string
  language: string
  slug: string
  source: BackfillCityLinksSource
  cityIds: string[]
}

export type BackfillCityLinksResult = {
  ok: true
  dryRun: boolean
  createMissingCity: boolean
  limit: number
  cursor: string | null
  nextCursor: string | null
  totalCandidates: number
  scanned: number
  processed: number
  skippedAlreadyLinked: number
  skippedNoSource: number
  errors: number
  filledFromGroup: number
  filledFromSlug: number
  filledFromLegacyCity: number
  actions: BackfillCityLinksAction[]
  warnings: string[]
  errorSamples: string[]
}

type Options = {
  dryRun: boolean
  createMissingCity: boolean
  limit?: number
  cursor?: string | null
  maxActions?: number
}

async function findSourceCityIds(input: { slug: string; translationGroupId: string | null }): Promise<{ source: BackfillCityLinksSource; cityIds: string[] }> {
  const gid = input.translationGroupId
  if (gid) {
    const ids = await getArticleCityIds(gid).catch(() => [])
    if (ids.length) return { source: 'translationGroupId', cityIds: ids }
  }

  const zh = await prisma.article
    .findUnique({
      where: { slug_language: { slug: input.slug, language: 'zh' } },
      select: { id: true },
    })
    .catch(() => null)

  if (zh?.id) {
    const ids = await getArticleCityIds(zh.id).catch(() => [])
    if (ids.length) return { source: 'zhSlug', cityIds: ids }
  }

  return { source: 'none', cityIds: [] }
}

async function resolveLegacyCityId(cityName: string, createIfMissing: boolean): Promise<string | null> {
  const raw = String(cityName || '').trim()
  if (!raw) return null

  const { cities } = await resolveCitiesByNames([raw], { createIfMissing }).catch(() => ({ cities: [] as any[] }))
  const primary = cities[0] || null
  return primary?.id ? String(primary.id) : null
}

export async function backfillArticleCityLinks(opts: Options): Promise<BackfillCityLinksResult> {
  const limitRaw = typeof opts.limit === 'number' ? opts.limit : 200
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 200
  const cursor = opts.cursor ? String(opts.cursor).trim() : null
  const maxActionsRaw = typeof opts.maxActions === 'number' ? opts.maxActions : 50
  const maxActions = Number.isFinite(maxActionsRaw) ? Math.max(0, Math.min(200, Math.floor(maxActionsRaw))) : 50

  const warnings: string[] = []
  const errorSamples: string[] = []

  let processed = 0
  let skippedAlreadyLinked = 0
  let skippedNoSource = 0
  let errors = 0

  let filledFromGroup = 0
  let filledFromSlug = 0
  let filledFromLegacyCity = 0

  const actions: BackfillCityLinksAction[] = []

  const where = {
    status: 'published' as const,
    language: { in: ['en', 'ja'] },
    ...(cursor ? { id: { gt: cursor } } : {}),
  }

  const totalCandidates = await prisma.article.count({ where })

  const rows = await prisma.article.findMany({
    where,
    orderBy: [{ id: 'asc' }],
    take: limit,
    select: {
      id: true,
      language: true,
      slug: true,
      translationGroupId: true,
      city: true,
    },
  })

  const scanned = rows.length
  const nextCursor = scanned === limit ? String(rows[rows.length - 1]?.id || '') || null : null

  for (const a of rows) {
    const articleId = String(a.id || '').trim()
    const language = String(a.language || '').trim() || 'unknown'
    const slug = String(a.slug || '').trim()
    if (!articleId || !slug) {
      skippedNoSource++
      warnings.push(`skip: invalid article row (id=${articleId || 'empty'}, slug=${slug || 'empty'})`)
      continue
    }

    try {
      const existing = await getArticleCityIds(articleId).catch(() => [])
      if (existing.length) {
        skippedAlreadyLinked++
        continue
      }

      const found = await findSourceCityIds({ slug, translationGroupId: a.translationGroupId })
      let source: BackfillCityLinksSource = found.source
      let cityIds: string[] = found.cityIds

      if (cityIds.length) {
        if (source === 'translationGroupId') filledFromGroup++
        if (source === 'zhSlug') filledFromSlug++
      } else {
        const legacyCityId = await resolveLegacyCityId(String(a.city || ''), opts.createMissingCity)
        if (legacyCityId) {
          source = 'legacyCity'
          cityIds = [legacyCityId]
          filledFromLegacyCity++
        }
      }

      if (!cityIds.length) {
        skippedNoSource++
        continue
      }

      if (!opts.dryRun) {
        await setArticleCityIds(articleId, cityIds)
      }

      processed++
      if (actions.length < maxActions) {
        actions.push({ articleId, language, slug, source, cityIds })
      }
    } catch (err) {
      errors++
      const msg = err instanceof Error ? err.message : String(err)
      if (errorSamples.length < 10) errorSamples.push(`articleId=${articleId} slug=${slug}: ${msg}`)
    }
  }

  return {
    ok: true,
    dryRun: opts.dryRun,
    createMissingCity: opts.createMissingCity,
    limit,
    cursor,
    nextCursor,
    totalCandidates,
    scanned,
    processed,
    skippedAlreadyLinked,
    skippedNoSource,
    errors,
    filledFromGroup,
    filledFromSlug,
    filledFromLegacyCity,
    actions,
    warnings,
    errorSamples,
  }
}
