import type { PrismaClient } from '@prisma/client'
import type { AdminTranslationEntityType } from '@/lib/translation/adminDashboard'

export const ADMIN_TRANSLATION_TARGET_LANGUAGES = ['en', 'ja'] as const

export type AdminTranslationTargetLanguage = (typeof ADMIN_TRANSLATION_TARGET_LANGUAGES)[number]
export type AdminTranslationEntityTypeFilter = AdminTranslationEntityType | 'all'

export type TranslationCoverageItem = {
  entityType: AdminTranslationEntityType
  entityId: string
  title: string
  date: string
  approvedLanguages: Set<AdminTranslationTargetLanguage>
  taskLanguages: Set<AdminTranslationTargetLanguage>
}

export type UntranslatedItem = {
  entityType: AdminTranslationEntityType
  entityId: string
  title: string
  date: string
  missingLanguages: AdminTranslationTargetLanguage[]
}

export type UntranslatedListQuery = {
  entityType: AdminTranslationEntityTypeFilter
  q?: string | null
  page: number
  pageSize: number
}

export type UntranslatedListResult = {
  items: UntranslatedItem[]
  total: number
  page: number
  pageSize: number
  q?: string
  entityType: AdminTranslationEntityTypeFilter
}

export type TranslationBatchInput = {
  entityType: AdminTranslationEntityType
  targetLanguages: AdminTranslationTargetLanguage[]
}

export type TranslationBatchResult = {
  created: number
  skipped: number
  entities: string[]
}

type ArticleSourceRow = {
  id: string
  title: string
  translationGroupId: string | null
  publishedAt: Date | null
  createdAt: Date
}

type CityRow = {
  id: string
  name_zh: string
  name_en: string | null
  name_ja: string | null
  description_en: string | null
  description_ja: string | null
  transportTips_en: string | null
  transportTips_ja: string | null
  createdAt: Date
}

type AnimeRow = {
  id: string
  name: string
  name_en: string | null
  name_ja: string | null
  summary_en: string | null
  summary_ja: string | null
  createdAt: Date
}

type BangumiRow = {
  id: number
  titleZh: string | null
  titleJaRaw: string | null
  updatedAt: Date
}

type PointRow = {
  id: string
  name: string
  nameZh: string | null
  updatedAt: Date
}

type ArticleTranslationRow = {
  translationGroupId: string | null
  language: string
}

function toDateIso(value: Date | null | undefined): string {
  return (value ?? new Date(0)).toISOString()
}

export function parseAdminTranslationEntityType(
  value: string | null | undefined
): AdminTranslationEntityTypeFilter {
  if (
    value === 'article' ||
    value === 'city' ||
    value === 'anime' ||
    value === 'anitabi_bangumi' ||
    value === 'anitabi_point'
  ) {
    return value
  }
  return 'all'
}

