import type OpenAI from 'openai'
import type { Prisma } from '@prisma/client'
import { clusterIntoDays, haversineKm } from './cluster'
import type { BgmSubject, PointFinder } from './points'
import { TRIP_PLAN_ITEM_TYPES, type TripPlanDayInput, type TripPlanItemType, type TripPlanRepo } from '@/lib/tripPlan/repo'
import { toPlanView } from '@/lib/tripPlan/view'
import { RunFencedError } from './runFence'
import { AskUserSignal, ASK_USER_KINDS, type AskUserKind, type AskUserOption } from './askUser'

export type PlanAgentToolDeps = {
  planId: string
  repo: TripPlanRepo
  points: PointFinder
  bgmSearch?: (keyword: string) => Promise<BgmSubject[]>
  onPlanUpdated?: () => void
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
    pointId: { type: 'string', description: `type=point 时必填。${POINT_ID_SCHEMA_HINT}` },
    title: { type: 'string', description: '条目标题（点位中文名/交通段/活动名）' },
    timeHint: { type: 'string', description: '时间提示，如“上午”“14:00”' },
    note: { type: 'string', description: '补充说明' },
    reason: { type: 'string', description: '为什么这么安排（面向用户展示）' },
    payload: {
      type: 'object',
      description: 'type=transit 时可选：照抄 estimate_transit 返回的结构化交通数据，前端会渲染成图标+时长+距离',
      properties: {
        mode: { type: 'string', description: '交通方式：walk / transit（照抄 estimate_transit 的 mode）' },
        durationMin: { type: 'number', description: '耗时（分钟，照抄 estimate_transit 的 durationMin）' },
        distanceKm: { type: 'number', description: '距离（公里，照抄 estimate_transit 的 distanceKm）' },
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

export const PLAN_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  tool('search_anime', '按作品名（中文或日文，支持部分匹配）在站内点位库搜索圣地巡礼作品，返回 bangumiId。规划前必须先用它确定作品。', {
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
  tool('estimate_transit', '估算两个点位之间的交通方式与耗时（本地启发式：≤1.5km 步行，其余公共交通）。写 transit 条目前必须用它，不要自己猜数字。', {
    type: 'object',
    properties: {
      fromPointId: { type: 'string', description: POINT_ID_SCHEMA_HINT },
      toPointId: { type: 'string', description: POINT_ID_SCHEMA_HINT },
    },
    required: ['fromPointId', 'toPointId'],
  }),
  tool('read_plan', '读取当前计划的完整结构（标题、天数、每日条目）。', { type: 'object', properties: {} }),
  tool('update_plan_meta', '更新计划元信息：标题、总天数、出发日期（ISO 日期字符串）、关联作品 id。', {
    type: 'object',
    properties: {
      title: { type: 'string' },
      dayCount: { type: 'number' },
      startDate: { type: 'string', description: 'ISO 日期，如 2026-09-15；传空字符串清除' },
      bangumiIds: { type: 'array', items: { type: 'number' } },
    },
  }),
  tool('save_plan_days', '整份行程的完整替换保存：每次调用都会覆盖旧的全部天数，必须一次性传入完整的多天内容，绝不能分批多次调用（分批会互相覆盖导致已保存的行程丢失）。每天是一个按访问顺序排列的条目时间线：point 条目挂 pointId，点位之间插入 transit 条目说明交通方式。每个安排都写 reason。这是计划的唯一落库方式，规划结果必须通过它保存。全部天数条目总和上限 150 条，超出会被直接拒绝。', {
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
  }),
  tool('ask_user', '当需要用户做选择或提供关键信息（比如出行日期、在多个候选作品/方案里选一个）时调用，前端会渲染成结构化的交互组件而不是纯文字提问。调用后本轮对话结束，等待用户通过组件提交答案。', {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['date_range', 'single_choice', 'multi_choice'], description: '组件类型' },
      prompt: { type: 'string', description: '给用户看的提问文案' },
      options: {
        type: 'array',
        description: 'kind=single_choice/multi_choice 时必填，候选项列表',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            sublabel: { type: 'string', description: '可选副标题，如"47 个点位"' },
            image: { type: 'string', description: '可选封面图 URL' },
          },
          required: ['id', 'label'],
        },
      },
      allowSkip: { type: 'boolean', description: '是否允许用户跳过这个问题，默认 false' },
    },
    required: ['kind', 'prompt'],
  }),
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
      case 'estimate_transit': {
        const fromId = String(args.fromPointId ?? '')
        const toId = String(args.toPointId ?? '')
        const plan = await deps.repo.getPlan(deps.planId)
        const coords = await deps.points.getPointsByIds([fromId, toId], plan?.bangumiIds ?? [])
        // 容忍容错层返回的完整 scoped id（请求裸 id、命中带前缀形式）
        const from = coords.find((p) => p.id === fromId || p.id.endsWith(`:${fromId}`))
        const to = coords.find((p) => p.id === toId || p.id.endsWith(`:${toId}`))
        if (!from || !to) return JSON.stringify({ error: '点位不存在或缺少坐标' })
        const km = haversineKm(from, to)
        const mode = km <= 1.5 ? 'walk' : 'transit'
        const durationMin =
          mode === 'walk' ? Math.max(3, Math.round((km / 4.5) * 60)) : Math.max(10, Math.round((km / 25) * 60) + 12)
        return JSON.stringify({ distanceKm: Math.round(km * 10) / 10, mode, durationMin })
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
        const days: TripPlanDayInput[] = rawDays.map((raw) => {
          const day = asRecord(raw)
          const items = Array.isArray(day.items) ? day.items : []
          return {
            dayIndex: Math.max(1, Math.floor(Number(day.dayIndex) || 1)),
            citySlug: typeof day.citySlug === 'string' ? day.citySlug : null,
            summary: typeof day.summary === 'string' ? day.summary : null,
            items: items.map((rawItem) => {
              const item = asRecord(rawItem)
              const type = TRIP_PLAN_ITEM_TYPES.includes(item.type as TripPlanItemType)
                ? (item.type as TripPlanItemType)
                : 'free'
              return {
                type,
                pointId: typeof item.pointId === 'string' ? item.pointId : null,
                title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '未命名条目',
                timeHint: typeof item.timeHint === 'string' ? item.timeHint : null,
                note: typeof item.note === 'string' ? item.note : null,
                reason: typeof item.reason === 'string' ? item.reason : null,
                payload:
                  typeof item.payload === 'object' && item.payload !== null && !Array.isArray(item.payload)
                    ? (item.payload as Prisma.JsonValue)
                    : null,
              }
            }),
          }
        })
        if (days.length > 30) return JSON.stringify({ error: '天数过多（上限 30）' })
        const totalItems = days.reduce((sum, day) => sum + day.items.length, 0)
        if (totalItems > SAVE_PLAN_DAYS_MAX_TOTAL_ITEMS) {
          return JSON.stringify({
            error: `本次行程条目过多（合计 ${totalItems} 条，上限 ${SAVE_PLAN_DAYS_MAX_TOTAL_ITEMS}），请精简安排或分作品/分阶段规划`,
            totalItems,
            limit: SAVE_PLAN_DAYS_MAX_TOTAL_ITEMS,
          })
        }
        for (const day of days) {
          if (day.items.length > 30) return JSON.stringify({ error: `Day ${day.dayIndex} 条目过多（上限 30）` })
          for (const item of day.items) {
            if (item.type === 'point' && !item.pointId) {
              return JSON.stringify({ error: 'point 条目必须带 pointId（来自 list_points）' })
            }
          }
        }
        days.sort((a, b) => a.dayIndex - b.dayIndex)
        days.forEach((day, i) => {
          day.dayIndex = i + 1
        })
        await deps.repo.replaceDays(deps.planId, days)
        deps.onPlanUpdated?.()
        return JSON.stringify({ ok: true, savedDays: days.length })
      }
      case 'ask_user': {
        const kind = args.kind
        if (typeof kind !== 'string' || !ASK_USER_KINDS.includes(kind as AskUserKind)) {
          return JSON.stringify({ error: 'kind 必须是 date_range / single_choice / multi_choice 之一' })
        }
        const prompt = String(args.prompt ?? '').trim().slice(0, 500)
        if (!prompt) return JSON.stringify({ error: 'prompt 不能为空' })
        let options: AskUserOption[] | undefined
        if (kind !== 'date_range') {
          const rawOptions = Array.isArray(args.options) ? args.options : []
          if (!rawOptions.length) return JSON.stringify({ error: 'single_choice/multi_choice 必须提供非空 options 列表' })
          if (rawOptions.length > 20) return JSON.stringify({ error: 'options 过多（上限 20）' })
          options = []
          for (const rawOption of rawOptions) {
            const option = asRecord(rawOption)
            const id = String(option.id ?? '').trim()
            const label = String(option.label ?? '').trim()
            if (!id || !label) return JSON.stringify({ error: '每个 option 必须带非空 id 与 label' })
            options.push({
              id,
              label,
              ...(typeof option.sublabel === 'string' && option.sublabel.trim() ? { sublabel: option.sublabel.trim().slice(0, 120) } : {}),
              ...(typeof option.image === 'string' && option.image.trim() ? { image: option.image.trim() } : {}),
            })
          }
        }
        throw new AskUserSignal({
          askId: crypto.randomUUID(),
          kind: kind as AskUserKind,
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
