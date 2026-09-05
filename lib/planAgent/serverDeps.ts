import { createPlaceResolver, createPlacesRateWindow, type PlacePhotoRef, type PlaceResolver } from '@/lib/googlePlaces/places'
import { createNearbySearch, type NearbySearchResult } from '@/lib/googlePlaces/nearby'
import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'
import { getPrismaExternalPlaceStore } from '@/lib/googlePlaces/storePrisma'
import { fetchPlacePhotos as mirrorFetchPlacePhotos, mirrorPlacePhoto } from '@/lib/googlePlaces/photoMirror'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'
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
 *
 * 地点库修订（2026-09-02）：resolver 走"内存 → 库 → Google"阶梯；首次解析后
 * onResolved 在后台把照片镜像到 R2（ctx.waitUntil 是请求级绑定，调用时从当前
 * 请求读取，绝不缓存旧引用）。store 是进程级单例（Prisma 惰性代理）。
 */

export type PlanAgentTravelRequest = {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  mode: GoogleTravelMode
  departureTimeSec?: number
}

export type PlanAgentServerDeps = {
  places?: PlaceResolver
  /** 地点库（A2：save_plan_days 的 media enricher 按 placeId 回查 place.photo） */
  externalPlaces?: ExternalPlaceStore
  /** Place Details 整组照片补拉（A4 图片去重用；有 apiKey 时装配） */
  fetchPlacePhotos?: (input: {
    placeId: string
    onGoogleCall?: () => void
  }) => Promise<PlacePhotoRef[] | null>
  travel?: (input: PlanAgentTravelRequest) => Promise<TravelResult>
  /** 附近餐厅搜索（A3 find_restaurants；与 places 共享限速窗口） */
  findRestaurants?: (input: {
    lat: number
    lng: number
    radiusM?: number
    keyword?: string
    onGoogleCall?: () => void
  }) => Promise<NearbySearchResult>
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

/**
 * 后台任务派发：优先当前请求的 ctx.waitUntil；无绑定时浮动 promise（绝不冒泡）。
 * 导出供 loop 的补齐续跑（R4/S1）做生产缺省——route 不注入 deps.runInBackground
 * 时也必须在 Cloudflare 上经 waitUntil 延长隔离体生命周期，否则 61s 的 sleep
 * 随响应结束被销毁，续跑永远醒不来。
 */
export function runInBackground(task: () => Promise<unknown>): void {
  // ctx.waitUntil 必须以 ctx 为 this 调用——先取 ctx 再方法调用，绝不把
  // 方法引用单独传出（脱离 ctx 会抛 "Illegal invocation"，回归第五轮 R1）
  const ctx = getCfBindings()?.ctx
  const promise = Promise.resolve()
    .then(task)
    .catch((err) => {
      console.warn('[planAgent] background task failed', err)
    })
  if (ctx?.waitUntil) ctx.waitUntil(promise)
  else void promise
}

export function buildPlanAgentServerDeps(options: {
  apiKey: string
  rateKey: string
  fetchImpl?: typeof fetch
  /** 测试注入封面阶梯（缺省用 Prisma + bgm.tv 的默认查表） */
  coverLookup?: WorkCoverLookup
  /** 测试注入地点库（缺省用 Prisma 单例） */
  placeStore?: ExternalPlaceStore
}): PlanAgentServerDeps {
  const coverLookup = options.coverLookup ?? createDefaultWorkCoverLookup()
  const placeStore = options.placeStore ?? getPrismaExternalPlaceStore()
  // Places 全家桶（Text Search 解析 + Nearby Search 餐厅搜索）共用同一限速
  // 窗口：同一计划合计 60 次/分钟（R3 上调，与 enrich 预算 40 对齐），配额有界且互相可见
  const placesRateWindow = createPlacesRateWindow()
  const places = options.apiKey
    ? createPlaceResolver({
        apiKey: options.apiKey,
        rateKey: options.rateKey,
        rateWindow: placesRateWindow,
        fetchImpl: options.fetchImpl,
        store: placeStore,
        // 首次解析（打了 Google）→ 后台镜像照片到 R2；bucket 从当前请求读取
        onResolved: (place) =>
          runInBackground(() =>
            mirrorPlacePhoto({
              store: placeStore,
              bucket: getCfBindings()?.env?.MAP_IMAGE_CACHE,
              apiKey: options.apiKey,
              fetchImpl: options.fetchImpl,
              place,
            }),
          ),
      })
    : undefined
  return {
    ...(places ? { places } : {}),
    // 地点库单例直传：media enricher 用它给被模型裁剪的 place 回填 photo
    externalPlaces: placeStore,
    // A4 图片去重：整组照片补拉（onGoogleCall 先于真实外呼回调，计量 places 预算）
    ...(options.apiKey
      ? {
          fetchPlacePhotos: (input: { placeId: string; onGoogleCall?: () => void }) => {
            input.onGoogleCall?.()
            return mirrorFetchPlacePhotos({
              placeId: input.placeId,
              apiKey: options.apiKey,
              fetchImpl: options.fetchImpl,
            })
          },
        }
      : {}),
    ...(options.apiKey
      ? {
          travel: createTravelClient({ apiKey: options.apiKey, fetchImpl: options.fetchImpl }),
          // 结果写入 places 的内存缓存：模型照抄的餐厅地点可过 save_plan_days 出处校验
          findRestaurants: createNearbySearch({
            apiKey: options.apiKey,
            rateKey: options.rateKey,
            rateWindow: placesRateWindow,
            fetchImpl: options.fetchImpl,
            store: placeStore,
            ...(places ? { resolver: places } : {}),
          }),
        }
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