function normalizeQuery(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

function buildTaskLanguageMap(
  rows: Array<{ entityId: string; targetLanguage: string }>
): Map<string, Set<AdminTranslationTargetLanguage>> {
  const out = new Map<string, Set<AdminTranslationTargetLanguage>>()
  for (const row of rows) {
    if (row.targetLanguage !== 'en' && row.targetLanguage !== 'ja') continue
    const existing = out.get(row.entityId) || new Set<AdminTranslationTargetLanguage>()
    existing.add(row.targetLanguage)
    out.set(row.entityId, existing)
  }
  return out
}

function hasColumnTranslation(
  entityType: 'city' | 'anime',
  row: CityRow | AnimeRow,
  lang: AdminTranslationTargetLanguage
): boolean {
  if (entityType === 'city') {
    const city = row as CityRow
    if (lang === 'en') {
      return Boolean(
        city.name_en?.trim() &&
        city.description_en?.trim() &&
        city.transportTips_en?.trim()
      )
    }
    return Boolean(
      city.name_ja?.trim() &&
      city.description_ja?.trim() &&
      city.transportTips_ja?.trim()
    )
  }

  const anime = row as AnimeRow
  if (lang === 'en') return Boolean(anime.name_en || anime.summary_en)
  return Boolean(anime.name_ja || anime.summary_ja)
}

async function loadArticleCoverage(
  prisma: PrismaClient,
  targetLanguages: AdminTranslationTargetLanguage[]
): Promise<TranslationCoverageItem[]> {
  const articles = await prisma.article.findMany({
    where: {
      status: 'published',
      language: 'zh',
    },
    select: {
      id: true,
      title: true,
      translationGroupId: true,
      publishedAt: true,
      createdAt: true,
    },
  }) as ArticleSourceRow[]

  if (articles.length === 0) return []

  const entityIds = articles.map((row) => row.id)
  const groupById = new Map(
    articles.map((row) => [row.id, row.translationGroupId || row.id] as const)
  )
  const groupIds = Array.from(new Set(Array.from(groupById.values())))

  const [taskRows, translatedRows] = await Promise.all([
    prisma.translationTask.findMany({
      where: {
        entityType: 'article',
        entityId: { in: entityIds },
        targetLanguage: { in: targetLanguages },
      },
      select: {
        entityId: true,
        targetLanguage: true,
      },
    }),
    prisma.article.findMany({
      where: {
        translationGroupId: { in: groupIds },
        language: { in: targetLanguages },
        status: 'published',
      },
      select: {
        translationGroupId: true,
        language: true,
      },
    }) as Promise<ArticleTranslationRow[]>,
  ])

  const taskLanguagesById = buildTaskLanguageMap(taskRows)
  const approvedByGroupId = new Map<string, Set<AdminTranslationTargetLanguage>>()

  for (const row of translatedRows) {
    if (!row.translationGroupId) continue
    if (row.language !== 'en' && row.language !== 'ja') continue
    const existing =
      approvedByGroupId.get(row.translationGroupId) ||
      new Set<AdminTranslationTargetLanguage>()
    existing.add(row.language)
    approvedByGroupId.set(row.translationGroupId, existing)
  }

  return articles.map((row) => {
    const groupId = groupById.get(row.id) || row.id
    return {
      entityType: 'article',
      entityId: row.id,
      title: row.title,
      date: toDateIso(row.publishedAt ?? row.createdAt),
      approvedLanguages:
        approvedByGroupId.get(groupId) || new Set<AdminTranslationTargetLanguage>(),
      taskLanguages:
        taskLanguagesById.get(row.id) || new Set<AdminTranslationTargetLanguage>(),
    }
  })
}

async function loadCityCoverage(
  prisma: PrismaClient,
  targetLanguages: AdminTranslationTargetLanguage[]
): Promise<TranslationCoverageItem[]> {
  const [rows, taskRows] = await Promise.all([
    prisma.city.findMany({
      where: { hidden: false },
      select: {
        id: true,
        name_zh: true,
        name_en: true,
        name_ja: true,
        description_en: true,
        description_ja: true,
        transportTips_en: true,
        transportTips_ja: true,
        createdAt: true,
      },
    }) as Promise<CityRow[]>,
    prisma.translationTask.findMany({
      where: {
        entityType: 'city',
        targetLanguage: { in: targetLanguages },
      },
      select: {
        entityId: true,
        targetLanguage: true,
      },
    }),
  ])

  const taskLanguagesById = buildTaskLanguageMap(taskRows)
  return rows.map((row) => {
    const approvedLanguages = new Set<AdminTranslationTargetLanguage>()
    for (const language of targetLanguages) {
      if (hasColumnTranslation('city', row, language)) {
        approvedLanguages.add(language)
      }
    }
    return {
      entityType: 'city',
      entityId: row.id,
      title: row.name_zh,
      date: toDateIso(row.createdAt),
      approvedLanguages,
      taskLanguages:
        taskLanguagesById.get(row.id) || new Set<AdminTranslationTargetLanguage>(),
    }
  })
}

async function loadAnimeCoverage(
  prisma: PrismaClient,
  targetLanguages: AdminTranslationTargetLanguage[]
): Promise<TranslationCoverageItem[]> {
  const [rows, taskRows] = await Promise.all([
    prisma.anime.findMany({
      where: { hidden: false },
      select: {
        id: true,
        name: true,
        name_en: true,
        name_ja: true,
        summary_en: true,
        summary_ja: true,
        createdAt: true,
      },
    }) as Promise<AnimeRow[]>,
    prisma.translationTask.findMany({
      where: {
        entityType: 'anime',
        targetLanguage: { in: targetLanguages },
      },
      select: {
        entityId: true,
        targetLanguage: true,
      },
    }),
  ])

  const taskLanguagesById = buildTaskLanguageMap(taskRows)
  return rows.map((row) => {
    const approvedLanguages = new Set<AdminTranslationTargetLanguage>()
    for (const language of targetLanguages) {
      if (hasColumnTranslation('anime', row, language)) {
        approvedLanguages.add(language)
      }
    }
    return {
      entityType: 'anime',
      entityId: row.id,
      title: row.name,
      date: toDateIso(row.createdAt),
      approvedLanguages,
      taskLanguages:
        taskLanguagesById.get(row.id) || new Set<AdminTranslationTargetLanguage>(),
    }
  })
}

async function loadBangumiCoverage(
  prisma: PrismaClient,
  targetLanguages: AdminTranslationTargetLanguage[]
): Promise<TranslationCoverageItem[]> {
  const rows = await prisma.anitabiBangumi.findMany({
    where: { mapEnabled: true },
    select: {
      id: true,
      titleZh: true,
      titleJaRaw: true,
      updatedAt: true,
    },
  }) as BangumiRow[]

  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)
  const [taskRows, translatedRows] = await Promise.all([
    prisma.translationTask.findMany({
      where: {
        entityType: 'anitabi_bangumi',
        entityId: { in: ids.map((id) => String(id)) },
        targetLanguage: { in: targetLanguages },
      },
      select: {
        entityId: true,
        targetLanguage: true,
      },
    }),
    prisma.anitabiBangumiI18n.findMany({
      where: {
        bangumiId: { in: ids },
        language: { in: targetLanguages },
      },
      select: {
        bangumiId: true,
        language: true,
      },
    }),
  ])

  const taskLanguagesById = buildTaskLanguageMap(taskRows)
  const approvedById = new Map<string, Set<AdminTranslationTargetLanguage>>()

  for (const row of translatedRows) {
    if (row.language !== 'en' && row.language !== 'ja') continue
    const key = String(row.bangumiId)
    const existing =
      approvedById.get(key) || new Set<AdminTranslationTargetLanguage>()
    existing.add(row.language)
    approvedById.set(key, existing)
  }

  return rows.map((row) => ({
    entityType: 'anitabi_bangumi',
    entityId: String(row.id),
    title: row.titleZh || row.titleJaRaw || String(row.id),
    date: toDateIso(row.updatedAt),
    approvedLanguages:
      approvedById.get(String(row.id)) || new Set<AdminTranslationTargetLanguage>(),
    taskLanguages:
      taskLanguagesById.get(String(row.id)) || new Set<AdminTranslationTargetLanguage>(),
  }))
}

