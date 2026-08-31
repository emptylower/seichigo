import type { Prisma } from '@prisma/client'
import type {
  BeginAgentRunResult,
  TripPlan,
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
  private agentBusyUntil = new Map<string, Date>()
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
    plan.days = days.map((day) => {
      const dayId = this.nextId('day')
      return {
        id: dayId,
        planId: id,
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
    plan.updatedAt = new Date()
    return structuredClone(plan)
  }

  async countPlansCreatedSince(userId: string, since: Date): Promise<number> {
    return [...this.plans.values()].filter((p) => p.userId === userId && p.createdAt >= since).length
  }

  async appendMessage(planId: string, kind: TripPlanMessageKind, content: Prisma.JsonValue): Promise<TripPlanMessage> {
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
    const busyUntil = this.agentBusyUntil.get(input.planId)
    if (busyUntil && busyUntil.getTime() > Date.now()) return { status: 'busy' }
    this.agentBusyUntil.set(input.planId, new Date(Date.now() + input.busyTtlMs))
    const message = await this.appendMessage(input.planId, 'human', input.content)
    return { status: 'ok', message }
  }

  async endAgentRun(planId: string): Promise<void> {
    this.agentBusyUntil.delete(planId)
  }
}
