import type { Prisma } from '@prisma/client'
import type { TripPlanDay, TripPlanDayInput, TripPlanRepo } from '@/lib/tripPlan/repo'
import type { PointFinder } from './points'
import { dayHasBackfillCandidate } from './placeBackstop'
import { createEnrichBudget, readTravelMode, type EnrichContext, type EnrichDay, type EnrichReport } from './enrich/types'
import { enrichAndNormalizeDays } from './enrichPipeline'
import { costOfGoogleCalls, EMPTY_GOOGLE_CALLS, summarizeRunCost } from '@/lib/billing/cost'
import type { Entitlements } from '@/lib/billing/tiers'

/**
 * 补齐续跑（R4）：run 结束时若最后一次保存仍有「预算已用完」类 skipped 或
 * restaurantPending 条目，服务端在后台**不叫模型**再跑补齐脚本，把缺口补上。
 * 每轮先 sleep 一个预算窗口（60s）再干活；新 run 接管（token 被别的持有者
 * 占用或 busy 位仍活）立即结束；写回走双重守卫（S2）——写前重读计划确认
 * token 未被换且无活跃 run，再用轮首的 updatedAt 做乐观版本守卫
 * （replaceDaysIfUnchanged），enrich 期间被任何并发保存改过就放弃本轮。
 * 任何异常只 console.warn，绝不抛出。
 */

/** skipped 理由命中「预算已用完」或英文 budget 字样即视为需要续跑 */
function isBudgetExhaustedReason(reason: string): boolean {
  return reason.includes('预算已用完') || reason.toLowerCase().includes('budget')
}

/** payload（unknown）里是否带服务端标记 restaurantPending === true */
function hasRestaurantPending(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false
  return (payload as Record<string, unknown>).restaurantPending === true
}

/**
 * 判定是否需要补齐续跑：报告里有预算耗尽类 skipped，或（调用方传入的天数据）
 * applied 之外仍存在 restaurantPending 的午餐/晚餐条目。
 */
export function planNeedsContinuation(
  report: EnrichReport | null,
  days?: Array<{ items: Array<{ type: string; payload?: unknown }> }>,
): boolean {
  if (report?.skipped.some((skip) => isBudgetExhaustedReason(skip.reason))) return true
  if (days?.some((day) => day.items.some((item) => item.type === 'meal' && hasRestaurantPending(item.payload)))) {
    return true
  }
  return false
}

export type EnrichContinuationInput = {
  planId: string
  runToken: string | null
  repo: TripPlanRepo
  points: PointFinder
  /** serverDeps 里的 Google 依赖（places/externalPlaces/findRestaurants/travel/fetchPlacePhotos） */
  deps: EnrichContext['deps']
  /** 档位能力表（G8）：免费档续跑不发餐厅/交通外呼 */
  entitlements?: Entitlements
  /** 本轮续跑的真实 Google 外呼成本回调（G8：route 注入 billing.chargeExtra）；失败只 warn */
  onExtraCost?: (micros: number) => Promise<void>
  /** 最多补几轮（缺省 2） */
  maxPasses?: number
  /** 每轮先等多久让 60s 预算/限速窗口滚动（缺省 61s） */
  waitMs?: number
  /** 可注入 sleep（测试立即返回） */
  sleep?: (ms: number) => Promise<void>
}

/** Prisma.JsonValue → Record（非对象/数组/空一律 null；payload 原样、type 保留） */
function payloadRecordOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function toEnrichDays(planDays: TripPlanDay[]): EnrichDay[] {
  return planDays.map((day) => ({
    dayIndex: day.dayIndex,
    date: day.date,
    citySlug: day.citySlug,
    summary: day.summary,
    items: day.items.map((item) => ({
      type: item.type,
      title: item.title,
      pointId: item.pointId,
      timeHint: item.timeHint,
      note: item.note,
      reason: item.reason,
      payload: payloadRecordOf(item.payload),
    })),
  }))
}

