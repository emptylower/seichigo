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
  TripPlanWithDays,
} from './repo'

type MemoryOptions = {
  points?: Map<string, TripPlanPointLite>
}

export class MemoryTripPlanRepo implements TripPlanRepo {
  private plans = new Map<string, TripPlanWithDays>()
  private messages: TripPlanMessage[] = []
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
      createdAt: now,
      updatedAt: now,
      days: [],
    }
    this.plans.set(plan.id, plan)
    const { days: _days, ...meta } = plan
    return { ...meta }
  }

  async listPlans(userId: string): Promise<TripPlan[]> {
    return [...this.plans.values()]
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(({ days: _days, ...meta }) => ({ ...meta }))
  }

  async getPlan(id: string): Promise<TripPlanWithDays | null> {
    const plan = this.plans.get(id)
    return plan ? structuredClone(plan) : null
  }

  async updateMeta(id: string, patch: TripPlanMetaUpdate): Promise<TripPlan> {
    const plan = this.plans.get(id)
    if (!plan) throw new Error(`plan not found: ${id}`)
    Object.assign(plan, patch, { updatedAt: new Date() })
    const { days: _days, ...meta } = plan
    return { ...meta }
  }

  async replaceDays(id: string, days: TripPlanDayInput[]): Promise<TripPlanWithDays> {
    const plan = this.plans.get(id)
    if (!plan) throw new Error(`plan not found: ${id}`)
    plan.days = this.buildDays(id, days)
    plan.updatedAt = new Date()
    return structuredClone(plan)
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
    content: Prisma.JsonValue
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
    const message = await this.appendMessage(input.planId, 'human', input.content)
    return { status: 'ok', message, token }
  }

  async endAgentRun(planId: string, token: string): Promise<void> {
    if (this.agentBusy.get(planId)?.token === token) {
      this.agentBusy.delete(planId)
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
    const updatedAt = new Date()
    const snapshot: TripPlanWithDays = structuredClone({ ...plan, days: nextDays, updatedAt })
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
