import type OpenAI from 'openai'
import type { Prisma } from '@prisma/client'
import { clusterIntoDays } from './cluster'
import type { BgmSubject, PointFinder } from './points'
import { TRIP_PLAN_ITEM_TYPES, type TripPlanDayInput, type TripPlanRepo, type TripPlanWithDays } from '@/lib/tripPlan/repo'
import { toPlanView } from '@/lib/tripPlan/view'
import { RunFencedError } from './runFence'
import {
  AskUserSignal,
  ASK_USER_KINDS,
  isAskUserTaskType,
  type AskUserKind,
  type AskUserOption,
} from './askUser'
import { buildValidatedAskOptions, isAskOptionGateError, type AskChoiceTaskType } from './askOptions'
import { dayHasBackfillCandidate } from './placeBackstop'
import { parseSavePlanDaysInput, type ParsedSaveDays } from './savePlanInput'
import { validateExternalPlacePayload, type PlaceResolver } from '@/lib/googlePlaces/places'
import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'
import type { NearbySearchResult } from '@/lib/googlePlaces/nearby'
import { type GoogleTravelMode, type TravelResult } from '@/lib/directions/googleClient'
import {
  assertPointsResolvable,
  collectPlanPlaces,
  placesToolBudgetExhausted,
  verifyPlaceAgainstCanonical,
  runEstimateTravelTool,
  runEstimateTransitTool,
  BUDGET_EXHAUSTED_RESULT,
} from './travelHelpers'
import { createEnrichBudget, readTravelMode, type EnrichBudget, type EnrichContext, type EnrichReport } from './enrich'
import { scheduleFailureSummary } from './enrich/scheduleEnricher'
import { enrichAndNormalizeDays } from './enrichPipeline'
import { evaluatePlanGates, type PlanQualityReport } from './gates'
import type { WorkCover } from './coverImage'
import type { DaymapMessagePayload } from '@/lib/tripPlan/view'

export type PlanAgentToolDeps = {
  planId: string
  repo: TripPlanRepo
  points: PointFinder
  bgmSearch?: (keyword: string) => Promise<BgmSubject[]>
  onPlanUpdated?: () => void
  /** save_plan_days 成功后实时下发 daymap 交付快照（SSE；与落库载荷同构） */
  onDaymapSaved?: (daymap: DaymapMessagePayload) => void
  /** Google Places 地点解析（M3；外部非巡礼地点） */
  places?: PlaceResolver
  /** 地点库（A2：media enricher 按 placeId 回查被裁剪的 place.photo；serverDeps 注入） */
  externalPlaces?: ExternalPlaceStore
  /** Place Details 整组照片补拉（A4 图片去重；serverDeps 注入） */
  fetchPlacePhotos?: EnrichContext['deps']['fetchPlacePhotos']
  /** Google Places 附近餐厅搜索（A3；meal 条目推荐，注入便于测试） */
  findRestaurants?: (input: {
    lat: number
    lng: number
    radiusM?: number
    keyword?: string
    onGoogleCall?: () => void
  }) => Promise<NearbySearchResult>
  /** Google Directions 真实交通查询（M3；注入便于测试） */
  travel?: (input: {
    origin: { lat: number; lng: number }
    destination: { lat: number; lng: number }
    mode: GoogleTravelMode
    departureTimeSec?: number
  }) => Promise<TravelResult>
  /** ask 选项封面补齐（M3；按 bangumiId 走本地封面阶梯） */
  resolveOptionCover?: (input: { bangumiId?: number; label: string }) => Promise<WorkCover | null>
  /** save_plan_days 每次评估完门控后回传给 loop（M4：写运行日志用），通过与拒绝都回调 */
  onSaveEvaluated?: (r: { enrich: EnrichReport; quality: PlanQualityReport }) => void
  /**
   * Google 补齐预算（M4）：directions/places 分桶限量。由 loop 每个 run 创建
   * 一次，同一 run 内多次 save 共享（避免每次 save 重置预算重烧配额）；
   * 单独调用 executePlanTool 时缺省新建。
   */
  enrichBudget?: EnrichBudget
}

const POINT_ID_SCHEMA_HINT =
  '点位 id 是形如 "<bangumiId>:<rawId>" 的不透明字符串，必须原样使用 list_points 返回结果里的完整 id 字符串，不要截取、拆分或改写'

/**
 * save_plan_days 全部天数条目总和的硬上限。这个数字同时约束两头：
 * 批量化后单事务毫秒级完成（写入侧余量充足），以及单次 tool call 的
 * JSON 体积在模型输出预算内可控。超限必须在触碰任何 repo 方法/事务之前
 * 结构化拒绝，而不是让巨量数据捅到数据库层炸出原始事务超时。
 */
export const SAVE_PLAN_DAYS_MAX_TOTAL_ITEMS = 150

