import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'

export type MapSummaryTargetLanguage = 'all' | 'en' | 'ja'

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
  if (value === 'en' || value === 'ja') return value
  return 'all'
}

function toLangs(
  targetLanguage: MapSummaryTargetLanguage
): Array<'en' | 'ja'> {
  if (targetLanguage === 'en') return ['en']
  if (targetLanguage === 'ja') return ['ja']
  return ['en', 'ja']
}

function toCount(value: bigint | number | null | undefined): number {
  if (typeof value === 'bigint') return Number(value)
  return Number(value || 0)
}

function buildBangumiMissingSql(langs: Array<'en' | 'ja'>) {
  return Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "AnitabiBangumi" b
    CROSS JOIN (VALUES ${Prisma.join(
      langs.map((lang) => Prisma.sql`(${lang})`)
    )}) AS langs("language")
    WHERE b."mapEnabled" = true
      AND NOT EXISTS (
        SELECT 1
        FROM "AnitabiBangumiI18n" i
        WHERE i."bangumiId" = b."id"
          AND i."language" = langs."language"
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "TranslationTask" t
        WHERE t."entityType" = 'anitabi_bangumi'
          AND t."entityId" = b."id"::text
          AND t."targetLanguage" = langs."language"
      )
  `
}

function buildPointMissingSql(langs: Array<'en' | 'ja'>) {
  return Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "AnitabiPoint" p
    INNER JOIN "AnitabiBangumi" b ON b."id" = p."bangumiId"
    CROSS JOIN (VALUES ${Prisma.join(
      langs.map((lang) => Prisma.sql`(${lang})`)
    )}) AS langs("language")
    WHERE b."mapEnabled" = true
      AND NOT EXISTS (
        SELECT 1
        FROM "AnitabiPointI18n" i
        WHERE i."pointId" = p."id"
          AND i."language" = langs."language"
      )
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
