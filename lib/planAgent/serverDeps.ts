import { createPlaceResolver, type PlaceResolver } from '@/lib/googlePlaces/places'
import { createTravelClient, type GoogleTravelMode, type TravelResult } from '@/lib/directions/googleClient'
import { createDefaultWorkCoverLookup, resolveWorkCover, type WorkCover, type WorkCoverLookup } from '@/lib/planAgent/coverImage'

/**
 * plan agent 的服务端外部依赖装配（M3）：Google Places 解析、Google Directions
 * 真实交通查询、ask 选项封面补齐。route.ts 保持薄壳，全部注入 toolDeps。
 * API key 只在服务端拼接，绝不进入任何返回给模型/前端的字段。
 *
 * M3 修订：依赖按计划（rateKey）隔离——Places 的限速/缓存与 Directions 的
 * 限速/缓存都挂在各自计划的实例上，绝不共享（否则第一个请求的 planId 会
 * 通过全局缓存泄漏给所有后续计划）。实例本身按 planId 有界缓存，跨请求
 * 复用同一计划的配额窗口与结果缓存。
 */

export type PlanAgentTravelRequest = {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  mode: GoogleTravelMode
  departureTimeSec?: number
}

export type PlanAgentServerDeps = {
  places?: PlaceResolver
  travel?: (input: PlanAgentTravelRequest) => Promise<TravelResult>
  resolveOptionCover?: (input: { bangumiId?: number; label: string }) => Promise<WorkCover | null>
}

/** 有界 per-plan 实例缓存：超过上限逐出最旧计划 */
const PER_PLAN_DEPS_MAX = 64
const perPlanDeps = new Map<string, PlanAgentServerDeps>()

function evictOldestIfFull(): void {
  if (perPlanDeps.size < PER_PLAN_DEPS_MAX) return
  const oldest = perPlanDeps.keys().next().value
  if (oldest !== undefined) perPlanDeps.delete(oldest)
}

export function buildPlanAgentServerDeps(options: {
  apiKey: string
  rateKey: string
  fetchImpl?: typeof fetch
  /** 测试注入封面阶梯（缺省用 Prisma + bgm.tv 的默认查表） */
  coverLookup?: WorkCoverLookup
}): PlanAgentServerDeps {
  const coverLookup = options.coverLookup ?? createDefaultWorkCoverLookup()
  return {
    ...(options.apiKey
      ? { places: createPlaceResolver({ apiKey: options.apiKey, rateKey: options.rateKey, fetchImpl: options.fetchImpl }) }
      : {}),
    ...(options.apiKey
      ? { travel: createTravelClient({ apiKey: options.apiKey, fetchImpl: options.fetchImpl }) }
      : {}),
    // 站内 bangumiId 与 bgm.tv subject id 同源（M1 模型决策），封面阶梯的第三级
    // 兜底用同一个规范 id：Anitabi 封面 → 站内 Anime 映射封面 → bgm.tv 条目封面。
    // 只读取查表，绝不回写任何库表。
    resolveOptionCover: (input) =>
      resolveWorkCover({ bangumiId: input.bangumiId, bgmSubjectId: input.bangumiId }, coverLookup),
  }
}

export function getPlanAgentServerDeps(rateKey: string): PlanAgentServerDeps {
  const existing = perPlanDeps.get(rateKey)
  if (existing) return existing

  const apiKey = process.env.GOOGLE_DIRECTIONS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''
  if (!apiKey) {
    console.warn('[planAgent] GOOGLE_DIRECTIONS_API_KEY not set, place/travel tools will report config errors')
  }

  const deps = buildPlanAgentServerDeps({ apiKey, rateKey })
  evictOldestIfFull()
  perPlanDeps.set(rateKey, deps)
  return deps
}