const itemSchema = {
  type: 'object' as const,
  properties: {
    type: { type: 'string', enum: TRIP_PLAN_ITEM_TYPES, description: '条目类型' },
    pointId: {
      type: 'string',
      description: `站内巡礼点位必填（type=point 且非外部地点时）。${POINT_ID_SCHEMA_HINT}。外部地点（resolve_place 解析的）不要填 pointId，改用 payload.place`,
    },
    title: { type: 'string', description: '条目标题（点位中文名/交通段/活动名）' },
    timeHint: { type: 'string', description: '时间提示，如“14:00”“午后”（服务端会归一成具体时间区间，宽泛词保留为备注）' },
    note: { type: 'string', description: '补充说明' },
    reason: { type: 'string', description: '为什么这么安排（面向用户展示）' },
    payload: {
      type: 'object',
      description:
        '结构化数据：外部地点放 place（照抄 resolve_place 的 place 对象）；真实交通照抄 estimate_travel 的 transportPayload（transport 字段）；图片放 media；显式时间可放 schedule={start,end,durationMin}',
      properties: {
        place: { type: 'object', description: '外部地点（resolve_place 返回的 place 字段原样照抄，含 placeId/name/lat/lng）' },
        schedule: {
          type: 'object',
          description: '显式时间（可选）：{start:"HH:mm", end:"HH:mm", durationMin:分钟}',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
            durationMin: { type: 'number' },
          },
        },
        transport: {
          type: 'object',
          description: '真实交通数据（照抄 estimate_travel 返回的 transportPayload：mode/durationMin/distanceKm/legs/polyline/provider/fetchedAt）',
          properties: {
            mode: { type: 'string', description: 'walk / transit / driving' },
            durationMin: { type: 'number' },
            distanceKm: { type: 'number' },
            legs: { type: 'array' },
            polyline: { type: 'array' },
            provider: { type: 'string' },
            fetchedAt: { type: 'string' },
          },
        },
        media: {
          type: 'object',
          description: '图片（照抄 resolve_place 的 media：source/displayUrl/attribution）',
          properties: {
            source: { type: 'string' },
            displayUrl: { type: 'string' },
            attribution: { type: 'string' },
          },
        },
        placeQuery: { type: 'string', description: '更适合检索的地点正式名（不确定正式名称时写这里，服务端保存时会自动解析补齐 place）' },
        // 兼容 M1 的扁平交通 payload（estimate_transit 时代）
        mode: { type: 'string', description: '兼容旧格式：walk / transit' },
        durationMin: { type: 'number' },
        distanceKm: { type: 'number' },
      },
    },
  },
  required: ['type', 'title'],
}

function tool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): OpenAI.Chat.Completions.ChatCompletionTool {
  return { type: 'function', function: { name, description, parameters } }
}

const travelEndpointSchema = (field: string) => ({
  type: 'object',
  description: `${field} 端点：三选一填 fromPointId/fromPlaceId/from 坐标（本对象内 lat+lng）`,
  properties: {
    pointId: { type: 'string', description: `站内点位 id。${POINT_ID_SCHEMA_HINT}` },
    placeId: { type: 'string', description: 'resolve_place 返回的 Google placeId（需已在计划中）' },
    lat: { type: 'number' },
    lng: { type: 'number' },
  },
})

