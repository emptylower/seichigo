import type { PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client/wasm'

export type MapSummaryTargetLanguage = 'all' | 'zh' | 'en' | 'ja'

type CountRow = {
  count: bigint | number
}

export type TranslationMapSummary = {
  targetLanguage: MapSummaryTargetLanguage
  bangumiRemaining: number
  pointRemaining: number
}

export function parseMapSummaryTargetLanguage(
  value: string | null | undefined
): MapSummaryTargetLanguage {
  if (value === 'zh' || value === 'en' || value === 'ja') return value
  return 'all'
}

function toLangs(
  targetLanguage: MapSummaryTargetLanguage
): Array<'zh' | 'en' | 'ja'> {
  if (targetLanguage === 'zh') return ['zh']
  if (targetLanguage === 'en') return ['en']
  if (targetLanguage === 'ja') return ['ja']
  return ['zh', 'en', 'ja']
}

function toCount(value: bigint | number | null | undefined): number {
  if (typeof value === 'bigint') return Number(value)
  return Number(value || 0)
}

function buildBangumiLocalizedClause() {
  return Prisma.sql`
    CASE
      WHEN langs."language" = 'zh' THEN
        EXISTS (
          SELECT 1
          FROM "AnitabiBangumiI18n" i
          WHERE i."bangumiId" = b."id"
            AND i."language" = 'zh'
        )
        OR (
          NULLIF(BTRIM(COALESCE(b."titleZh", '')), '') IS NOT NULL
          AND b."titleZh" <> ('#' || b."id"::text)
          AND (
            NULLIF(BTRIM(COALESCE(b."titleJaRaw", '')), '') IS NULL
            OR b."titleZh" <> b."titleJaRaw"
          )
        )
      WHEN langs."language" = 'en' THEN
        EXISTS (
          SELECT 1
          FROM "AnitabiBangumiI18n" i
          WHERE i."bangumiId" = b."id"
            AND i."language" = 'en'
        )
        OR COALESCE(b."titleEnglish", '') ~ '[A-Za-z]'
      WHEN langs."language" = 'ja' THEN
        EXISTS (
          SELECT 1
          FROM "AnitabiBangumiI18n" i
          WHERE i."bangumiId" = b."id"
            AND i."language" = 'ja'
        )
        OR (
          NULLIF(BTRIM(COALESCE(b."titleJaRaw", '')), '') IS NOT NULL
          AND b."titleJaRaw" <> ('#' || b."id"::text)
          AND (
            NULLIF(BTRIM(COALESCE(b."titleZh", '')), '') IS NULL
            OR b."titleJaRaw" <> b."titleZh"
            OR NULLIF(BTRIM(COALESCE(b."titleOriginal", '')), '') IS NOT NULL
            OR b."titleJaRaw" ~ '[ぁ-んァ-ヶー々〆〤]'
          )
        )
      ELSE false
    END
  `
}

function buildBangumiMissingSql(langs: Array<'zh' | 'en' | 'ja'>) {
  return Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "AnitabiBangumi" b
    CROSS JOIN (VALUES ${Prisma.join(
      langs.map((lang) => Prisma.sql`(${lang})`)
    )}) AS langs("language")
    WHERE b."mapEnabled" = true
      AND NOT (${buildBangumiLocalizedClause()})
      AND NOT EXISTS (
        SELECT 1
        FROM "TranslationTask" t
        WHERE t."entityType" = 'anitabi_bangumi'
          AND t."entityId" = b."id"::text
          AND t."targetLanguage" = langs."language"
      )
  `
}

function buildPointLocalizedClause() {
  return Prisma.sql`
    CASE
      WHEN langs."language" = 'zh' THEN
        EXISTS (
          SELECT 1
          FROM "AnitabiPointI18n" i
          WHERE i."pointId" = p."id"
            AND i."language" = 'zh'
        )
        OR NULLIF(BTRIM(COALESCE(p."nameZh", '')), '') IS NOT NULL
      WHEN langs."language" = 'en' THEN
        EXISTS (
          SELECT 1
          FROM "AnitabiPointI18n" i
          WHERE i."pointId" = p."id"
            AND i."language" = 'en'
        )
        OR COALESCE(p."name", '') ~ '[A-Za-z]'
      WHEN langs."language" = 'ja' THEN
        EXISTS (
          SELECT 1
          FROM "AnitabiPointI18n" i
          WHERE i."pointId" = p."id"
            AND i."language" = 'ja'
        )
        OR (
          NULLIF(BTRIM(COALESCE(p."name", '')), '') IS NOT NULL
          AND p."name" !~ '[A-Za-z]'
          AND (
            NULLIF(BTRIM(COALESCE(p."nameZh", '')), '') IS NULL
            OR p."name" <> p."nameZh"
            OR p."name" ~ '[ぁ-んァ-ヶー々〆〤]'
          )
        )
      ELSE false
    END
  `
}

function buildPointMissingSql(langs: Array<'zh' | 'en' | 'ja'>) {
  return Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "AnitabiPoint" p
    INNER JOIN "AnitabiBangumi" b ON b."id" = p."bangumiId"
    CROSS JOIN (VALUES ${Prisma.join(
      langs.map((lang) => Prisma.sql`(${lang})`)
    )}) AS langs("language")
    WHERE b."mapEnabled" = true
      AND NOT (${buildPointLocalizedClause()})
      AND NOT EXISTS (
        SELECT 1
        FROM "TranslationTask" t
        WHERE t."entityType" = 'anitabi_point'
          AND t."entityId" = p."id"
          AND t."targetLanguage" = langs."language"
      )
  `
}

export async function getTranslationMapSummary(
  prisma: PrismaClient,
  targetLanguage: MapSummaryTargetLanguage
): Promise<TranslationMapSummary> {
  const langs = toLangs(targetLanguage)

  const [bangumiRows, pointRows] = await Promise.all([
    prisma.$queryRaw<CountRow[]>(buildBangumiMissingSql(langs)),
    prisma.$queryRaw<CountRow[]>(buildPointMissingSql(langs)),
  ])

  return {
    targetLanguage,
    bangumiRemaining: toCount(bangumiRows[0]?.count),
    pointRemaining: toCount(pointRows[0]?.count),
  }
}
