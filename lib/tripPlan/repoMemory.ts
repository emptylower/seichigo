import type { Prisma } from '@prisma/client'
import type {
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
  TripPlanWithDays,
} from './repo'
import { clampRunLiveReasoning, RUN_STOP_MARKER } from './repo'

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
  private agentBusy = new Map<string, { until: Date; token: string }>()
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

  async beginAgentRun(input: {
    planId: string
    userId: string
    content: Prisma.JsonValue | null
    since: Date
    limit: number
    busyTtlMs: number
  }): Promise<BeginAgentRunResult> {
    const used = await this.countHumanMessagesSince(input.userId, input.since)
    if (used >= input.limit) return { status: 'quota_exceeded' }
    const existing = this.agentBusy.get(input.planId)
    if (existing && existing.until.getTime() > Date.now()) return { status: 'busy' }
    const token = this.nextId('run')
    this.agentBusy.set(input.planId, { until: new Date(Date.now() + input.busyTtlMs), token })
    // content=null（resume 回合）：不追加 human 消息，历史原样
    if (input.content === null) return { status: 'ok', message: null, token }
    const message = await this.appendMessage(input.planId, 'human', input.content)
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
