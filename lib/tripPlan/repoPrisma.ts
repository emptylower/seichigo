import { Prisma as PrismaRuntime } from '@seichigo/prisma-client-runtime'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type {
  BeginAgentRunInput,
  BeginAgentRunResult,
  ReplaceDaysWithDaymapResult,
  TripPlan,
  TripPlanDayInput,
  TripPlanItemType,
  TripPlanMessage,
  TripPlanMessageKind,
  TripPlanMetaUpdate,
  TripPlanRepo,
  TripPlanRunLivePatch,
  TripPlanRunLiveRecord,
  TripPlanRunLogEntry,
  TripPlanRunLogRecord,
  TripPlanRunSnapshotMeta,
  TripPlanStatus,
  TripPlanStageInputs,
  TripPlanWithDays,
} from './repo'
import { clampRunLiveReasoning, composePlanRevision, RUN_STOP_MARKER } from './repo'

const POINT_SELECT = {
  select: {
    id: true,
    name: true,
    nameZh: true,
    geoLat: true,
    geoLng: true,
    image: true,
    i18n: { where: { language: 'en' }, select: { name: true }, take: 1 },
  },
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

type TripPlanDayRow = Prisma.TripPlanDayCreateManyInput
type TripPlanItemRow = Prisma.TripPlanItemCreateManyInput

/**
 * 把领域层的天/条目输入铺平成 createMany 行：天 id 在应用层生成（createMany
 * 不回传创建的行），条目行的 dayId 直接引用这些已知 id，从而把写入压缩成
 * "1 次 deleteMany + 1 次天批量 + 1 次条目批量"的 O(1) 次数据库往返——
 * 旧实现的逐天串行 create（含嵌套条目）在 7 天规模就会撞穿交互式事务的
 * 超时窗口（Cloudflare Workers → Neon 每次往返都有真实网络延迟）。
 */
function buildDayRows(planId: string, days: TripPlanDayInput[]): { dayRows: TripPlanDayRow[]; itemRows: TripPlanItemRow[] } {
  const dayIds = days.map(() => crypto.randomUUID())
  const dayRows: TripPlanDayRow[] = days.map((day, i) => ({
    id: dayIds[i],
    planId,
    dayIndex: day.dayIndex,
    date: day.date ?? null,
    citySlug: day.citySlug ?? null,
    summary: day.summary ?? null,
  }))
  const itemRows: TripPlanItemRow[] = days.flatMap((day, i) =>
    day.items.map((item, sortOrder) => ({
      dayId: dayIds[i],
      sortOrder,
      type: item.type,
      pointId: item.pointId ?? null,
      timeHint: item.timeHint ?? null,
      title: item.title,
      note: item.note ?? null,
      reason: item.reason ?? null,
      ...(item.payload !== null && item.payload !== undefined ? { payload: item.payload } : {}),
    })),
  )
  return { dayRows, itemRows }
}

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
    stage: row.stage,
    agentRunToken: row.agentRunToken,
    agentBusyUntil: row.agentBusyUntil,
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
              nameEn: item.point.i18n[0]?.name ?? null,
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

  /** P2-A：POST /agent 准入用的最小投影（1 条 SQL）；null = 计划不存在 */
  async getPlanAdmission(planId: string): Promise<{ userId: string; agentBusyUntil: Date | null } | null> {
    const row = await prisma.tripPlan.findUnique({ where: { id: planId }, select: { userId: true, agentBusyUntil: true } })
    return row ? { userId: row.userId, agentBusyUntil: row.agentBusyUntil } : null
  }

  /** CUT-8：单字段投影，一次往返；null = 计划不存在 */
  async getPlanTitle(planId: string): Promise<string | null> {
    const row = await prisma.tripPlan.findUnique({ where: { id: planId }, select: { title: true } })
    return row?.title ?? null
  }

  /**
   * CUT-3：阶段推断的轻量投影——过滤型 relation count 连同 notIn 一起仍只发
   * 1 条 SQL（EXISTS 子查询，开发库实测）。必须带 where 过滤而非裸
   * `_count: { days: true }`：裸计数只回答"有几天"，全是外部地点
   * （pointId=null）的计划会被从 points 误判成 enrich/deliver；必须写
   * `{ not: null, notIn: [''] }`——JS 侧真值判断是"非 null 且非空串"。
   */
  async getStageInputs(planId: string): Promise<TripPlanStageInputs | null> {
    const row = await prisma.tripPlan.findUnique({
      where: { id: planId },
      select: {
        bangumiIds: true,
        startDate: true,
        dayCount: true,
        _count: { select: { days: { where: { items: { some: { pointId: { not: null, notIn: [''] } } } } } } },
      },
    })
    if (!row) return null
    return { bangumiIds: row.bangumiIds, startDate: row.startDate, dayCount: row.dayCount, hasPointItem: row._count.days > 0 }
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
    const { dayRows, itemRows } = buildDayRows(id, days)
    await prisma.$transaction([
      prisma.tripPlanDay.deleteMany({ where: { planId: id } }),
      ...(dayRows.length ? [prisma.tripPlanDay.createMany({ data: dayRows })] : []),
      ...(itemRows.length ? [prisma.tripPlanItem.createMany({ data: itemRows })] : []),
      prisma.tripPlan.update({ where: { id }, data: { updatedAt: new Date() } }),
    ])
    const plan = await this.getPlan(id)
    if (!plan) throw new Error(`plan not found after replaceDays: ${id}`)
    return plan
  }

  async countPlansCreatedSince(userId: string, since: Date): Promise<number> {
    return prisma.tripPlan.count({ where: { userId, createdAt: { gte: since } } })
  }

  /**
   * S2 乐观版本守卫：条件 updateMany 既是检查也是版本戳推进——where 里带上
   * expectedUpdatedAt，count === 0 说明读取之后计划被并发保存改过（或已不
   * 存在），整个事务直接空转返回 null，绝不覆盖别人的写入。匹配时同一事务
   * 内完成与 replaceDays 相同的 deleteMany/createMany 批量写入。
   */
  async replaceDaysIfUnchanged(
    id: string,
    expectedUpdatedAt: Date,
    days: TripPlanDayInput[],
  ): Promise<TripPlanWithDays | null> {
    const committed = await prisma.$transaction(
      async (tx) => {
        const guard = await tx.tripPlan.updateMany({
          where: { id, updatedAt: expectedUpdatedAt },
          data: { updatedAt: new Date() },
        })
        if (guard.count === 0) return false
        await tx.tripPlanDay.deleteMany({ where: { planId: id } })
        const { dayRows, itemRows } = buildDayRows(id, days)
        if (dayRows.length) await tx.tripPlanDay.createMany({ data: dayRows })
        if (itemRows.length) await tx.tripPlanItem.createMany({ data: itemRows })
        return true
      },
      { maxWait: 10_000, timeout: 15_000 },
    )
    if (!committed) return null
    const plan = await this.getPlan(id)
    if (!plan) throw new Error(`plan not found after replaceDaysIfUnchanged: ${id}`)
    return plan
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

  async beginAgentRun(input: BeginAgentRunInput): Promise<BeginAgentRunResult> {
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
      // 条件更新原子抢占 busy 位：抢不到（未过期）说明该计划已有 agent 在跑；
      // 新 token 必然重置 startedAt（不变量 1：每个 token 的领取机会从零开始）
      const claimed = await tx.tripPlan.updateMany({
        where: {
          id: input.planId,
          OR: [{ agentBusyUntil: null }, { agentBusyUntil: { lt: now } }],
        },
        data: { agentBusyUntil: new Date(now.getTime() + input.busyTtlMs), agentRunToken: token, agentRunStartedAt: null },
      })
      if (claimed.count === 0) return { status: 'busy' }
      // content=null（第八轮 resume 回合）：不追加 human 消息，历史原样
      let message: TripPlanMessage | null = null
      if (input.content !== null) {
        const row = await tx.tripPlanMessage.create({
          data: { planId: input.planId, kind: 'human', content: input.content as Prisma.InputJsonValue },
        })
        message = {
          id: row.id,
          planId: row.planId,
          kind: row.kind as TripPlanMessageKind,
          content: row.content,
          createdAt: row.createdAt,
        }
      }
      // P2-A：inTx 钩子——事务内、busy 位 + human 消息落库之后、提交之前；
      // 抛错整个事务回滚（busy 位与消息都不会留下）。tx 原样传入（TransactionClient）
      if (input.inTx) await input.inTx(tx, { token })
      return { status: 'ok', token, message }
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

  async renewAgentRun(planId: string, token: string, ttlMs: number): Promise<boolean> {
    // 第八轮 F3：token 不匹配（已被新请求接管）时影响 0 行，不会动新持有者的锁
    const renewed = await prisma.tripPlan.updateMany({
      where: { id: planId, agentRunToken: token },
      data: { agentBusyUntil: new Date(Date.now() + ttlMs) },
    })
    return renewed.count > 0
  }

  /**
   * CUT-1（2026-09-10）：renewAgentRun 的带返回版——单条 UPDATE ... WHERE
   * id AND agentRunToken ... RETURNING userId（P0-B 实测 WHERE 保得住
   * token）。P0-A（2026-09-11）：内部执行入口已改走 claimAgentRun（还要求
   * 尚未启动），本方法保留但内部路由不再用它。
   */
  async renewAgentRunOwner(planId: string, token: string, ttlMs: number): Promise<{ userId: string } | null> {
    const rows = await prisma.tripPlan.updateManyAndReturn({
      where: { id: planId, agentRunToken: token },
      data: { agentBusyUntil: new Date(Date.now() + ttlMs) },
      select: { userId: true },
    })
    return rows[0] ?? null
  }

  /**
   * P0-A（2026-09-11）联合方案 v1 不变量 1：一次性执行领取。单条原子
   * UPDATE ... WHERE id AND agentRunToken AND agentRunStartedAt IS NULL
   * ... RETURNING userId——token 失效、已被停止/接管、或同 token 已被别的
   * 执行者领取（Queue at-least-once 重投）都命中 0 行，返回 null。
   */
  async claimAgentRun(planId: string, token: string, ttlMs: number): Promise<{ userId: string } | null> {
    const now = new Date()
    const rows = await prisma.tripPlan.updateManyAndReturn({
      where: { id: planId, agentRunToken: token, agentRunStartedAt: null },
      data: { agentRunStartedAt: now, agentBusyUntil: new Date(now.getTime() + ttlMs) },
      select: { userId: true },
    })
    return rows[0] ?? null
  }

  /** P0-A：服务端专用的租约状态读取（token 绝不进领域类型/view）；无 token 返回 null */
  async getAgentRunState(
    planId: string,
  ): Promise<{ token: string; busyUntil: Date | null; startedAt: Date | null } | null> {
    const row = await prisma.tripPlan.findUnique({
      where: { id: planId },
      select: { agentRunToken: true, agentBusyUntil: true, agentRunStartedAt: true },
    })
    if (!row || row.agentRunToken === null) return null
    return { token: row.agentRunToken, busyUntil: row.agentBusyUntil, startedAt: row.agentRunStartedAt }
  }

  async stopAgentRun(planId: string): Promise<boolean> {
    // A3：条件清空（仍是当前持有者才动），停止标记写进实况行（跨隔离体可见）
    const plan = await prisma.tripPlan.findUnique({ where: { id: planId }, select: { agentRunToken: true } })
    const token = plan?.agentRunToken
    if (!token) return false
    const cleared = await prisma.tripPlan.updateMany({
      where: { id: planId, agentRunToken: token },
      data: { agentBusyUntil: null, agentRunToken: null },
    })
    if (cleared.count === 0) return false
    // H2：立即留下持久证据——运行日志里的 stage='stopped' 是
    // inferInterrupted/canResume 真正读的东西，GET 的顺手清理收不回它；
    // loop 收尾以 runToken 去重不重复写。写失败只 warn：停止的核心语义
    // （清 token）已达成，不能被日志抖动拖垮
    try {
      const lastLog = await prisma.tripPlanRunLog.findFirst({
        where: { planId },
        orderBy: { createdAt: 'desc' },
        select: { turnIndex: true },
      })
      await prisma.tripPlanRunLog.create({
        data: { planId, runToken: token, turnIndex: (lastLog?.turnIndex ?? 0) + 1, stage: 'stopped', durationMs: 0 },
      })
    } catch (err) {
      console.warn('[tripPlan/repoPrisma] stopAgentRun 写停止日志失败', err)
    }
    await this.upsertRunLive(planId, { runToken: token, statusText: RUN_STOP_MARKER })
    return true
  }

  async isAgentRunStopped(planId: string, token: string): Promise<boolean> {
    const plan = await prisma.tripPlan.findUnique({ where: { id: planId }, select: { agentRunToken: true } })
    return plan?.agentRunToken !== token
  }

  async isAgentBusy(planId: string): Promise<boolean> {
    const row = await prisma.tripPlan.findFirst({
      where: { id: planId, agentBusyUntil: { gt: new Date() } },
      select: { id: true },
    })
    return row !== null
  }

  async updateStage(planId: string, stage: string): Promise<void> {
    await prisma.tripPlan.updateMany({ where: { id: planId }, data: { stage } })
  }

  /** CUT-6：token 已不是当前持有者时影响 0 行（语义同 endAgentRun 的条件 updateMany） */
  async updateStageIfActive(planId: string, token: string, stage: string): Promise<void> {
    await prisma.tripPlan.updateMany({ where: { id: planId, agentRunToken: token }, data: { stage } })
  }

  async appendRunLog(entry: TripPlanRunLogEntry): Promise<TripPlanRunLogRecord> {
    const row = await prisma.tripPlanRunLog.create({
      data: {
        planId: entry.planId,
        runToken: entry.runToken ?? null,
        turnIndex: entry.turnIndex,
        stage: entry.stage,
        ...(entry.enrichReport !== null && entry.enrichReport !== undefined ? { enrichReport: entry.enrichReport as Prisma.InputJsonValue } : {}),
        ...(entry.gateReport !== null && entry.gateReport !== undefined ? { gateReport: entry.gateReport as Prisma.InputJsonValue } : {}),
        ...(entry.toolCalls !== null && entry.toolCalls !== undefined ? { toolCalls: entry.toolCalls as Prisma.InputJsonValue } : {}),
        ...(entry.modelUsage !== null && entry.modelUsage !== undefined ? { modelUsage: entry.modelUsage as Prisma.InputJsonValue } : {}),
        durationMs: entry.durationMs,
      },
    })
    return { ...entry, id: row.id, createdAt: row.createdAt }
  }

  async listRunLogs(planId: string): Promise<TripPlanRunLogRecord[]> {
    const rows = await prisma.tripPlanRunLog.findMany({ where: { planId }, orderBy: { createdAt: 'asc' } })
    return rows.map((row) => ({
      planId: row.planId,
      runToken: row.runToken,
      turnIndex: row.turnIndex,
      stage: row.stage,
      enrichReport: row.enrichReport,
      gateReport: row.gateReport,
      toolCalls: row.toolCalls,
      modelUsage: row.modelUsage,
      durationMs: row.durationMs,
      id: row.id,
      createdAt: row.createdAt,
    }))
  }

  /** F2：把 run 成本写进 stopAgentRun 已落笔的 stopped 日志（幂等覆盖 modelUsage） */
  async updateRunLogModelUsage(planId: string, runToken: string | null, modelUsage: Prisma.JsonValue): Promise<void> {
    await prisma.tripPlanRunLog.updateMany({
      where: { planId, runToken, stage: 'stopped' },
      data: { modelUsage: modelUsage as Prisma.InputJsonValue },
    })
  }

  /**
   * 第七轮 A1 运行实况：先读旧行判断是否同 run（runToken 相同才允许追加/
   * 保留字段；不同 = 新 run 接管，整行按本次 patch 重置），再原子 upsert。
   * 并发窗口（接管瞬间新旧 writer 交错）由读侧的 runToken 匹配过滤兜底，
   * 这里不做行锁——实况是尽力而为的瞬时视图，写失败由 writer warn 吞掉。
   */
  async upsertRunLive(planId: string, patch: TripPlanRunLivePatch): Promise<TripPlanRunLiveRecord> {
    const existing = await prisma.tripPlanRunLive.findUnique({ where: { planId } })
    const sameRun = existing?.runToken === patch.runToken
    const reasoning = clampRunLiveReasoning(
      patch.reasoningReplace !== undefined
        ? patch.reasoningReplace
        : (sameRun ? existing?.reasoning ?? '' : '') + (patch.reasoningAppend ?? ''),
    )
    const statusText =
      sameRun && patch.statusText === undefined ? existing?.statusText ?? null : patch.statusText ?? null
    // A3：停止标记粘性——同 run 的后续实况 flush（reasoning 增量等）不把
    // '__stop_requested__' 冲掉；新 run（不同 token）接管时行被重置，自然消失
    const preservedMarker = sameRun && existing?.statusText === RUN_STOP_MARKER && patch.statusText !== RUN_STOP_MARKER
    const toolCalls = sameRun && patch.toolCalls === undefined ? existing?.toolCalls ?? null : patch.toolCalls ?? null
    const data = {
      runToken: patch.runToken,
      reasoning,
      statusText: preservedMarker ? RUN_STOP_MARKER : statusText,
      toolCalls: toolCalls === null ? PrismaRuntime.DbNull : (toolCalls as Prisma.InputJsonValue),
    }
    const row = await prisma.tripPlanRunLive.upsert({
      where: { planId },
      create: { planId, ...data },
      update: data,
    })
    return {
      planId: row.planId,
      runToken: row.runToken,
      reasoning: row.reasoning,
      statusText: row.statusText,
      toolCalls: row.toolCalls,
      updatedAt: row.updatedAt,
    }
  }

  async getRunLive(planId: string): Promise<TripPlanRunLiveRecord | null> {
    const row = await prisma.tripPlanRunLive.findUnique({ where: { planId } })
    return row
      ? {
          planId: row.planId,
          runToken: row.runToken,
          reasoning: row.reasoning,
          statusText: row.statusText,
          toolCalls: row.toolCalls,
          updatedAt: row.updatedAt,
        }
      : null
  }

  async clearRunLive(planId: string): Promise<void> {
    await prisma.tripPlanRunLive.deleteMany({ where: { planId } })
  }

  /**
   * §0.6.1 轻量快照：一次 findUnique 携带全部所需字段（含 _count 与倒序
   * take 1 的消息时间戳），绝不取全量消息。agentBusy 判定与 isAgentBusy
   * 同一规则（agentBusyUntil > now）。planRevision 走 composePlanRevision
   * （不含 updatedAt——renewAgentRun 续租会顺带刷它，见 §0.6.1）。
   */
  async getRunSnapshotMeta(planId: string): Promise<TripPlanRunSnapshotMeta | null> {
    const row = await prisma.tripPlan.findUnique({
      where: { id: planId },
      select: {
        title: true,
        status: true,
        startDate: true,
        dayCount: true,
        bangumiIds: true,
        stage: true,
        agentBusyUntil: true,
        agentRunToken: true,
        runLive: { select: { runToken: true, reasoning: true, statusText: true, toolCalls: true, updatedAt: true } },
        _count: { select: { messages: true, days: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
    })
    if (!row) return null
    const agentBusy = row.agentBusyUntil !== null && row.agentBusyUntil.getTime() > Date.now()
    const live =
      agentBusy && row.runLive !== null && row.runLive.runToken === row.agentRunToken
        ? {
            runToken: row.runLive.runToken,
            reasoning: row.runLive.reasoning,
            statusText: row.runLive.statusText,
            toolCalls: row.runLive.toolCalls,
            updatedAt: row.runLive.updatedAt,
          }
        : null
    return {
      agentBusy,
      planRevision: composePlanRevision({
        title: row.title,
        status: row.status,
        startDate: row.startDate,
        dayCount: row.dayCount,
        bangumiIds: row.bangumiIds,
        stage: row.stage,
        dayTotal: row._count.days,
      }),
      messageCount: row._count.messages,
      lastMessageAt: row.messages[0]?.createdAt ?? null,
      live,
    }
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
    return prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ agentRunToken: string | null }>>`
          SELECT "agentRunToken" FROM "TripPlan" WHERE id = ${planId} FOR UPDATE
        `
        if (rows[0]?.agentRunToken !== token) return null
        return fn(tx)
      },
      // 批量化后正常路径毫秒级完成，但必须给网络抖动（尤其 Workers→Neon）
      // 留余量；默认 5000ms 曾让 7 天规模的 save_plan_days 撞上
      // "commit cannot be executed on an expired transaction"
      { maxWait: 10_000, timeout: 15_000 },
    )
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
    const committed = await this.withRunTokenLock(planId, token, async (tx) => {
      await tx.tripPlanDay.deleteMany({ where: { planId } })
      const { dayRows, itemRows } = buildDayRows(planId, days)
      if (dayRows.length) await tx.tripPlanDay.createMany({ data: dayRows })
      if (itemRows.length) await tx.tripPlanItem.createMany({ data: itemRows })
      await tx.tripPlan.update({ where: { id: planId }, data: { updatedAt: new Date() } })
    })
    if (committed === null) return null
    // 全量回读放到提交之后：读本身不改动数据，没必要占用 FOR UPDATE 锁窗口
    const plan = await this.getPlan(planId)
    if (!plan) throw new Error(`plan not found after replaceDaysIfActive: ${planId}`)
    return plan
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

  /**
   * 事务体内完成"替换天数 → 回读完整计划 → 追加 kind=daymap 消息"：
   * daymap 快照与天数替换同事务提交，杜绝半截成功；回读放在事务内保证
   * 快照与落库行严格一致（提交后再读理论上可能撞上并发接管后的新数据）。
   */
  private async replaceDaysWithDaymapTx(
    tx: Prisma.TransactionClient,
    planId: string,
    days: TripPlanDayInput[],
    buildDaymapContent: (plan: TripPlanWithDays) => Prisma.JsonValue,
  ): Promise<ReplaceDaysWithDaymapResult> {
    await tx.tripPlanDay.deleteMany({ where: { planId } })
    const { dayRows, itemRows } = buildDayRows(planId, days)
    if (dayRows.length) await tx.tripPlanDay.createMany({ data: dayRows })
    if (itemRows.length) await tx.tripPlanItem.createMany({ data: itemRows })
    await tx.tripPlan.update({ where: { id: planId }, data: { updatedAt: new Date() } })
    const row = await tx.tripPlan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE })
    if (!row) throw new Error(`plan not found after replaceDaysWithDaymap: ${planId}`)
    const plan = toPlanWithDays(row)
    const messageRow = await tx.tripPlanMessage.create({
      data: { planId, kind: 'daymap', content: buildDaymapContent(plan) as Prisma.InputJsonValue },
    })
    return {
      plan,
      message: {
        id: messageRow.id,
        planId: messageRow.planId,
        kind: messageRow.kind as TripPlanMessageKind,
        content: messageRow.content,
        createdAt: messageRow.createdAt,
      },
    }
  }

  async replaceDaysWithDaymap(
    planId: string,
    days: TripPlanDayInput[],
    buildDaymapContent: (plan: TripPlanWithDays) => Prisma.JsonValue,
  ): Promise<ReplaceDaysWithDaymapResult> {
    return prisma.$transaction((tx) => this.replaceDaysWithDaymapTx(tx, planId, days, buildDaymapContent), {
      maxWait: 10_000,
      timeout: 15_000,
    })
  }

  async replaceDaysWithDaymapIfActive(
    planId: string,
    token: string,
    days: TripPlanDayInput[],
    buildDaymapContent: (plan: TripPlanWithDays) => Prisma.JsonValue,
  ): Promise<ReplaceDaysWithDaymapResult | null> {
    return this.withRunTokenLock(planId, token, (tx) =>
      this.replaceDaysWithDaymapTx(tx, planId, days, buildDaymapContent),
    )
  }
}