export const PLAN_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  tool('search_anime', '按作品名（中文或日文，支持部分匹配）在站内点位库搜索圣地巡礼作品，返回 bangumiId 与封面 cover。规划前必须先用它确定作品。', {
    type: 'object',
    properties: { query: { type: 'string', description: '作品名关键词，如“上低音号”' } },
    required: ['query'],
  }),
  tool('search_bangumi_tv', '站内搜不到时，用 Bangumi(bgm.tv) 官方数据库解析作品简称/别名，返回候选作品及其是否在站内有点位（hasPoints）。仍不确定时把候选列给用户确认，绝不自行断定。', {
    type: 'object',
    properties: { keyword: { type: 'string', description: '用户的原话说法，或你猜测的正式名称' } },
    required: ['keyword'],
  }),
  tool('list_points', '列出某作品的全部有坐标巡礼点位（含中文名、经纬度、出现集数）。', {
    type: 'object',
    properties: {
      bangumiId: { type: 'number', description: 'search_anime 返回的作品 id' },
      limit: { type: 'number', description: '最多返回条数，默认 60' },
    },
    required: ['bangumiId'],
  }),
  tool('cluster_points', '把一组点位按地理位置聚成 N 天，并给出每天内的顺路访问顺序。这是确定性算法，排天分组必须用它，不要自己凭感觉分。', {
    type: 'object',
    properties: {
      pointIds: { type: 'array', items: { type: 'string' }, description: `要安排的点位 id 列表。${POINT_ID_SCHEMA_HINT}` },
      dayCount: { type: 'number', description: '巡礼天数' },
    },
    required: ['pointIds', 'dayCount'],
  }),
  tool(
    'estimate_travel',
    '查询两点之间的真实交通（Google Directions）：步行/公共交通/自驾，含线路、上下车站、站数、步行段与耗时距离。计划有精确日期时传 dayIndex+departureTime 按真实日期查询。日本境内的公交查询若查不到，会返回 estimated:true、provider:"estimate" 的参考估算值（按道路距离推算，附 mapsUrl）——直接采用并在 reason 注明是参考估算即可，不要再为此发起提问。日本以外公交查不到会返回 zero_results——此时必须用 ask_user 问用户是否改自驾/租车，不要悄悄改成纯步行。写 transit 条目时把返回的 transportPayload 原样放进条目 payload.transport。',
    {
      type: 'object',
      properties: {
        from: travelEndpointSchema('起点'),
        to: travelEndpointSchema('终点'),
        mode: { type: 'string', enum: ['walk', 'transit', 'driving'], description: '交通方式：步行 walk / 公共交通 transit / 自驾 driving' },
        dayIndex: { type: 'number', description: '第几天（从 1 开始），配合计划出发日期计算真实出发时刻' },
        departureTime: { type: 'string', description: '当天出发时刻 "HH:mm"（可选，默认 09:00）' },
      },
      required: ['from', 'to', 'mode'],
    },
  ),
  tool('estimate_transit', '（旧版本地启发式估算，≤1.5km 步行其余公交）优先使用 estimate_travel 获取真实数据；仅在外部服务不可用时兜底。', {
    type: 'object',
    properties: {
      fromPointId: { type: 'string', description: POINT_ID_SCHEMA_HINT },
      toPointId: { type: 'string', description: POINT_ID_SCHEMA_HINT },
    },
    required: ['fromPointId', 'toPointId'],
  }),
  tool(
    'resolve_place',
    '把用户提到的非巡礼地点（如“东京迪士尼”“涩谷天空”）解析成真实坐标地点（Google Places，自动取第一个结果；有地点库缓存，重复调用不烧配额）。返回 place 对象与图片 media：保存行程时把 place 原样放进条目的 payload.place、media 放进 payload.media；该条目不要再填 pointId。查不到会显式报错——绝不要编造地点。',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: '地点名称/关键词，尽量用官方名称' },
        nearLat: { type: 'number', description: '附近点位坐标，用于消歧' },
        nearLng: { type: 'number', description: '附近点位坐标，用于消歧' },
      },
      required: ['query'],
    },
  ),
  tool(
    'find_restaurants',
    '按坐标搜索附近餐厅（Google Places Nearby Search：type=restaurant，默认半径 800m，可选 keyword 如"拉面"）。返回按 评分×log(评价数) 排序的前 5 家，每家附 rating/userRatingsTotal/priceLevel/place（照抄进 meal 条目 payload.place，含 provider/placeId）/photo 与可照抄的 optionProvenance。安排用餐条目前必须先用它：以用餐前最后一个点位的坐标为中心搜索，选评分最高且顺路的一家；note 里列出另外 1–2 家备选（名称+评分）。不要凭记忆编造餐厅。午餐、晚餐固定推荐餐厅，禁止写自理。',
    {
      type: 'object',
      properties: {
        lat: { type: 'number', description: '搜索中心纬度（用餐前最后一个点位坐标）' },
        lng: { type: 'number', description: '搜索中心经度' },
        radiusM: { type: 'number', description: '搜索半径（米，默认 800，上限 50000）' },
        keyword: { type: 'string', description: '可选关键词，如"拉面""寿司"' },
      },
      required: ['lat', 'lng'],
    },
  ),
  tool('read_plan', '读取当前计划的完整结构（标题、天数、每日条目）。', { type: 'object', properties: {} }),  tool('update_plan_meta', '更新计划元信息：标题、总天数、出发日期（ISO 日期字符串）、关联作品 id。', {
    type: 'object',
    properties: {
      title: { type: 'string' },
      dayCount: { type: 'number' },
      startDate: { type: 'string', description: 'ISO 日期，如 2026-09-15；传空字符串清除' },
      bangumiIds: { type: 'array', items: { type: 'number' } },
    },
  }),
  tool(
    'save_plan_days',
    '整份行程的完整替换保存：每次调用都会覆盖旧的全部天数，必须一次性传入完整的多天内容，绝不能分批多次调用（分批会互相覆盖导致已保存的行程丢失）。每天是一个按访问顺序排列的条目时间线：站内点位条目挂 pointId；外部地点条目（迪士尼等）挂 payload.place；点位之间插入 transit 条目并在 payload.transport 照抄 estimate_travel 的 transportPayload。每个安排都写 reason。这是计划的唯一落库方式，规划结果必须通过它保存。服务端会自动把所有条目归一成具体时间区间并按时间排序。全部天数条目总和上限 150 条，超出会被直接拒绝。',
    {
      type: 'object',
      properties: {
        days: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dayIndex: { type: 'number', description: '第几天，从 1 开始' },
              citySlug: { type: 'string', description: '当天主要城市，如 kyoto' },
              summary: { type: 'string', description: '当天一句话概述' },
              items: { type: 'array', items: itemSchema },
            },
            required: ['dayIndex', 'items'],
          },
        },
      },
      required: ['days'],
    },
  ),
  tool(
    'ask_user',
    '当需要用户做选择或提供关键信息时调用，前端会渲染成结构化的交互组件而不是纯文字提问。必须显式声明 taskType（提问的任务类型）：date_range=问出行日期与天数（只能配 kind=date_range，不带 options）；work_selection=让用户挑选巡礼作品/候选作品（配 single_choice/multi_choice，选项可带 bangumiId，服务端自动补封面与规范出处）；opinion=征求方案意见——出行方式（如"山区行程以自驾/租车、公共交通还是混合方式为主"）、节奏松紧、预算倾向等用户决策（配 single_choice/multi_choice，选项是纯文本，绝不带 bangumiId/image，也不能当作品选择发起）。调用后本轮对话结束，等待用户通过组件提交答案。意见题（taskType=opinion）的选项列表末位会由系统自动保留一个"自行输入"入口，不要自己重复添加；作品选择（taskType=work_selection）没有卡内自定义入口，用户想自由输入时会用全局聊天输入框回答。最多提供 19 个选项。证据契约：每个非自定义选项必须带齐 sourceKind + sourceUrl + fetchedAt 三件套出处——作品类选项带 bangumiId（服务端自动补规范出处与封面）；地点类选项照抄 resolve_place 返回的 optionProvenance；纯偏好类选项（意见题的绝大多数）显式加 preferenceOnly: true。无出处的选项会被直接拒绝。',
    {
      type: 'object',
      properties: {
        taskType: {
          type: 'string',
          enum: ['date_range', 'work_selection', 'opinion'],
          description: '任务类型：问日期=date_range；选作品=work_selection；征求出行方式/节奏/预算等意见=opinion',
        },
        kind: { type: 'string', enum: ['date_range', 'single_choice', 'multi_choice'], description: '交互组件类型（交互基数）：date_range 只能配 taskType=date_range' },
        prompt: { type: 'string', description: '给用户看的提问文案' },
        options: {
          type: 'array',
          description: 'taskType=work_selection/opinion 且 kind=single_choice/multi_choice 时必填，候选项列表（最多 19 个；opinion 的"自行输入"入口由系统追加）',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              sublabel: { type: 'string', description: '可选副标题，如"47 个点位"/取舍说明' },
              image: { type: 'string', description: '可选封面图 URL（仅 work_selection；作品封面可留空并给 bangumiId，服务端自动补）' },
              bangumiId: { type: 'number', description: '仅 work_selection：作品类选项可带，服务端据此补齐本地封面与规范出处' },
              sourceKind: { type: 'string', description: '来源类型：anitabi / bangumi / google_places 等（必填，除非 preferenceOnly）' },
              sourceUrl: { type: 'string', description: '来源 URL 或稳定标识（必填，除非 preferenceOnly）' },
              fetchedAt: { type: 'string', description: '工具返回的取数时间 ISO 字符串（必填，除非 preferenceOnly）' },
              preferenceOnly: { type: 'boolean', description: '纯偏好类选项（无外部事实）时为 true，可免出处三件套' },
            },
            required: ['id', 'label'],
          },
        },
        allowSkip: { type: 'boolean', description: '是否允许用户跳过这个问题，默认 false' },
      },
      required: ['taskType', 'kind', 'prompt'],
    },
  ),
]

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