async function loadPointCoverage(
  prisma: PrismaClient,
  targetLanguages: AdminTranslationTargetLanguage[]
): Promise<TranslationCoverageItem[]> {
  const rows = await prisma.anitabiPoint.findMany({
    select: {
      id: true,
      name: true,
      nameZh: true,
      updatedAt: true,
    },
  }) as PointRow[]

  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)
  const [taskRows, translatedRows] = await Promise.all([
    prisma.translationTask.findMany({
      where: {
        entityType: 'anitabi_point',
        entityId: { in: ids },
        targetLanguage: { in: targetLanguages },
      },
      select: {
        entityId: true,
        targetLanguage: true,
      },
    }),
    prisma.anitabiPointI18n.findMany({
      where: {
        pointId: { in: ids },
        language: { in: targetLanguages },
      },
      select: {
        pointId: true,
        language: true,
      },
    }),
  ])

  const taskLanguagesById = buildTaskLanguageMap(taskRows)
  const approvedById = new Map<string, Set<AdminTranslationTargetLanguage>>()

  for (const row of translatedRows) {
    if (row.language !== 'en' && row.language !== 'ja') continue
    const existing =
      approvedById.get(row.pointId) || new Set<AdminTranslationTargetLanguage>()
    existing.add(row.language)
    approvedById.set(row.pointId, existing)
  }

  return rows.map((row) => ({
    entityType: 'anitabi_point',
    entityId: row.id,
    title: row.nameZh || row.name || row.id,
    date: toDateIso(row.updatedAt),
    approvedLanguages:
      approvedById.get(row.id) || new Set<AdminTranslationTargetLanguage>(),
    taskLanguages:
      taskLanguagesById.get(row.id) || new Set<AdminTranslationTargetLanguage>(),
  }))
}

