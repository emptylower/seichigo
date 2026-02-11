import type { PrismaClient } from '@prisma/client'
import type { SupportedLocale } from '@/lib/i18n/types'
import { normalizeText } from '@/lib/anitabi/utils'

function normalizeTarget(targetType: string, bangumiId?: number | null, pointId?: string | null): string {
  if (targetType === 'point' && pointId) return `point:${pointId}`
  if (targetType === 'bangumi' && Number.isFinite(Number(bangumiId))) return `bangumi:${Number(bangumiId)}`
  throw new Error('Invalid target')
}

export async function upsertFavorite(input: {
  prisma: PrismaClient
  userId: string
  targetType: 'bangumi' | 'point'
  bangumiId?: number | null
  pointId?: string | null
  remove?: boolean
}) {
  const targetKey = normalizeTarget(input.targetType, input.bangumiId, input.pointId)

  if (input.remove) {
    await input.prisma.anitabiFavorite.deleteMany({
      where: {
        userId: input.userId,
        targetKey,
      },
    })
    return { ok: true, removed: true }
  }

  await input.prisma.anitabiFavorite.upsert({
    where: {
      userId_targetKey: {
        userId: input.userId,
        targetKey,
      },
    },
    create: {
      userId: input.userId,
      targetType: input.targetType,
      targetKey,
      bangumiId: input.targetType === 'bangumi' ? Number(input.bangumiId) : null,
      pointId: input.targetType === 'point' ? normalizeText(input.pointId) : null,
    },
    update: {
      targetType: input.targetType,
      bangumiId: input.targetType === 'bangumi' ? Number(input.bangumiId) : null,
      pointId: input.targetType === 'point' ? normalizeText(input.pointId) : null,
    },
  })

  return { ok: true, removed: false }
}

export async function addHistory(input: {
  prisma: PrismaClient
  userId: string
  targetType: 'bangumi' | 'point'
  bangumiId?: number | null
  pointId?: string | null
}) {
  const targetKey = normalizeTarget(input.targetType, input.bangumiId, input.pointId)

  await input.prisma.anitabiViewHistory.create({
    data: {
      userId: input.userId,
      targetType: input.targetType,
      targetKey,
      bangumiId: input.targetType === 'bangumi' ? Number(input.bangumiId) : null,
      pointId: input.targetType === 'point' ? normalizeText(input.pointId) : null,
    },
  })

  await input.prisma.anitabiViewHistory.deleteMany({
    where: {
      userId: input.userId,
      id: {
        notIn: (
          await input.prisma.anitabiViewHistory.findMany({
            where: { userId: input.userId },
            select: { id: true },
            orderBy: { viewedAt: 'desc' },
            take: 100,
          })
        ).map((row) => row.id),
      },
    },
  })
}

export async function getMeState(input: {
  prisma: PrismaClient
  userId: string
  locale: SupportedLocale
}) {
  const [favorites, history] = await Promise.all([
    input.prisma.anitabiFavorite.findMany({
      where: { userId: input.userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        bangumi: {
          include: {
            i18n: {
              where: { language: input.locale },
              select: { title: true },
              take: 1,
            },
            meta: {
              select: { pointsLength: true, imagesLength: true },
            },
          },
        },
        point: {
          include: {
            i18n: {
              where: { language: input.locale },
              select: { name: true },
              take: 1,
            },
          },
        },
      },
    }),
    input.prisma.anitabiViewHistory.findMany({
      where: { userId: input.userId },
      orderBy: { viewedAt: 'desc' },
      take: 50,
      include: {
        bangumi: {
          include: {
            i18n: {
              where: { language: input.locale },
              select: { title: true },
              take: 1,
            },
            meta: {
              select: { pointsLength: true, imagesLength: true },
            },
          },
        },
        point: {
          include: {
            i18n: {
              where: { language: input.locale },
              select: { name: true },
              take: 1,
            },
          },
        },
      },
    }),
  ])

  return {
    favorites: favorites.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetKey: row.targetKey,
      createdAt: row.createdAt,
      bangumi: row.bangumi
        ? {
            id: row.bangumi.id,
            title: normalizeText(row.bangumi.i18n[0]?.title) || row.bangumi.titleZh || row.bangumi.titleJaRaw,
            cover: row.bangumi.cover,
            city: row.bangumi.city,
            pointsLength: row.bangumi.meta?.pointsLength || 0,
            imagesLength: row.bangumi.meta?.imagesLength || 0,
          }
        : null,
      point: row.point
        ? {
            id: row.point.id,
            bangumiId: row.point.bangumiId,
            name: normalizeText(row.point.i18n[0]?.name) || row.point.name,
            image: row.point.image,
            geo: row.point.geoLat != null && row.point.geoLng != null ? [row.point.geoLat, row.point.geoLng] : null,
          }
        : null,
    })),
    history: history.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetKey: row.targetKey,
      viewedAt: row.viewedAt,
      bangumi: row.bangumi
        ? {
            id: row.bangumi.id,
            title: normalizeText(row.bangumi.i18n[0]?.title) || row.bangumi.titleZh || row.bangumi.titleJaRaw,
            cover: row.bangumi.cover,
            city: row.bangumi.city,
          }
        : null,
      point: row.point
        ? {
            id: row.point.id,
            bangumiId: row.point.bangumiId,
            name: normalizeText(row.point.i18n[0]?.name) || row.point.name,
            image: row.point.image,
          }
        : null,
    })),
  }
}
