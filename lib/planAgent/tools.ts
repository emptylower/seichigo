import type OpenAI from 'openai'
import { clusterIntoDays, haversineKm } from './cluster'
import type { BgmSubject, PointFinder } from './points'
import { TRIP_PLAN_ITEM_TYPES, type TripPlanDayInput, type TripPlanItemType, type TripPlanRepo } from '@/lib/tripPlan/repo'
import { toPlanView } from '@/lib/tripPlan/view'

export type PlanAgentToolDeps = {
  planId: string
  repo: TripPlanRepo
  points: PointFinder
  bgmSearch?: (keyword: string) => Promise<BgmSubject[]>
  onPlanUpdated?: () => void
}

const itemSchema = {
  type: 'object' as const,
  properties: {
    type: { type: 'string', enum: TRIP_PLAN_ITEM_TYPES, description: '条目类型' },
    pointId: { type: 'string', description: 'type=point 时必填，来自 list_points 的点位 id' },
    title: { type: 'string', description: '条目标题（点位中文名/交通段/活动名）' },
    timeHint: { type: 'string', description: '时间提示，如“上午”“14:00”' },
    note: { type: 'string', description: '补充说明' },
    reason: { type: 'string', description: '为什么这么安排（面向用户展示）' },
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
      pointIds: { type: 'array', items: { type: 'string' }, description: '要安排的点位 id 列表' },
      dayCount: { type: 'number', description: '巡礼天数' },
    },
    required: ['pointIds', 'dayCount'],
  }),
  tool('estimate_transit', '估算两个点位之间的交通方式与耗时（本地启发式：≤1.5km 步行，其余公共交通）。写 transit 条目前必须用它，不要自己猜数字。', {
    type: 'object',
    properties: {
      fromPointId: { type: 'string' },
      toPointId: { type: 'string' },
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
  tool('save_plan_days', '整体保存每日行程（覆盖旧内容）。每天是一个按访问顺序排列的条目时间线：point 条目挂 pointId，点位之间插入 transit 条目说明交通方式。每个安排都写 reason。这是计划的唯一落库方式，规划结果必须通过它保存。', {
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
        const pointIds = Array.isArray(args.pointIds) ? args.pointIds.map(String) : []
        const dayCount = Number(args.dayCount)
        if (!pointIds.length || !Number.isFinite(dayCount)) {
          return JSON.stringify({ error: 'pointIds 与 dayCount 必填' })
        }
        const coords = await deps.points.getPointsByIds(pointIds)
        const clusters = clusterIntoDays(coords, Math.max(1, Math.floor(dayCount)))
        return JSON.stringify({ clusters })
      }
      case 'estimate_transit': {
        const fromId = String(args.fromPointId ?? '')
        const toId = String(args.toPointId ?? '')
        const coords = await deps.points.getPointsByIds([fromId, toId])
        const from = coords.find((p) => p.id === fromId)
        const to = coords.find((p) => p.id === toId)
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
              }
            }),
          }
        })
        if (days.length > 30) return JSON.stringify({ error: '天数过多（上限 30）' })
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
      default:
        return JSON.stringify({ error: `未知工具: ${name}` })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return JSON.stringify({ error: message })
  }
}
