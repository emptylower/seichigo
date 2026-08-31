import { Prisma as PrismaRuntime } from '@seichigo/prisma-client-runtime'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type {
  TripPlan,
  TripPlanDayInput,
  TripPlanItemType,
  TripPlanMessage,
  TripPlanMessageKind,
  TripPlanMetaUpdate,
  TripPlanRepo,
  TripPlanStatus,
  TripPlanWithDays,
} from './repo'

const POINT_SELECT = {
  select: { id: true, name: true, nameZh: true, geoLat: true, geoLng: true, image: true },
} as const

const PLAN_INCLUDE = {
  days: {
    orderBy: { dayIndex: 'asc' as const },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' as const },
        include: { point: POINT_SELECT },
      },
    },
  },
} as const

type PrismaPlanWithDays = Prisma.TripPlanGetPayload<{ include: typeof PLAN_INCLUDE }>

function toPlan(row: Prisma.TripPlanGetPayload<Record<string, never>>): TripPlan {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    status: row.status as TripPlanStatus,
    startDate: row.startDate,
    dayCount: row.dayCount,
    bangumiIds: row.bangumiIds,
    preferences: row.preferences,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toPlanWithDays(row: PrismaPlanWithDays): TripPlanWithDays {
  return {
    ...toPlan(row),
    days: row.days.map((day) => ({
      id: day.id,
      planId: day.planId,
      dayIndex: day.dayIndex,
      date: day.date,
      citySlug: day.citySlug,
      summary: day.summary,
      items: day.items.map((item) => ({
        id: item.id,
        dayId: item.dayId,
        sortOrder: item.sortOrder,
        type: item.type as TripPlanItemType,
        pointId: item.pointId,
        timeHint: item.timeHint,
        title: item.title,
        note: item.note,
        reason: item.reason,
        payload: item.payload,
        point: item.point
          ? {
              id: item.point.id,
              name: item.point.name,
              nameZh: item.point.nameZh,
              lat: item.point.geoLat,
              lng: item.point.geoLng,
              image: item.point.image,
            }
          : null,
      })),
    })),
  }
}

export class PrismaTripPlanRepo implements TripPlanRepo {
  async createPlan(input: { userId: string; title: string }): Promise<TripPlan> {
    const row = await prisma.tripPlan.create({ data: { userId: input.userId, title: input.title } })
    return toPlan(row)
  }

  async listPlans(userId: string): Promise<TripPlan[]> {
    const rows = await prisma.tripPlan.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } })
    return rows.map(toPlan)
  }

  async getPlan(id: string): Promise<TripPlanWithDays | null> {
    const row = await prisma.tripPlan.findUnique({ where: { id }, include: PLAN_INCLUDE })
    return row ? toPlanWithDays(row) : null
  }

  async updateMeta(id: string, patch: TripPlanMetaUpdate): Promise<TripPlan> {
    const row = await prisma.tripPlan.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
        ...(patch.dayCount !== undefined ? { dayCount: patch.dayCount } : {}),
        ...(patch.bangumiIds !== undefined ? { bangumiIds: patch.bangumiIds } : {}),
        ...(patch.preferences !== undefined ? { preferences: patch.preferences ?? PrismaRuntime.JsonNull } : {}),
      },
    })
    return toPlan(row)
  }

  async replaceDays(id: string, days: TripPlanDayInput[]): Promise<TripPlanWithDays> {
    await prisma.$transaction([
      prisma.tripPlanDay.deleteMany({ where: { planId: id } }),
      ...days.map((day) =>
        prisma.tripPlanDay.create({
          data: {
            planId: id,
            dayIndex: day.dayIndex,
            date: day.date ?? null,
            citySlug: day.citySlug ?? null,
            summary: day.summary ?? null,
            items: {
              create: day.items.map((item, sortOrder) => ({
                sortOrder,
                type: item.type,
                pointId: item.pointId ?? null,
                timeHint: item.timeHint ?? null,
                title: item.title,
                note: item.note ?? null,
                reason: item.reason ?? null,
                payload: item.payload ?? undefined,
              })),
            },
          },
        }),
      ),
      prisma.tripPlan.update({ where: { id }, data: { updatedAt: new Date() } }),
    ])
    const plan = await this.getPlan(id)
    if (!plan) throw new Error(`plan not found after replaceDays: ${id}`)
    return plan
  }

  async countPlansCreatedSince(userId: string, since: Date): Promise<number> {
    return prisma.tripPlan.count({ where: { userId, createdAt: { gte: since } } })
  }

  async appendMessage(planId: string, kind: TripPlanMessageKind, content: Prisma.JsonValue): Promise<TripPlanMessage> {
    const row = await prisma.tripPlanMessage.create({
      data: { planId, kind, content: content as Prisma.InputJsonValue },
    })
    return { id: row.id, planId: row.planId, kind: row.kind as TripPlanMessageKind, content: row.content, createdAt: row.createdAt }
  }

  async listMessages(planId: string): Promise<TripPlanMessage[]> {
    const rows = await prisma.tripPlanMessage.findMany({ where: { planId }, orderBy: { createdAt: 'asc' } })
    return rows.map((row) => ({
      id: row.id,
      planId: row.planId,
      kind: row.kind as TripPlanMessageKind,
      content: row.content,
      createdAt: row.createdAt,
    }))
  }

  async countHumanMessagesSince(userId: string, since: Date): Promise<number> {
    return prisma.tripPlanMessage.count({
      where: { kind: 'human', createdAt: { gte: since }, plan: { userId } },
    })
  }
}
