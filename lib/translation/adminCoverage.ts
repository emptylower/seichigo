import type { PrismaClient } from '@prisma/client'
import type { AdminTranslationEntityType } from '@/lib/translation/adminDashboard'
import {
  getBangumiApprovedLanguages,
  getPointApprovedLanguages,
} from '@/lib/translation/mapLocale'
import {
  MAP_TRANSLATION_TARGET_LANGUAGES,
  type MapTranslationTargetLanguage,
} from '@/lib/translation/mapSourceHash'

export const ADMIN_TRANSLATION_TARGET_LANGUAGES = ['en', 'ja'] as const

export type AdminTranslationTargetLanguage =
  | (typeof ADMIN_TRANSLATION_TARGET_LANGUAGES)[number]
  | MapTranslationTargetLanguage
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
  titleOriginal: string | null
  titleEnglish: string | null
  description: string | null
  city: string | null
  updatedAt: Date
}

type PointRow = {
  id: string
  name: string
  nameZh: string | null
  mark: string | null
  updatedAt: Date
}

type ArticleTranslationRow = {
  translationGroupId: string | null
  language: string
}

type TranslationTaskLanguageRow = {
  entityId: string
  targetLanguage: string
}

type BangumiI18nRow = {
  bangumiId: number
  language: string
  title: string | null
  description: string | null
  city: string | null
}

type PointI18nRow = {
  pointId: string
  language: string
  name: string | null
  note: string | null
}

const IN_FILTER_CHUNK_SIZE = 10_000

function toDateIso(value: Date | null | undefined): string {
  return (value ?? new Date(0)).toISOString()
}

async function collectRowsInChunks<TValue extends string | number, TRow>(
  values: readonly TValue[],
  loader: (chunk: TValue[]) => Promise<TRow[]>
): Promise<TRow[]> {
  const deduped = Array.from(new Set(values))
  if (deduped.length === 0) return []

  const rows: TRow[] = []
  for (let index = 0; index < deduped.length; index += IN_FILTER_CHUNK_SIZE) {
    const chunk = deduped.slice(index, index + IN_FILTER_CHUNK_SIZE)
    rows.push(...(await loader(chunk)))
  }

  return rows
}

async function loadTaskRowsByEntityIds(
  prisma: PrismaClient,
  entityType: AdminTranslationEntityType,
  entityIds: readonly string[],
  targetLanguages: AdminTranslationTargetLanguage[]
): Promise<TranslationTaskLanguageRow[]> {
  return collectRowsInChunks(entityIds, (chunk) =>
    prisma.translationTask.findMany({
      where: {
        entityType,
        entityId: { in: chunk },
        targetLanguage: { in: targetLanguages },
      },
      select: {
        entityId: true,
        targetLanguage: true,
      },
    })
  )
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
    if (row.targetLanguage !== 'zh' && row.targetLanguage !== 'en' && row.targetLanguage !== 'ja') {
      continue
    }
    const existing = out.get(row.entityId) || new Set<AdminTranslationTargetLanguage>()
    existing.add(row.targetLanguage as AdminTranslationTargetLanguage)
    out.set(row.entityId, existing)
  }
  return out
}

function getSupportedTargetLanguages(
  entityType: AdminTranslationEntityType
): AdminTranslationTargetLanguage[] {
  return entityType === 'anitabi_bangumi' || entityType === 'anitabi_point' ? [...MAP_TRANSLATION_TARGET_LANGUAGES] : [...ADMIN_TRANSLATION_TARGET_LANGUAGES]
}

