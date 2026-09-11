import type { Prisma } from '@prisma/client'
import type {
  BeginAgentRunInput,
  BeginAgentRunResult,
  ReplaceDaysWithDaymapResult,
  TripPlan,
  TripPlanDay,
  TripPlanDayInput,
  TripPlanMessage,
  TripPlanMessageKind,
  TripPlanMetaUpdate,
  TripPlanPointLite,
  TripPlanRepo,
  TripPlanRunLivePatch,
  TripPlanRunLiveRecord,
  TripPlanRunLogEntry,
  TripPlanRunLogRecord,
  TripPlanRunSnapshotMeta,
  TripPlanStageInputs,
  TripPlanStartupRead,
  TripPlanWithDays,
} from './repo'
import { clampRunLiveReasoning, composePlanRevision, RUN_STOP_MARKER } from './repo'

type MemoryOptions = {
  points?: Map<string, TripPlanPointLite>
}

export class MemoryTripPlanRepo implements TripPlanRepo {
  /** 单调递增的更新时间：同毫秒内连续写入也能被 replaceDaysIfUnchanged 的版本守卫区分（真实库有毫秒级时钟 + 事务序） */
  private lastTouchMs = 0
  private touch(): Date {
    const now = Math.max(Date.now(), this.lastTouchMs + 1)
    this.lastTouchMs = now
    return new Date(now)
  }
  private plans = new Map<string, TripPlanWithDays>()
  private messages: TripPlanMessage[] = []
  private runLogs: TripPlanRunLogRecord[] = []
  private runLive = new Map<string, TripPlanRunLiveRecord>()
  private agentBusy = new Map<string, { until: Date; token: string; startedAt: Date | null }>()
  private points: Map<string, TripPlanPointLite>
  private seq = 0

