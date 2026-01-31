import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

const batchSchema = z.object({
  entityType: z.enum(['article', 'city', 'anime']),
  targetLanguages: z.array(z.enum(['en', 'ja'])).min(1),
})

type EntityType = z.infer<typeof batchSchema>['entityType']
type TargetLanguage = z.infer<typeof batchSchema>['targetLanguages'][number]

type ArticleRow = { id: string; translationGroupId: string | null }
type CityRow = {
  id: string
  name_en: string | null
  name_ja: string | null
  description_en: string | null
  transportTips_en: string | null
}
type AnimeRow = {
  id: string
  name_en: string | null
  name_ja: string | null
  summary_en: string | null
  summary_ja: string | null
}

function hasEntityTranslation(entityType: EntityType, row: CityRow | AnimeRow, lang: TargetLanguage): boolean {
  if (entityType === 'city') {
    const city = row as CityRow
    if (lang === 'en') return Boolean(city.name_en || city.description_en || city.transportTips_en)
    return Boolean(city.name_ja)
  }

  const anime = row as AnimeRow
  if (lang === 'en') return Boolean(anime.name_en || anime.summary_en)
  return Boolean(anime.name_ja || anime.summary_ja)
}

async function getEntityIdsAndApprovedLangs(
  entityType: EntityType,
  targetLanguages: TargetLanguage[]
): Promise<{ entityIds: string[]; approvedKey: Set<string>; articleGroupById?: Map<string, string> }>
{
  if (entityType === 'article') {
    const rows: ArticleRow[] = await prisma.article.findMany({
      where: { status: 'published' },
      select: { id: true, translationGroupId: true },
    })

    const entityIds = rows.map((r) => r.id)
    const groupIds = rows.map((r) => r.translationGroupId || r.id)
    const groupById = new Map(rows.map((r) => [r.id, r.translationGroupId || r.id]))

    const translated = await prisma.article.findMany({
      where: {
        language: { in: targetLanguages },
        translationGroupId: { in: groupIds },
      },
      select: {
        language: true,
        translationGroupId: true,
      },
    })

    const approvedKey = new Set(
      translated
        .map((t) => {
          const gid = t.translationGroupId
          if (!gid) return null
          return `${gid}:${t.language}`
        })
        .filter(Boolean) as string[]
    )

    return { entityIds, approvedKey, articleGroupById: groupById }
  }

  if (entityType === 'city') {
    const rows = await prisma.city.findMany({
      select: {
        id: true,
        name_en: true,
        name_ja: true,
        description_en: true,
        transportTips_en: true,
      },
    })
    const entityIds = rows.map((r) => r.id)
    const approvedKey = new Set<string>()
    for (const r of rows) {
      for (const lang of targetLanguages) {
        if (hasEntityTranslation('city', r as CityRow, lang)) {
          approvedKey.add(`${r.id}:${lang}`)
        }
      }
    }
    return { entityIds, approvedKey }
  }

  const rows: AnimeRow[] = await prisma.anime.findMany({
    select: {
      id: true,
      name_en: true,
      name_ja: true,
      summary_en: true,
      summary_ja: true,
    },
  })
  const entityIds = rows.map((r) => r.id)
  const approvedKey = new Set<string>()
  for (const r of rows) {
    for (const lang of targetLanguages) {
      if (hasEntityTranslation('anime', r, lang)) {
        approvedKey.add(`${r.id}:${lang}`)
      }
    }
  }
  return { entityIds, approvedKey }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const parsed = batchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '参数错误' },
        { status: 400 }
      )
    }

    const entityType = parsed.data.entityType
    const targetLanguages = Array.from(new Set(parsed.data.targetLanguages))

    const { entityIds, approvedKey, articleGroupById } = await getEntityIdsAndApprovedLangs(
      entityType,
      targetLanguages
    )

    if (entityIds.length === 0) {
      return NextResponse.json({ ok: true, created: 0, skipped: 0, entities: [] })
    }

    const existing = await prisma.translationTask.findMany({
      where: {
        entityType,
        entityId: { in: entityIds },
        targetLanguage: { in: targetLanguages },
      },
      select: {
        entityId: true,
        targetLanguage: true,
        status: true,
      },
    })

    const existingKey = new Set(existing.map((t) => `${t.entityId}:${t.targetLanguage}`))

    let created = 0
    let skipped = 0

    const upserts: Array<Promise<void>> = []
    const flush = async () => {
      if (upserts.length === 0) return
      await Promise.all(upserts)
      upserts.length = 0
    }

    for (const entityId of entityIds) {
      for (const targetLanguage of targetLanguages) {
        const key = `${entityId}:${targetLanguage}`
        if (entityType === 'article') {
          const gid = articleGroupById?.get(entityId)
          if (gid && approvedKey.has(`${gid}:${targetLanguage}`)) {
            skipped += 1
            continue
          }
        } else if (approvedKey.has(key)) {
          skipped += 1
          continue
        }

        if (existingKey.has(key)) {
          skipped += 1
          continue
        }

        upserts.push(
          prisma.translationTask
            .upsert({
              where: {
                entityType_entityId_targetLanguage: {
                  entityType,
                  entityId,
                  targetLanguage,
                },
              },
              create: {
                entityType,
                entityId,
                targetLanguage,
                status: 'pending',
              },
              update: {},
            })
            .then(() => {
              created += 1
            })
        )

        if (upserts.length >= 25) {
          await flush()
        }
      }
    }

    await flush()

    return NextResponse.json({
      ok: true,
      created,
      skipped,
      entities: entityIds,
    })
  } catch (error) {
    console.error('[api/admin/translations/batch] POST failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