function filterTargetLanguagesForEntity(
  entityType: AdminTranslationEntityType,
  targetLanguages: readonly AdminTranslationTargetLanguage[]
): AdminTranslationTargetLanguage[] {
  const supported = new Set(getSupportedTargetLanguages(entityType))
  const filtered = Array.from(new Set(targetLanguages.filter((language) => supported.has(language))))
  return filtered.length > 0 ? filtered : getSupportedTargetLanguages(entityType)
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
    loadTaskRowsByEntityIds(prisma, 'article', entityIds, targetLanguages),
    collectRowsInChunks(groupIds, (chunk) =>
      prisma.article.findMany({
        where: {
          translationGroupId: { in: chunk },
          language: { in: targetLanguages },
          status: 'published',
        },
        select: {
          translationGroupId: true,
          language: true,
        },
      }) as Promise<ArticleTranslationRow[]>
    ),
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
      titleOriginal: true,
      titleEnglish: true,
      description: true,
      city: true,
      updatedAt: true,
    },
  }) as BangumiRow[]

  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)
  const [taskRows, translatedRows] = await Promise.all([
    loadTaskRowsByEntityIds(
      prisma,
      'anitabi_bangumi',
      ids.map((id) => String(id)),
      targetLanguages
    ),
    collectRowsInChunks(ids, (chunk) =>
      prisma.anitabiBangumiI18n.findMany({
        where: {
          bangumiId: { in: chunk },
          language: { in: targetLanguages },
        },
        select: {
          bangumiId: true,
          language: true,
          title: true,
          description: true,
          city: true,
        },
      }) as Promise<BangumiI18nRow[]>
    ),
  ])

  const taskLanguagesById = buildTaskLanguageMap(taskRows)
  const i18nById = new Map<string, BangumiI18nRow[]>()

  for (const row of translatedRows) {
    const key = String(row.bangumiId)
    const list = i18nById.get(key) || []
    list.push(row)
    i18nById.set(key, list)
  }

  return rows.map((row) => {
    const entityId = String(row.id)
    const approvedLanguages = getBangumiApprovedLanguages(
      {
        ...row,
        i18n: i18nById.get(entityId) || [],
      },
      targetLanguages as MapTranslationTargetLanguage[]
    )

    return {
      entityType: 'anitabi_bangumi',
      entityId,
      title: row.titleZh || row.titleJaRaw || row.titleEnglish || String(row.id),
      date: toDateIso(row.updatedAt),
      approvedLanguages,
      taskLanguages:
        taskLanguagesById.get(entityId) || new Set<AdminTranslationTargetLanguage>(),
    }
  })
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
      mark: true,
      updatedAt: true,
    },
  }) as PointRow[]

  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)
  const [taskRows, translatedRows] = await Promise.all([
    loadTaskRowsByEntityIds(
      prisma,
      'anitabi_point',
      ids,
      targetLanguages
    ),
    collectRowsInChunks(ids, (chunk) =>
      prisma.anitabiPointI18n.findMany({
        where: {
          pointId: { in: chunk },
          language: { in: targetLanguages },
        },
        select: {
          pointId: true,
          language: true,
          name: true,
          note: true,
        },
      }) as Promise<PointI18nRow[]>
    ),
  ])

  const taskLanguagesById = buildTaskLanguageMap(taskRows)
  const i18nById = new Map<string, PointI18nRow[]>()

  for (const row of translatedRows) {
    const list = i18nById.get(row.pointId) || []
    list.push(row)
    i18nById.set(row.pointId, list)
  }

  return rows.map((row) => ({
    entityType: 'anitabi_point',
    entityId: row.id,
    title: row.nameZh || row.name || row.id,
    date: toDateIso(row.updatedAt),
    approvedLanguages: getPointApprovedLanguages(
      {
        ...row,
        i18n: i18nById.get(row.id) || [],
      },
      targetLanguages as MapTranslationTargetLanguage[]
    ),
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
  const requestedTargetLanguages = input.targetLanguages && input.targetLanguages.length > 0
    ? input.targetLanguages
    : [...MAP_TRANSLATION_TARGET_LANGUAGES]

  const tasks: Array<Promise<TranslationCoverageItem[]>> = []
  if (entityType === 'all' || entityType === 'article') {
    tasks.push(
      loadArticleCoverage(
        prisma,
        filterTargetLanguagesForEntity('article', requestedTargetLanguages)
      )
    )
  }
  if (entityType === 'all' || entityType === 'city') {
    tasks.push(
      loadCityCoverage(
        prisma,
        filterTargetLanguagesForEntity('city', requestedTargetLanguages)
      )
    )
  }
  if (entityType === 'all' || entityType === 'anime') {
    tasks.push(
      loadAnimeCoverage(
        prisma,
        filterTargetLanguagesForEntity('anime', requestedTargetLanguages)
      )
    )
  }
  if (entityType === 'all' || entityType === 'anitabi_bangumi') {
    tasks.push(
      loadBangumiCoverage(
        prisma,
        filterTargetLanguagesForEntity('anitabi_bangumi', requestedTargetLanguages)
      )
    )
  }
  if (entityType === 'all' || entityType === 'anitabi_point') {
    tasks.push(
      loadPointCoverage(
        prisma,
        filterTargetLanguagesForEntity('anitabi_point', requestedTargetLanguages)
      )
    )
  }

  return (await Promise.all(tasks)).flat()
}

export async function createTranslationTasksFromCoverage(
  prisma: PrismaClient,
  input: TranslationBatchInput
): Promise<TranslationBatchResult> {
  const targetLanguages = filterTargetLanguagesForEntity(
    input.entityType,
    Array.from(new Set(input.targetLanguages))
  )
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
    const itemTargetLanguages = filterTargetLanguagesForEntity(
      item.entityType,
      targetLanguages
    )
    for (const language of itemTargetLanguages) {
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
    targetLanguages: [...MAP_TRANSLATION_TARGET_LANGUAGES],
  })

  const q = normalizeQuery(query.q)
  const items = coverageItems
    .map<UntranslatedItem | null>((item) => {
      const supportedLanguages = getSupportedTargetLanguages(item.entityType)
      const missingLanguages = supportedLanguages.filter(
        (language) =>
          !item.approvedLanguages.has(language) &&
          !item.taskLanguages.has(language)
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