export async function executePlanTool(deps: PlanAgentToolDeps, name: string, input: unknown): Promise<string> {
  const args = asRecord(input)
  try {
    switch (name) {
      case 'search_anime': {
        const query = String(args.query ?? '').trim()
        if (!query) return JSON.stringify({ error: 'query 不能为空' })
        const results = await deps.points.searchBangumi(query, 8)
        return JSON.stringify({ results })
      }
      case 'search_bangumi_tv': {
        const keyword = String(args.keyword ?? '').trim()
        if (!keyword) return JSON.stringify({ error: 'keyword 不能为空' })
        if (!deps.bgmSearch) return JSON.stringify({ error: 'bgm.tv 搜索当前不可用，请向用户询问作品官方名称' })
        const subjects = await deps.bgmSearch(keyword)
        if (!subjects.length) {
          return JSON.stringify({ candidates: [], hint: '未找到候选，请向用户询问作品官方名称，不要猜测' })
        }
        const counts = await deps.points.countPointsByBangumi(subjects.map((s) => s.id))
        const countById = new Map(counts.map((c) => [c.bangumiId, c.pointCount]))
        return JSON.stringify({
          candidates: subjects.map((s) => {
            const pointCount = countById.get(s.id) ?? 0
            return { ...s, pointCount, hasPoints: pointCount > 0 }
          }),
        })
      }
      case 'list_points': {
        const bangumiId = Number(args.bangumiId)
        if (!Number.isFinite(bangumiId)) return JSON.stringify({ error: 'bangumiId 必须是数字' })
        const limit = Number.isFinite(Number(args.limit)) ? Math.min(Number(args.limit), 120) : 60
        const points = await deps.points.listPoints(bangumiId, limit)
        return JSON.stringify({ points })
      }
      case 'cluster_points': {
        const pointIds = [...new Set((Array.isArray(args.pointIds) ? args.pointIds : []).map(String))]
        const dayCount = Number(args.dayCount)
        if (!pointIds.length || !Number.isFinite(dayCount)) {
          return JSON.stringify({ error: 'pointIds 与 dayCount 必填' })
        }
        // 把 plan 关联的 bangumiIds 传下去，供服务端容错层给裸 id 拼前缀兜底
        const plan = await deps.repo.getPlan(deps.planId)
        const coords = await deps.points.getPointsByIds(pointIds, plan?.bangumiIds ?? [])
        // 命中判定容忍容错层返回的完整 scoped id（请求裸 id "p1"、命中 "115908:p1"）
        const resolved = new Set<string>()
        for (const p of coords) {
          resolved.add(p.id)
          const sep = p.id.indexOf(':')
          if (sep >= 0) resolved.add(p.id.slice(sep + 1))
        }
        const missing = pointIds.filter((id) => !resolved.has(id))
        if (missing.length) {
          // 显式报错而不是把缺员结果喂给聚类（空/残缺输入只会得到诡异的空规划）
          return JSON.stringify({
            error: '以下点位 id 未找到，需要是 list_points 返回的完整 "<bangumiId>:<rawId>" 形式',
            missing,
          })
        }
        const clusters = clusterIntoDays(coords, Math.max(1, Math.floor(dayCount)))
        return JSON.stringify({ clusters })
      }
      case 'estimate_travel':
        return runEstimateTravelTool(deps, args)
      case 'estimate_transit':
        return runEstimateTransitTool(deps, args)
      case 'resolve_place': {
        const query = String(args.query ?? '').trim()
        if (!query) return JSON.stringify({ error: 'query 不能为空' })
        if (!deps.places) {
          return JSON.stringify({ error: '地点解析服务未配置（缺少 Google Places API key），请如实告知用户暂时无法解析外部地点，不要编造' })
        }
        // N4+A5：模型工具与 enricher 共享 places 预算；模型上限 max-2（预留
        // 补齐脚本），60s 滚动窗口在检查内滚动
        const budget = deps.enrichBudget ?? createEnrichBudget()
        if (placesToolBudgetExhausted(budget)) {
          return JSON.stringify(BUDGET_EXHAUSTED_RESULT)
        }
        const nearLat = Number(args.nearLat)
        const nearLng = Number(args.nearLng)
        const near =
          Number.isFinite(nearLat) && Number.isFinite(nearLng) && Math.abs(nearLat) <= 90 && Math.abs(nearLng) <= 180
            ? { lat: nearLat, lng: nearLng }
            : undefined
        const resolution = await deps.places.resolveByText(query, {
          ...(near ? { near } : {}),
          onGoogleCall: () => {
            budget.places.used += 1
          },
        })
        if (!resolution.ok) {
          return JSON.stringify({ error: resolution.message, code: resolution.code, ...(resolution.code === 'not_found' ? { hint: '可尝试更官方/更具体的名称重试一次；仍查不到就如实告知用户' } : {}) })
        }
        const plan = await deps.repo.getPlan(deps.planId)
        const existing = collectPlanPlaces(plan)
        const alreadyInPlan = existing.has(resolution.place.placeId)
        return JSON.stringify({
          ok: true,
          fromCache: resolution.fromCache,
          place: resolution.place,
          media: resolution.place.photo
            ? {
                source: 'google_places',
                displayUrl: resolution.place.photo.displayUrl,
                attribution: resolution.place.photo.attribution,
                photoReference: resolution.place.photo.photoReference,
              }
            : null,
          // ask_user 选项可原样照抄的三件套出处（证据契约）
          optionProvenance: {
            sourceKind: 'google_places',
            sourceUrl: resolution.place.mapsUri,
            fetchedAt: resolution.place.fetchedAt,
          },
          ...(alreadyInPlan ? { alreadyInPlan: true, note: '该地点已在当前计划中，直接复用即可，不必重复解析' } : {}),
        })
      }
      case 'find_restaurants': {
        if (!deps.findRestaurants) {
          return JSON.stringify({ error: '餐厅搜索服务未配置（缺少 Google Places API key），请如实告知用户暂时无法推荐具体餐厅，不要编造店名' })
        }
        const lat = Number(args.lat)
        const lng = Number(args.lng)
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          return JSON.stringify({ error: 'lat/lng 必填且为合法坐标' })
        }
        // N4+A5：模型工具与 enricher 共享 places 预算；模型上限 max-2（预留
        // 补齐脚本），60s 滚动窗口在检查内滚动
        const budget = deps.enrichBudget ?? createEnrichBudget()
        if (placesToolBudgetExhausted(budget)) {
          return JSON.stringify(BUDGET_EXHAUSTED_RESULT)
        }
        const result = await deps.findRestaurants({
          lat,
          lng,
          ...(Number.isFinite(Number(args.radiusM)) ? { radiusM: Number(args.radiusM) } : {}),
          ...(typeof args.keyword === 'string' && args.keyword.trim() ? { keyword: args.keyword.trim() } : {}),
          onGoogleCall: () => {
            budget.places.used += 1
          },
        })
        if (!result.ok) return JSON.stringify({ error: result.message, code: result.code })
        if (!result.restaurants.length) {
          return JSON.stringify({
            error: '附近没有找到符合条件（评分 4.0+、评价数 30+）的餐厅；可换关键词或扩大半径重试一次，仍没有就如实告知用户',
            code: 'not_found',
          })
        }
        return JSON.stringify({
          ok: true,
          restaurants: result.restaurants.map((restaurant) => ({
            ...restaurant,
            optionProvenance: { sourceKind: 'google_places', sourceUrl: restaurant.mapsUri, fetchedAt: restaurant.fetchedAt },
          })),
          hint: '选评分最高且顺路的一家：返回对象原样写进 meal 条目 payload.place（含 provider/placeId）；media 可不填，服务端会按 place.photo 自动补齐；note 里列出另外 1–2 家备选（名称+评分）',
        })
      }
      case 'read_plan': {
        const plan = await deps.repo.getPlan(deps.planId)
        if (!plan) return JSON.stringify({ error: '计划不存在' })
        return JSON.stringify({ plan: toPlanView(plan) })
      }
      case 'update_plan_meta': {
        const patch: Parameters<TripPlanRepo['updateMeta']>[1] = {}
        if (typeof args.title === 'string' && args.title.trim()) patch.title = args.title.trim().slice(0, 80)
        if (Number.isFinite(Number(args.dayCount))) patch.dayCount = Math.min(30, Math.max(1, Math.floor(Number(args.dayCount))))
        if (typeof args.startDate === 'string') {
          if (!args.startDate.trim()) {
            patch.startDate = null
          } else {
            const parsed = new Date(args.startDate)
            if (Number.isNaN(parsed.getTime())) return JSON.stringify({ error: 'startDate 不是合法日期' })
            patch.startDate = parsed
          }
        }
        if (Array.isArray(args.bangumiIds)) patch.bangumiIds = args.bangumiIds.map(Number).filter(Number.isFinite)
        await deps.repo.updateMeta(deps.planId, patch)
        deps.onPlanUpdated?.()
        return JSON.stringify({ ok: true })
      }
      case 'save_plan_days': {
        const rawDays = Array.isArray(args.days) ? args.days : null
        if (!rawDays) return JSON.stringify({ error: 'days 必须是数组' })
        const days: ParsedSaveDays = parseSavePlanDaysInput(rawDays)
        if (days.length > 30) return JSON.stringify({ error: '天数过多（上限 30）' })
        const totalItems = days.reduce((sum, day) => sum + day.items.length, 0)
        if (totalItems > SAVE_PLAN_DAYS_MAX_TOTAL_ITEMS) {
          return JSON.stringify({
            error: `本次行程条目过多（合计 ${totalItems} 条，上限 ${SAVE_PLAN_DAYS_MAX_TOTAL_ITEMS}），请精简安排或分作品/分阶段规划`,
            totalItems,
            limit: SAVE_PLAN_DAYS_MAX_TOTAL_ITEMS,
          })
        }

        const plan = await deps.repo.getPlan(deps.planId)
        // M4：一次性批量取全部 pointId 坐标（含 image），enrichers、门控与
        // 可路由校验共用这一份（原先按天查质心 + 校验各查一次）
        const allPointIds = [...new Set(days.flatMap((day) => day.items.filter((i) => i.pointId).map((i) => i.pointId as string)))]
        const pointCoords = allPointIds.length ? await deps.points.getPointsByIds(allPointIds, plan?.bangumiIds ?? []) : []
        const coordsByPointId = new Map(pointCoords.map((p) => [p.id, { lat: p.lat, lng: p.lng, ...(p.image !== undefined ? { image: p.image } : {}) }]))
        // 质心只服务兜底解析偏置：没有候选的天不为它聚合坐标
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
        // M4 补齐层（R4 抽出 enrichPipeline 与补齐续跑共用）：排序 → enrichers
        // （共享预算、幂等、失败静默）→ 确定性时间归一化。预算挂在 deps 上由
        // loop 每个 run 创建一次，同一 run 内多次 save 共享
        const travelMode = readTravelMode(plan?.preferences)
        const enrichBudget = deps.enrichBudget ?? createEnrichBudget()
        const enrichContext: EnrichContext = {
          deps: { places: deps.places, externalPlaces: deps.externalPlaces, fetchPlacePhotos: deps.fetchPlacePhotos, findRestaurants: deps.findRestaurants, travel: deps.travel },
          coordsByPointId,
          dayCoordinates: (dayIndex) => coordsByDay.get(dayIndex) ?? [],
          ...(travelMode ? { travelMode } : {}),
          budget: enrichBudget,
        }
        const { enrich, schedule } = await enrichAndNormalizeDays(days, enrichContext)
        // 外部地点出处账本：已持久化在计划里的 placeId（此前经 resolve_place 验证过）
        const persistedPlaces = collectPlanPlaces(plan)
        /**
         * place 出处验证：placeId 必须可证明（resolver 缓存或计划内已持久化），
         * 且 provider/name/lat/lng 与出处逐字段一致——只证明 id 存在不够，
         * 防止偷换坐标/名称的篡改。
         */
        const placeProvenanceError = async (itemTitle: string, place: unknown): Promise<string | null> => {
          const record = (place && typeof place === 'object' ? place : {}) as Record<string, unknown>
          const placeId = String(record.placeId ?? '')
          const canonical = (await deps.places?.lookup(placeId)) ?? persistedPlaces.get(placeId) ?? null
          if (!canonical) {
            return deps.places
              ? `条目「${itemTitle}」的 payload.place 不是本计划解析出的地点（placeId 未命中 resolve_place 结果）。先用 resolve_place 解析并把返回的 place 原样照抄，不要手写或编造 place 数据`
              : `条目「${itemTitle}」携带了外部地点，但地点解析服务未配置——无法证明该地点真实存在。请移除该外部地点或让用户稍后再试`
          }
          const mismatch = verifyPlaceAgainstCanonical(record, canonical)
          return mismatch ? `条目「${itemTitle}」的 payload.place 被改动——${mismatch}` : null
        }

        const pointIdSet = new Set<string>()
        for (const day of days) {
          if (day.items.length > 30) return JSON.stringify({ error: `Day ${day.dayIndex} 条目过多（上限 30）` })
          for (const item of day.items) {
            const payload = item.payload ?? {}
            const place = 'place' in payload ? payload.place : undefined
            if (item.type === 'point') {
              if (item.pointId && place !== undefined && place !== null) {
                // 同一条目同时挂站内点位与外部地点是冲突数据，拒绝而不是猜语义
                return JSON.stringify({
                  error: `条目「${item.title}」同时带有 pointId 和 payload.place——站内点位只填 pointId，外部地点只填 payload.place（来自 resolve_place），二选一`,
                })
              }
              if (!item.pointId) {
                // 外部地点：pointId 为空是合法的，但必须有带坐标、且可证明的 payload.place
                const placeError = validateExternalPlacePayload(place)
                if (placeError) {
                  return JSON.stringify({
                    error: `条目「${item.title}」：${placeError}。外部地点必须先用 resolve_place 解析，把返回的 place 原样放进 payload.place（站内点位则必须带 pointId）`,
                  })
                }
                const provenanceError = await placeProvenanceError(item.title, place)
                if (provenanceError) return JSON.stringify({ error: provenanceError })
              } else {
                pointIdSet.add(item.pointId)
              }
            }
            if (item.type === 'transit' && item.pointId) {
              pointIdSet.add(item.pointId)
            }
            // attraction 等非巡礼类型挂了 payload.place 同样参与校验：形状、出处
            // 与逐字段一致性都要过，绝不静默丢点/静默不路由
            if (item.type !== 'point' && item.type !== 'transit' && place !== undefined && place !== null) {
              const placeError = validateExternalPlacePayload(place)
              if (placeError) return JSON.stringify({ error: `条目「${item.title}」：payload.place 不合法——${placeError}` })
              const provenanceError = await placeProvenanceError(item.title, place)
              if (provenanceError) return JSON.stringify({ error: provenanceError })
            }
          }
        }

        // 可路由的站内点位必须真实存在且有坐标（复用前面批量查询的结果）
        const missingPoints = await assertPointsResolvable([...pointIdSet], deps, plan?.bangumiIds ?? [], pointCoords)
        if (missingPoints) {
          return JSON.stringify({
            error: '以下点位 id 未找到（需要是 list_points 返回的完整 "<bangumiId>:<rawId>" 形式，且必须有坐标）',
            missing: missingPoints,
          })
        }

        // M4：门控。schedule 已在 enrichPipeline 内完成（自愈在 normalizer 内）；
        // 归一化失败不直接报错返回，而是作为时间门 hard 失败进入整改单
        const gateDays = schedule.ok
          ? schedule.normalizedDays.map((day) => ({
              dayIndex: day.dayIndex,
              items: day.items.map((item) => ({
                type: item.type,
                title: item.title,
                pointId: item.pointId,
                payload: (item.payload ?? null) as Record<string, unknown> | null,
              })),
            }))
          : days
        const quality = evaluatePlanGates(gateDays, coordsByPointId, schedule.ok)
        if (!schedule.ok) {
          const scheduleFailure = quality.hard.find((f) => f.gate === 'schedule' && f.dayIndex === 0)
          if (scheduleFailure) scheduleFailure.fix = `${scheduleFailure.fix}：${scheduleFailureSummary(schedule)}`
        }
        deps.onSaveEvaluated?.({ enrich, quality })
        if (!quality.passed) {
          return JSON.stringify({
            error: '质量门控未通过，未落库',
            gates: quality.hard,
            softWarnings: quality.soft,
            enrich,
          })
        }
        const normalizedDays: TripPlanDayInput[] = schedule.ok ? schedule.normalizedDays : []

        normalizedDays.sort((a, b) => a.dayIndex - b.dayIndex)
        normalizedDays.forEach((day, i) => {
          day.dayIndex = i + 1
        })
        // 交付物时间线：每次成功保存都在同一原子窗口内"替换全部天数 + 追加
        // 一条 kind=daymap 的不可变快照消息"（fencing 下被接管则两写都不发
        // 生，绝不留下半截成功）；快照基于替换后的结构化结果构建（含点位、
        // 外部地点 payload、schedule、transport、media 与 provider 折线），
        // 后续保存追加新 revision，绝不改写本条。revisionId 生成于事务之外、
        // 消费于事务之内，天然保证同一工具调用幂等。M4：快照携带质量报告。
        const revisionId = crypto.randomUUID()
        const savedAt = new Date().toISOString()
        const buildDaymap = (plan: TripPlanWithDays): DaymapMessagePayload => ({
          type: 'daymap',
          revisionId,
          savedAt,
          days: toPlanView(plan).days,
          quality,
        })
        const saved = await deps.repo.replaceDaysWithDaymap(deps.planId, normalizedDays, (plan) =>
          buildDaymap(plan) as unknown as Prisma.JsonValue,
        )
        deps.onPlanUpdated?.()
        deps.onDaymapSaved?.(buildDaymap(saved.plan))
        return JSON.stringify({
          ok: true,
          savedDays: normalizedDays.length,
          revisionId,
          autoResolvedPlaces: enrich.applied.place,
          skippedPlaces: enrich.skipped
            .filter((s) => s.enricher === 'place')
            .map(({ itemTitle, reason }) => ({ title: itemTitle, reason })),
          enrich,
          quality,
        })
      }
      case 'ask_user': {
        // taskType 是必填的任务语义（问日期/选作品/征求意见），不允许静默
        // 猜测——历史载荷的兼容归一化只发生在读取渲染层，不在这里
        const taskType = args.taskType
        if (!isAskUserTaskType(taskType)) {
          return JSON.stringify({
            error: 'taskType 必须显式指定：date_range（问出行日期）/ work_selection（让用户选作品）/ opinion（征求出行方式、节奏、预算等意见）',
          })
        }
        const kind = args.kind
        if (typeof kind !== 'string' || !ASK_USER_KINDS.includes(kind as AskUserKind)) {
          return JSON.stringify({ error: 'kind 必须是 date_range / single_choice / multi_choice 之一' })
        }
        if (taskType === 'date_range' && kind !== 'date_range') {
          return JSON.stringify({ error: 'taskType=date_range（问日期）只能配 kind=date_range，且不带 options' })
        }
        if (taskType !== 'date_range' && kind === 'date_range') {
          return JSON.stringify({ error: `taskType=${taskType} 必须配 kind=single_choice 或 multi_choice（kind=date_range 只属于日期提问）` })
        }
        const prompt = String(args.prompt ?? '').trim().slice(0, 500)
        if (!prompt) return JSON.stringify({ error: 'prompt 不能为空' })
        let options: AskUserOption[] | undefined
        if (kind === 'date_range') {
          if (Array.isArray(args.options) && args.options.length) {
            return JSON.stringify({ error: 'taskType=date_range 不带 options——日期由日期选择组件收集，不需要候选项' })
          }
        } else {
          // 前面的一致性校验已排除 taskType=date_range 走选择分支
          const choiceTaskType: AskChoiceTaskType = taskType === 'opinion' ? 'opinion' : 'work_selection'
          const built = await buildValidatedAskOptions(
            Array.isArray(args.options) ? args.options : [],
            // opinion 不解析封面：resolveOptionCover 只注入给作品选择
            { resolveOptionCover: choiceTaskType === 'work_selection' ? deps.resolveOptionCover : undefined },
            choiceTaskType,
          )
          if (isAskOptionGateError(built)) return JSON.stringify(built)
          options = built
        }
        throw new AskUserSignal({
          askId: crypto.randomUUID(),
          kind: kind as AskUserKind,
          taskType,
          prompt,
          ...(options ? { options } : {}),
          ...(args.allowSkip === true ? { allowSkip: true } : {}),
        })
      }
      default:
        return JSON.stringify({ error: `未知工具: ${name}` })
    }
  } catch (err) {
    // 这两类异常是控制流信号，不是工具错误：栅栏中断交给循环静默收尾，
    // ask_user 信号交给循环走专门的 ask 收尾分支（发事件 + 落库 + 结束本轮）
    if (err instanceof RunFencedError || err instanceof AskUserSignal) throw err
    const message = err instanceof Error ? err.message : String(err)
    return JSON.stringify({ error: message })
  }
}