  constructor(options: MemoryOptions = {}) {
    this.points = options.points ?? new Map()
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${this.seq}`
  }

  async createPlan(input: { userId: string; title: string }): Promise<TripPlan> {
    const now = new Date()
    const plan: TripPlanWithDays = {
      id: this.nextId('plan'),
      userId: input.userId,
      title: input.title,
      status: 'draft',
      startDate: null,
      dayCount: 1,
      bangumiIds: [],
      preferences: null,
      stage: null,
      agentRunToken: null,
      agentBusyUntil: null,
      createdAt: now,
      updatedAt: now,
      days: [],
    }
    this.plans.set(plan.id, plan)
    const { days: _days, ...meta } = plan
    return { ...meta }
  }

  /**
   * S2：agentRunToken/agentBusyUntil 与 Prisma 行字段同语义——busy 位的真值
   * 存在 agentBusy 表里（beginAgentRun 写入、endAgentRun 清空、到期不删），
   * 读取时派生到返回值上，绝不落进 plans 存储避免双写漂移。
   */
  private agentFields(planId: string): Pick<TripPlan, 'agentRunToken' | 'agentBusyUntil'> {
    const busy = this.agentBusy.get(planId)
    return busy
      ? { agentRunToken: busy.token, agentBusyUntil: busy.until }
      : { agentRunToken: null, agentBusyUntil: null }
  }

  async listPlans(userId: string): Promise<TripPlan[]> {
    return [...this.plans.values()]
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(({ days: _days, ...meta }) => ({ ...meta, ...this.agentFields(meta.id) }))
  }

  async getPlan(id: string): Promise<TripPlanWithDays | null> {
    const plan = this.plans.get(id)
    return plan ? { ...structuredClone(plan), ...this.agentFields(id) } : null
  }

  /** P2-A：与 Prisma 投影同语义——null = 计划不存在；busy 派生自 agentBusy 表 */
  async getPlanAdmission(planId: string): Promise<{ userId: string; agentBusyUntil: Date | null } | null> {
    const plan = this.plans.get(planId)
    if (!plan) return null
    return { userId: plan.userId, agentBusyUntil: this.agentFields(planId).agentBusyUntil }
  }

  /** CUT-8：与 Prisma 投影同语义——null = 计划不存在，空串原样返回 */
  async getPlanTitle(planId: string): Promise<string | null> {
    return this.plans.get(planId)?.title ?? null
  }

  /** CUT-3：hasPointItem 谓词与 stageInputsOfPlan 逐字相同（非 null 且非空串） */
  async getStageInputs(planId: string): Promise<TripPlanStageInputs | null> {
    const plan = this.plans.get(planId)
    if (!plan) return null
    return {
      bangumiIds: plan.bangumiIds,
      startDate: plan.startDate,
      dayCount: plan.dayCount,
      hasPointItem: plan.days.some((day) => day.items.some((item) => item.pointId)),
    }
  }

  /** P2-B：与 Prisma 单条 SQL 同语义——busy 位（agentBusy 表派生）+ 阶段输入 + 全量消息一次返回；null = 计划不存在 */
  async getStartupRead(planId: string): Promise<TripPlanStartupRead | null> {
    const plan = this.plans.get(planId)
    if (!plan) return null
    return {
      agentRunToken: this.agentFields(planId).agentRunToken,
      stageInputs: {
        bangumiIds: plan.bangumiIds,
        startDate: plan.startDate,
        dayCount: plan.dayCount,
        hasPointItem: plan.days.some((day) => day.items.some((item) => item.pointId)),
      },
      messages: this.messages.filter((m) => m.planId === planId),
    }
  }

  async updateMeta(id: string, patch: TripPlanMetaUpdate): Promise<TripPlan> {
    const plan = this.plans.get(id)
    if (!plan) throw new Error(`plan not found: ${id}`)
    Object.assign(plan, patch, { updatedAt: this.touch() })
    const { days: _days, ...meta } = plan
    return { ...meta, ...this.agentFields(id) }
  }

  async replaceDays(id: string, days: TripPlanDayInput[]): Promise<TripPlanWithDays> {
    const plan = this.plans.get(id)
    if (!plan) throw new Error(`plan not found: ${id}`)
    plan.days = this.buildDays(id, days)
    plan.updatedAt = this.touch()
    return { ...structuredClone(plan), ...this.agentFields(id) }
  }

  /**
   * S2：与 Prisma 的条件 updateMany 同语义——updatedAt 不再等于期望值
   * （读取之后被并发保存改过）就整体不写并返回 null。检查与写入之间没有
   * await，单线程事件循环上不存在被插队的窗口。
   */
  async replaceDaysIfUnchanged(
    id: string,
    expectedUpdatedAt: Date,
    days: TripPlanDayInput[],
  ): Promise<TripPlanWithDays | null> {
    const plan = this.plans.get(id)
    if (!plan) return null
    if (plan.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return null
    return this.replaceDays(id, days)
  }

  private buildDays(planId: string, days: TripPlanDayInput[]): TripPlanDay[] {
    return days.map((day) => {
      const dayId = this.nextId('day')
      return {
        id: dayId,
        planId,
        dayIndex: day.dayIndex,
        date: day.date ?? null,
        citySlug: day.citySlug ?? null,
        summary: day.summary ?? null,
        items: day.items.map((item, sortOrder) => ({
          id: this.nextId('item'),
          dayId,
          sortOrder,
          type: item.type,
          pointId: item.pointId ?? null,
          timeHint: item.timeHint ?? null,
          title: item.title,
          note: item.note ?? null,
          reason: item.reason ?? null,
          payload: item.payload ?? null,
          point: item.pointId ? this.points.get(item.pointId) ?? null : null,
        })),
      }
    })
  }

  async countPlansCreatedSince(userId: string, since: Date): Promise<number> {
    return [...this.plans.values()].filter((p) => p.userId === userId && p.createdAt >= since).length
  }

  async appendMessage(planId: string, kind: TripPlanMessageKind, content: Prisma.JsonValue): Promise<TripPlanMessage> {
    return this.appendMessageEntry(planId, kind, content)
  }

  private appendMessageEntry(planId: string, kind: TripPlanMessageKind, content: Prisma.JsonValue): TripPlanMessage {
    const message: TripPlanMessage = {
      id: this.nextId('msg'),
      planId,
      kind,
      content,
      createdAt: new Date(),
    }
    this.messages.push(message)
    return message
  }

  async listMessages(planId: string): Promise<TripPlanMessage[]> {
    return this.messages.filter((m) => m.planId === planId)
  }

  async countHumanMessagesSince(userId: string, since: Date): Promise<number> {
    const planIds = new Set([...this.plans.values()].filter((p) => p.userId === userId).map((p) => p.id))
    return this.messages.filter((m) => planIds.has(m.planId) && m.kind === 'human' && m.createdAt >= since).length
  }

  async beginAgentRun(input: BeginAgentRunInput): Promise<BeginAgentRunResult> {
    const used = await this.countHumanMessagesSince(input.userId, input.since)
    if (used >= input.limit) return { status: 'quota_exceeded' }
    const prior = this.agentBusy.get(input.planId)
    if (prior && prior.until.getTime() > Date.now()) return { status: 'busy' }
    const token = this.nextId('run')
    // startedAt 随新 token 重置（与 Prisma beginAgentRun 的 data 一致）
    this.agentBusy.set(input.planId, { until: new Date(Date.now() + input.busyTtlMs), token, startedAt: null })
    // P2-A：inTx 在同一同步段里调用（内存版无真事务）；抛错按 Prisma 事务
    // 回滚同语义撤销——busy 位恢复原状、已落库的 human 消息移除
    let message: TripPlanMessage | null = null
    try {
      // content=null（resume 回合）：不追加 human 消息，历史原样
      if (input.content !== null) message = await this.appendMessage(input.planId, 'human', input.content)
      if (input.inTx) await input.inTx(undefined, { token })
    } catch (err) {
      if (prior) this.agentBusy.set(input.planId, prior)
      else this.agentBusy.delete(input.planId)
      if (message) {
        const removedId = message.id
        const idx = this.messages.findIndex((m) => m.id === removedId)
        if (idx >= 0) this.messages.splice(idx, 1)
      }
      throw err
    }
    return { status: 'ok', message, token }
  }

  async endAgentRun(planId: string, token: string): Promise<void> {
    if (this.agentBusy.get(planId)?.token === token) {
      this.agentBusy.delete(planId)
    }
  }

  /** 第八轮 F3：与 Prisma 的条件 updateMany 同语义——token 匹配才续租 */
  async renewAgentRun(planId: string, token: string, ttlMs: number): Promise<boolean> {
    const entry = this.agentBusy.get(planId)
    if (!entry || entry.token !== token) return false
    entry.until = new Date(Date.now() + ttlMs)
    return true
  }

  /**
   * CUT-1：与 renewAgentRun 逐字相同的 where/data 语义；命中才写并返回归属用户。
   * P0-A（2026-09-11）：内部执行入口已改走 claimAgentRun（还要求尚未启动），
   * 本方法保留但内部路由不再用它。
   */
  async renewAgentRunOwner(planId: string, token: string, ttlMs: number): Promise<{ userId: string } | null> {
    const entry = this.agentBusy.get(planId)
    if (!entry || entry.token !== token) return null
    entry.until = new Date(Date.now() + ttlMs)
    const plan = this.plans.get(planId)
    return plan ? { userId: plan.userId } : null
  }

  /**
   * P0-A（2026-09-11）联合方案 v1 不变量 1：一次性执行领取——token 匹配且
   * 尚未启动才成功，原子写 startedAt=now 并续租。已 started 返回 null 且
   * 不写（busyUntil 不动）。与 Prisma 的单条条件 UPDATE 同语义（单线程
   * 事件循环上检查与写入之间无 await，无插队窗口）。
   */
  async claimAgentRun(planId: string, token: string, ttlMs: number): Promise<{ userId: string } | null> {
    const entry = this.agentBusy.get(planId)
    if (!entry || entry.token !== token) return null
    if (entry.startedAt !== null) return null
    const now = new Date()
    entry.startedAt = now
    entry.until = new Date(now.getTime() + ttlMs)
    const plan = this.plans.get(planId)
    return plan ? { userId: plan.userId } : null
  }

  /** P0-A：服务端专用的租约状态读取（token 绝不进领域类型/view）；无 token 返回 null */
  async getAgentRunState(
    planId: string,
  ): Promise<{ token: string; busyUntil: Date | null; startedAt: Date | null } | null> {
    const entry = this.agentBusy.get(planId)
    if (!entry) return null
    return { token: entry.token, busyUntil: entry.until, startedAt: entry.startedAt }
  }

  /**
   * 第十一轮 A3（H2 修订）：与 Prisma 实现同语义——条件清空 + 持久 stopped
   * 日志 + 实况行停止标记。日志是 inferInterrupted/canResume 真正读的持久
   * 证据（不会被 GET 顺手清理回收）；loop 收尾以 runToken 去重不重复写。
   */
  async stopAgentRun(planId: string): Promise<boolean> {
    const token = this.agentBusy.get(planId)?.token
    if (!token) return false
    this.agentBusy.delete(planId)
    const logs = this.runLogs.filter((log) => log.planId === planId)
    const lastTurnIndex = logs.length ? logs[logs.length - 1]!.turnIndex : 0
    await this.appendRunLog({
      planId,
      runToken: token,
      turnIndex: lastTurnIndex + 1,
      stage: 'stopped',
      durationMs: 0,
    })
    await this.upsertRunLive(planId, { runToken: token, statusText: RUN_STOP_MARKER })
    return true
  }

  async isAgentRunStopped(planId: string, token: string): Promise<boolean> {
    return this.agentBusy.get(planId)?.token !== token
  }

  async isAgentBusy(planId: string): Promise<boolean> {
    const entry = this.agentBusy.get(planId)
    return Boolean(entry && entry.until.getTime() > Date.now())
  }

  async updateStage(planId: string, stage: string): Promise<void> {
    const plan = this.plans.get(planId)
    if (!plan) return
    plan.stage = stage
  }

  /** CUT-6：与 Prisma 的条件 updateMany 同语义——token 不匹配影响 0 行 */
  async updateStageIfActive(planId: string, token: string, stage: string): Promise<void> {
    if (!this.isCurrentHolder(planId, token)) return
    const plan = this.plans.get(planId)
    if (!plan) return
    plan.stage = stage
  }

  async appendRunLog(entry: TripPlanRunLogEntry): Promise<TripPlanRunLogRecord> {
    const record: TripPlanRunLogRecord = {
      ...entry,
      runToken: entry.runToken ?? null,
      id: this.nextId('runlog'),
      createdAt: new Date(),
    }
    this.runLogs.push(record)
    return record
  }

  async listRunLogs(planId: string): Promise<TripPlanRunLogRecord[]> {
    return this.runLogs.filter((log) => log.planId === planId)
  }

  /** F2：与 Prisma 的条件 updateMany 同语义——stopped 日志的 modelUsage 幂等覆盖 */
  async updateRunLogModelUsage(planId: string, runToken: string | null, modelUsage: Prisma.JsonValue): Promise<void> {
    for (const log of this.runLogs) {
      if (log.planId === planId && log.runToken === runToken && log.stage === 'stopped') {
        log.modelUsage = modelUsage
      }
    }
  }

  /** 第七轮 A1：与 Prisma 实现同语义（runToken 不同 = 接管重置；同 token 追加/保留） */
  async upsertRunLive(planId: string, patch: TripPlanRunLivePatch): Promise<TripPlanRunLiveRecord> {
    const existing = this.runLive.get(planId)
    const sameRun = existing !== undefined && existing.runToken === patch.runToken
    const reasoning = clampRunLiveReasoning(
      patch.reasoningReplace !== undefined
        ? patch.reasoningReplace
        : (sameRun ? existing.reasoning : '') + (patch.reasoningAppend ?? ''),
    )
    const record: TripPlanRunLiveRecord = {
      planId,
      runToken: patch.runToken,
      reasoning,
      // A3：停止标记粘性——同 run 的后续实况 flush 不冲掉 '__stop_requested__'，
      // 新 run（不同 token）接管时行被整体重置，标记自然消失
      statusText:
        sameRun && existing.statusText === RUN_STOP_MARKER && patch.statusText !== RUN_STOP_MARKER
          ? RUN_STOP_MARKER
          : sameRun && patch.statusText === undefined
            ? existing.statusText
            : patch.statusText ?? null,
      toolCalls: sameRun && patch.toolCalls === undefined ? existing.toolCalls : patch.toolCalls ?? null,
      updatedAt: new Date(),
    }
    this.runLive.set(planId, record)
    return { ...record }
  }

  async getRunLive(planId: string): Promise<TripPlanRunLiveRecord | null> {
    const record = this.runLive.get(planId)
    return record ? { ...record } : null
  }

  async clearRunLive(planId: string): Promise<void> {
    this.runLive.delete(planId)
  }

  /** §0.6.1 轻量快照：从现有存储组装（live 判定与 GET 同规则——busy 且 token 匹配） */
  async getRunSnapshotMeta(planId: string): Promise<TripPlanRunSnapshotMeta | null> {
    const plan = this.plans.get(planId)
    if (!plan) return null
    const messages = this.messages.filter((m) => m.planId === planId)
    const last = messages.length ? messages[messages.length - 1]! : null
    const agentBusy = await this.isAgentBusy(planId)
    let live: TripPlanRunSnapshotMeta['live'] = null
    if (agentBusy) {
      const row = this.runLive.get(planId)
      const holderToken = this.agentBusy.get(planId)?.token
      if (row && row.runToken === holderToken) {
        live = { ...row }
      }
    }
    return {
      agentBusy,
      planRevision: composePlanRevision({
        title: plan.title,
        status: plan.status,
        startDate: plan.startDate,
        dayCount: plan.dayCount,
        bangumiIds: plan.bangumiIds,
        stage: plan.stage,
        dayTotal: plan.days.length,
      }),
      messageCount: messages.length,
      lastMessageAt: last?.createdAt ?? null,
      live,
    }
  }

  private isCurrentHolder(planId: string, token: string): boolean {
    return this.agentBusy.get(planId)?.token === token
  }

  async appendMessageIfActive(
    planId: string,
    token: string,
    kind: TripPlanMessageKind,
    content: Prisma.JsonValue,
  ): Promise<TripPlanMessage | null> {
    if (!this.isCurrentHolder(planId, token)) return null
    return this.appendMessage(planId, kind, content)
  }

  async replaceDaysIfActive(planId: string, token: string, days: TripPlanDayInput[]): Promise<TripPlanWithDays | null> {
    if (!this.isCurrentHolder(planId, token)) return null
    return this.replaceDays(planId, days)
  }

  async updateMetaIfActive(planId: string, token: string, patch: TripPlanMetaUpdate): Promise<TripPlan | null> {
    if (!this.isCurrentHolder(planId, token)) return null
    return this.updateMeta(planId, patch)
  }

  /**
   * 内存版"事务"：token 校验、替换天数、构建 daymap、追加消息必须在同一
   * 个同步窗口内完成——全链路没有 await，并发调用既无法在两写之间交错，
   * 也无法在 token 校验后夺取所有权再看到旧持有者的写入。构建器运行在
   * 提交前的克隆快照上，抛错则两写都不发生（对齐 Prisma $transaction
   * 的回滚语义），绝不留下"天数已替换、交付物消息丢失"的半截成功状态。
   */
  private replaceDaysWithDaymapTx(
    planId: string,
    days: TripPlanDayInput[],
    buildDaymapContent: (plan: TripPlanWithDays) => Prisma.JsonValue,
  ): ReplaceDaysWithDaymapResult {
    const plan = this.plans.get(planId)
    if (!plan) throw new Error(`plan not found: ${planId}`)
    const nextDays = this.buildDays(planId, days)
    const updatedAt = this.touch()
    const snapshot: TripPlanWithDays = {
      ...structuredClone({ ...plan, days: nextDays, updatedAt }),
      ...this.agentFields(planId),
    }
    const content = buildDaymapContent(snapshot)
    plan.days = nextDays
    plan.updatedAt = updatedAt
    const message = this.appendMessageEntry(planId, 'daymap', content)
    return { plan: snapshot, message }
  }

  async replaceDaysWithDaymap(
    planId: string,
    days: TripPlanDayInput[],
    buildDaymapContent: (plan: TripPlanWithDays) => Prisma.JsonValue,
  ): Promise<ReplaceDaysWithDaymapResult> {
    return this.replaceDaysWithDaymapTx(planId, days, buildDaymapContent)
  }

  async replaceDaysWithDaymapIfActive(
    planId: string,
    token: string,
    days: TripPlanDayInput[],
    buildDaymapContent: (plan: TripPlanWithDays) => Prisma.JsonValue,
  ): Promise<ReplaceDaysWithDaymapResult | null> {
    if (!this.isCurrentHolder(planId, token)) return null
    return this.replaceDaysWithDaymapTx(planId, days, buildDaymapContent)
  }
}