export async function runEnrichContinuation(input: EnrichContinuationInput): Promise<void> {
  const maxPasses = input.maxPasses ?? 2
  const waitMs = input.waitMs ?? 61_000
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  try {
    for (let pass = 1; pass <= maxPasses; pass++) {
      await sleep(waitMs) // 让 60s 预算窗口滚动
      const plan = await input.repo.getPlan(input.planId)
      if (!plan) return
      // S2 栅栏：token 已被别的持有者占用 → 新 run 在跑，直接结束；token 已
      // 清空（本次 run 正常收尾）不算接管。busy 位仍活着的持有者同样接管
      if (plan.agentRunToken !== null && plan.agentRunToken !== input.runToken) return
      // 新 run 已接管（busy 位被别的 token 持有）→ 直接结束，不与新 run 交叉写
      if (await input.repo.isAgentBusy(input.planId).catch(() => false)) return

      const days = toEnrichDays(plan.days)
      const passStartedAt = Date.now()
      // 构造与 save_plan_days 相同的 EnrichContext：批量取点位坐标 + 按天质心；
      // 预算每轮新建（窗口已随 sleep 滚动）
      const allPointIds = [
        ...new Set(days.flatMap((day) => day.items.filter((i) => i.pointId).map((i) => i.pointId as string))),
      ]
      const pointCoords = allPointIds.length ? await input.points.getPointsByIds(allPointIds, plan.bangumiIds ?? []) : []
      const coordsByPointId = new Map(
        pointCoords.map((p) => [p.id, { lat: p.lat, lng: p.lng, ...(p.image !== undefined ? { image: p.image } : {}) }]),
      )
      const coordsByDay = new Map<number, Array<{ lat: number; lng: number }>>()
      for (const day of days) {
        if (!dayHasBackfillCandidate(day.items)) continue
        const coords: Array<{ lat: number; lng: number }> = []
        for (const item of day.items) {
          if (item.pointId) {
            const hit = coordsByPointId.get(item.pointId)
            if (hit) coords.push({ lat: hit.lat, lng: hit.lng })
            continue
          }
          const place = item.payload?.place
          if (place && typeof place === 'object' && !Array.isArray(place)) {
            const lat = Number((place as Record<string, unknown>).lat)
            const lng = Number((place as Record<string, unknown>).lng)
            if (Number.isFinite(lat) && Number.isFinite(lng)) coords.push({ lat, lng })
          }
        }
        coordsByDay.set(day.dayIndex, coords)
      }
      const travelMode = readTravelMode(plan.preferences)
      // F3：续跑补齐的 Google 调用同样计量——预算自带 calls 计数，写日志时
      // 经 summarizeRunCost 汇总成 modelUsage（此前固定 null 会漏计成本）。
      // G8：预算上限与 EnrichContext 都带档位——免费档不发餐厅/交通外呼
      const budget = createEnrichBudget()
      if (input.entitlements) {
        budget.places.max = input.entitlements.placesMax
        budget.directions.max = input.entitlements.directionsMax
      }
      const ctx: EnrichContext = {
        deps: input.deps,
        coordsByPointId,
        dayCoordinates: (dayIndex) => coordsByDay.get(dayIndex) ?? [],
        ...(travelMode ? { travelMode } : {}),
        ...(input.entitlements ? { entitlements: input.entitlements } : {}),
        budget,
      }
      const { enrich, schedule } = await enrichAndNormalizeDays(days, ctx)
      // G8：本轮真实外呼立即计费（写回失败成本也已发生，不能因放弃写回漏账）
      const passCalls = budget.calls
      if (
        input.onExtraCost &&
        passCalls &&
        (passCalls.directions || passCalls.placesTextSearch || passCalls.placesNearby || passCalls.placeDetails)
      ) {
        try {
          await input.onExtraCost(costOfGoogleCalls(passCalls))
        } catch (err) {
          console.warn('[planAgent] enrich continuation onExtraCost failed', err)
        }
      }
      if (!schedule.ok) return // 归一化失败：放弃本轮（不落库）
      const normalizedDays: TripPlanDayInput[] = schedule.normalizedDays
      normalizedDays.sort((a, b) => a.dayIndex - b.dayIndex)
      normalizedDays.forEach((day, i) => {
        day.dayIndex = i + 1
      })
      // S2：写回前再读一次计划——enrich 期间可能被新 run 接管；token 仍与
      // 轮首一致且无活跃 run 才允许写，且用轮首读到的 updatedAt 做乐观版本
      // 守卫：enrich 期间任何并发保存改过计划 → replaceDaysIfUnchanged 返回
      // null → 放弃本轮（不写回、不写日志），绝不覆盖别人的写入
      const planNow = await input.repo.getPlan(input.planId)
      if (!planNow) return
      if (planNow.agentRunToken !== plan.agentRunToken) return
      if (await input.repo.isAgentBusy(input.planId).catch(() => false)) return
      const replaced = await input.repo.replaceDaysIfUnchanged(input.planId, plan.updatedAt, normalizedDays)
      if (!replaced) return
      const durationMs = Date.now() - passStartedAt
      // S7：turnIndex 取现有日志的最大值 +1——同毫秒到达/乱序写入的日志
      // 会让"取最后一条 +1"倒退或重复
      const logs = await input.repo.listRunLogs(input.planId)
      const turnIndex = logs.reduce((max, log) => Math.max(max, log.turnIndex), 0) + 1
      await input.repo.appendRunLog({
        planId: input.planId,
        runToken: input.runToken ?? null,
        turnIndex,
        stage: 'enrich',
        enrichReport: enrich as Prisma.JsonValue,
        gateReport: null,
        toolCalls: [{ name: 'enrich_continuation', durationMs }] as unknown as Prisma.JsonValue,
        modelUsage: summarizeRunCost({
          usageByModel: new Map(),
          calls: budget.calls ?? { ...EMPTY_GOOGLE_CALLS },
          modelCalls: 0,
          usageMissing: false,
          withTitle: false,
        }) as unknown as Prisma.JsonValue,
        durationMs,
      })
      if (!planNeedsContinuation(enrich, days)) return
    }
  } catch (err) {
    console.warn('[planAgent] enrich continuation failed', err)
  }
}
