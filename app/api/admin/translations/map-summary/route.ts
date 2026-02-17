import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

type TargetLanguage = 'all' | 'en' | 'ja'

type CountRow = {
  count: bigint | number
}

function parseTargetLanguage(value: string | null): TargetLanguage {
  if (value === 'en' || value === 'ja') return value
  return 'all'
}

function toLangs(targetLanguage: TargetLanguage): Array<'en' | 'ja'> {
  if (targetLanguage === 'en') return ['en']
  if (targetLanguage === 'ja') return ['ja']
  return ['en', 'ja']
}

function toCount(value: bigint | number | null | undefined): number {
  if (typeof value === 'bigint') return Number(value)
  return Number(value || 0)
}

function buildBangumiMissingSql(langs: Array<'en' | 'ja'>): Prisma.Sql {
  const langLiterals = langs.map((lang) => Prisma.sql`${lang}`)
  const missingConds = langs.map((lang) => Prisma.sql`
    NOT EXISTS (
      SELECT 1
      FROM "AnitabiBangumiI18n" i
      WHERE i."bangumiId" = b."id"
        AND i."language" = ${lang}
    )
  `)

  return Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "AnitabiBangumi" b
    WHERE b."mapEnabled" = true
      AND NOT EXISTS (
        SELECT 1
        FROM "TranslationTask" t
        WHERE t."entityType" = 'anitabi_bangumi'
          AND t."entityId" = b."id"::text
          AND t."targetLanguage" IN (${Prisma.join(langLiterals)})
      )
      AND (${Prisma.join(missingConds, ' OR ')})
  `
}

function buildPointMissingSql(langs: Array<'en' | 'ja'>): Prisma.Sql {
  const langLiterals = langs.map((lang) => Prisma.sql`${lang}`)
  const missingConds = langs.map((lang) => Prisma.sql`
    NOT EXISTS (
      SELECT 1
      FROM "AnitabiPointI18n" i
      WHERE i."pointId" = p."id"
        AND i."language" = ${lang}
    )
  `)

  return Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "AnitabiPoint" p
    INNER JOIN "AnitabiBangumi" b ON b."id" = p."bangumiId"
    WHERE b."mapEnabled" = true
      AND NOT EXISTS (
        SELECT 1
        FROM "TranslationTask" t
        WHERE t."entityType" = 'anitabi_point'
          AND t."entityId" = p."id"
          AND t."targetLanguage" IN (${Prisma.join(langLiterals)})
      )
      AND (${Prisma.join(missingConds, ' OR ')})
  `
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const targetLanguage = parseTargetLanguage(searchParams.get('targetLanguage'))
    const langs = toLangs(targetLanguage)

    const [bangumiRows, pointRows] = await Promise.all([
      prisma.$queryRaw<CountRow[]>(buildBangumiMissingSql(langs)),
      prisma.$queryRaw<CountRow[]>(buildPointMissingSql(langs)),
    ])

    const bangumiRemaining = toCount(bangumiRows[0]?.count)
    const pointRemaining = toCount(pointRows[0]?.count)

    return NextResponse.json({
      ok: true,
      targetLanguage,
      bangumiRemaining,
      pointRemaining,
    })
  } catch (error) {
    console.error('[api/admin/translations/map-summary] GET failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
