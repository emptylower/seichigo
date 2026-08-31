import { Prisma as PrismaRuntime } from '@seichigo/prisma-client-runtime'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type {
  BeginAgentRunResult,
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

  async beginAgentRun(input: {
    planId: string
    userId: string
    content: Prisma.JsonValue
    since: Date
    limit: number
    busyTtlMs: number
  }): Promise<BeginAgentRunResult> {
    return prisma.$transaction(async (tx): Promise<BeginAgentRunResult> => {
      // 同一用户的配额检查串行化：READ COMMITTED 下 insert+count 彼此不可见，
      // 并发请求会同时通过检查，必须用事务级 advisory lock 排队。
      // ::text 强转是必须的：advisory lock 函数返回 void，Prisma 无法反序列化 void 列
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))::text`
      const used = await tx.tripPlanMessage.count({
        where: { kind: 'human', createdAt: { gte: input.since }, plan: { userId: input.userId } },
      })
      if (used >= input.limit) return { status: 'quota_exceeded' }
      const now = new Date()
      const token = crypto.randomUUID()
      // 条件更新原子抢占 busy 位：抢不到（未过期）说明该计划已有 agent 在跑
      const claimed = await tx.tripPlan.updateMany({
        where: {
          id: input.planId,
          OR: [{ agentBusyUntil: null }, { agentBusyUntil: { lt: now } }],
        },
        data: { agentBusyUntil: new Date(now.getTime() + input.busyTtlMs), agentRunToken: token },
      })
      if (claimed.count === 0) return { status: 'busy' }
      const row = await tx.tripPlanMessage.create({
        data: { planId: input.planId, kind: 'human', content: input.content as Prisma.InputJsonValue },
      })
      return {
        status: 'ok',
        token,
        message: {
          id: row.id,
          planId: row.planId,
          kind: row.kind as TripPlanMessageKind,
          content: row.content,
          createdAt: row.createdAt,
        },
      }
      // maxWait 放宽到 10s：并发请求在 advisory lock 上排队属预期，
      // 排到队尾的应拿到干净的 429/409，而不是事务启动超时的 500
    }, { maxWait: 10_000, timeout: 15_000 })
  }

  async endAgentRun(planId: string, token: string): Promise<void> {
    // token 不匹配（已被新请求接管）时这里影响 0 行，静默跳过，不会误清新持有者的锁
    await prisma.tripPlan.updateMany({
      where: { id: planId, agentRunToken: token },
      data: { agentBusyUntil: null, agentRunToken: null },
    })
  }

  /**
   * `FOR UPDATE` 锁住该计划行直到事务结束：期间任何试图接管（`beginAgentRun`
   * 的 updateMany）或释放（`endAgentRun`）该行的并发操作都会阻塞在这里排队，
   * 保证锁校验与写入之间不存在能被其它请求插进来的窗口。
   */
  private async withRunTokenLock<T>(
    planId: string,
    token: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T | null> {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ agentRunToken: string | null }>>`
        SELECT "agentRunToken" FROM "TripPlan" WHERE id = ${planId} FOR UPDATE
      `
      if (rows[0]?.agentRunToken !== token) return null
      return fn(tx)
    })
  }

  async appendMessageIfActive(
    planId: string,
    token: string,
    kind: TripPlanMessageKind,
    content: Prisma.JsonValue,
  ): Promise<TripPlanMessage | null> {
    return this.withRunTokenLock(planId, token, async (tx) => {
      const row = await tx.tripPlanMessage.create({
        data: { planId, kind, content: content as Prisma.InputJsonValue },
      })
      return {
        id: row.id,
        planId: row.planId,
        kind: row.kind as TripPlanMessageKind,
        content: row.content,
        createdAt: row.createdAt,
      }
    })
  }

  async replaceDaysIfActive(planId: string, token: string, days: TripPlanDayInput[]): Promise<TripPlanWithDays | null> {
    return this.withRunTokenLock(planId, token, async (tx) => {
      await tx.tripPlanDay.deleteMany({ where: { planId } })
      for (const day of days) {
        await tx.tripPlanDay.create({
          data: {
            planId,
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
        })
      }
      await tx.tripPlan.update({ where: { id: planId }, data: { updatedAt: new Date() } })
      const row = await tx.tripPlan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE })
      if (!row) throw new Error(`plan not found after replaceDaysIfActive: ${planId}`)
      return toPlanWithDays(row)
    })
  }

  async updateMetaIfActive(planId: string, token: string, patch: TripPlanMetaUpdate): Promise<TripPlan | null> {
    return this.withRunTokenLock(planId, token, async (tx) => {
      const row = await tx.tripPlan.update({
        where: { id: planId },
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
    })
  }
}