export async function listTranslationCoverage(
  prisma: PrismaClient,
  input: {
    entityType?: AdminTranslationEntityTypeFilter
    targetLanguages?: AdminTranslationTargetLanguage[]
  } = {}
): Promise<TranslationCoverageItem[]> {
  const entityType = input.entityType || 'all'
  const targetLanguages =
    input.targetLanguages && input.targetLanguages.length > 0
      ? input.targetLanguages
      : [...ADMIN_TRANSLATION_TARGET_LANGUAGES]

  const tasks: Array<Promise<TranslationCoverageItem[]>> = []
  if (entityType === 'all' || entityType === 'article') {
    tasks.push(loadArticleCoverage(prisma, targetLanguages))
  }
  if (entityType === 'all' || entityType === 'city') {
    tasks.push(loadCityCoverage(prisma, targetLanguages))
  }
  if (entityType === 'all' || entityType === 'anime') {
    tasks.push(loadAnimeCoverage(prisma, targetLanguages))
  }
  if (entityType === 'all' || entityType === 'anitabi_bangumi') {
    tasks.push(loadBangumiCoverage(prisma, targetLanguages))
  }
  if (entityType === 'all' || entityType === 'anitabi_point') {
    tasks.push(loadPointCoverage(prisma, targetLanguages))
  }

  return (await Promise.all(tasks)).flat()
}

export async function createTranslationTasksFromCoverage(
  prisma: PrismaClient,
  input: TranslationBatchInput
): Promise<TranslationBatchResult> {
  const targetLanguages = Array.from(new Set(input.targetLanguages))
  const coverageItems = await listTranslationCoverage(prisma, {
    entityType: input.entityType,
    targetLanguages,
  })

  if (coverageItems.length === 0) {
    return { created: 0, skipped: 0, entities: [] }
  }

  let created = 0
  let skipped = 0
  const upserts: Array<Promise<void>> = []

  const flush = async () => {
    if (upserts.length === 0) return
    await Promise.all(upserts)
    upserts.length = 0
  }

  for (const item of coverageItems) {
    for (const language of targetLanguages) {
      if (item.approvedLanguages.has(language) || item.taskLanguages.has(language)) {
        skipped += 1
        continue
      }

      upserts.push(
        prisma.translationTask.upsert({
          where: {
            entityType_entityId_targetLanguage: {
              entityType: item.entityType,
              entityId: item.entityId,
              targetLanguage: language,
            },
          },
          create: {
            entityType: item.entityType,
            entityId: item.entityId,
            targetLanguage: language,
            status: 'pending',
          },
          update: {},
        }).then(() => {
          created += 1
        })
      )

      if (upserts.length >= 25) {
        await flush()
      }
    }
  }

  await flush()

  return {
    created,
    skipped,
    entities: coverageItems.map((item) => item.entityId),
  }
}

export async function listUntranslatedItemsForAdmin(
  prisma: PrismaClient,
  query: UntranslatedListQuery
): Promise<UntranslatedListResult> {
  const coverageItems = await listTranslationCoverage(prisma, {
    entityType: query.entityType,
    targetLanguages: [...ADMIN_TRANSLATION_TARGET_LANGUAGES],
  })

  const q = normalizeQuery(query.q)
  const items = coverageItems
    .filter((item) => item.taskLanguages.size === 0)
    .map<UntranslatedItem | null>((item) => {
      const missingLanguages = ADMIN_TRANSLATION_TARGET_LANGUAGES.filter(
        (language) => !item.approvedLanguages.has(language)
      )
      if (missingLanguages.length === 0) return null
      return {
        entityType: item.entityType,
        entityId: item.entityId,
        title: item.title,
        date: item.date,
        missingLanguages,
      }
    })
    .filter(Boolean) as UntranslatedItem[]

  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const filtered = q
    ? items.filter((item) => {
        const haystack = `${item.title} ${item.entityId} ${item.entityType}`.toLowerCase()
        return haystack.includes(q)
      })
    : items

  const total = filtered.length
  const start = (query.page - 1) * query.pageSize

  return {
    items: filtered.slice(start, start + query.pageSize),
    total,
    page: query.page,
    pageSize: query.pageSize,
    q: q || undefined,
    entityType: query.entityType,
  }
}
