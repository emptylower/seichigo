import type OpenAI from 'openai'
import { TRIP_PLAN_ITEM_TYPES } from '@/lib/tripPlan/repo'

/**
 * A1：save_plan_days 的 parameters 单独成文件（tools.ts 行数逼近上限）。
 * 同时满足 404gemini（Gemini 后端）的严格 schema 校验：任何 type:'array'
 * 都必须带 items——此前 legs/polyline 缺 items 导致 Gemini 直接 HTTP 400
 * 拒绝全部工具（DeepSeek/freecode 不校验所以未暴露）。
 */

export const POINT_ID_SCHEMA_HINT =
  '点位 id 是形如 "<bangumiId>:<rawId>" 的不透明字符串，必须原样使用 list_points 返回结果里的完整 id 字符串，不要截取、拆分或改写'

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
            // Gemini 要求 array 必须带 items；字段集合对齐 itemPayload.ts 的 TransportLeg（宽松类型）。
            // M2：不带 additionalProperties——Gemini Schema 没有该关键字（主会话已用
            // 真实端点确认删除后仍 200），守卫把它列入黑名单
            legs: {
              type: 'array',
              description: '交通分段（照抄 transportPayload.legs）',
              items: {
                type: 'object',
                properties: {
                  mode: { type: 'string', description: 'walk / transit / driving 等分段方式' },
                  durationMin: { type: 'number' },
                  distanceKm: { type: 'number' },
                  instruction: { type: 'string', description: '步行/驾驶段导航指令' },
                  line: { type: 'string', description: '公交线路/线路名' },
                  fromStop: { type: 'string', description: '上车站' },
                  toStop: { type: 'string', description: '下车站' },
                  numStops: { type: 'number', description: '经过站数' },
                  headsign: { type: 'string', description: '乘车方向' },
                  departureTime: { type: 'string', description: '发车时刻文本' },
                  arrivalTime: { type: 'string', description: '到达时刻文本' },
                },
              },
            },
            polyline: {
              type: 'array',
              description: '路线折线坐标对 [lat, lng] 列表（照抄 transportPayload.polyline）',
              items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
            },
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

export const SAVE_PLAN_DAYS_PARAMETERS: Record<string, unknown> = {
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
}

/** Gemini Function Calling 不支持（或会 400 拒绝）的 OpenAI schema 关键字 */
const GEMINI_UNSUPPORTED_KEYWORDS = ['$schema', 'const', 'anyOf', 'additionalProperties', 'examples', '$ref'] as const

/**
 * 通用守卫：递归校验一组工具的 JSON schema 满足 Gemini 严格口径——
 * 每个 type:'array' 必须有 items，且不含不受支持的关键字。违例即抛错
 * （测试对 PLAN_AGENT_TOOLS 全量调用，新增工具漏写 items 在 CI 就会炸）。
 * M3：按位置检查——黑名单关键字只对 schema 位置生效；`properties` 的键是
 * 字段名（可以叫 const/$ref），其值才是 schema；`items`/`anyOf`/`oneOf`/
 * `allOf` 的值按 schema 递归。
 */
export function assertToolSchemasGeminiSafe(tools: OpenAI.Chat.Completions.ChatCompletionTool[]): void {
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`))
      return
    }
    if (typeof node !== 'object' || node === null) return
    const schema = node as Record<string, unknown>
    for (const keyword of GEMINI_UNSUPPORTED_KEYWORDS) {
      if (keyword in schema) throw new Error(`Gemini 工具 schema 不支持关键字 "${keyword}"：${path}`)
    }
    if (schema.type === 'array' && schema.items === undefined) {
      throw new Error(`Gemini 工具 schema 的 type:"array" 缺少 items：${path}`)
    }
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'properties' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // 键是字段名不检查（字段可以叫 const/$ref），值按 schema 递归
        for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
          walk(child, `${path}.properties.${name}`)
        }
        continue
      }
      // items / anyOf / oneOf / allOf 的值是 schema（数组走上方 Array 分支），
      // 其余键的值也按 schema 递归（保守：未知关键字内嵌 schema 同样受检）
      walk(value, `${path}.${key}`)
    }
  }
  for (const tool of tools) {
    if (tool.type !== 'function') continue
    walk(tool.function.parameters, `tools.${tool.function.name}.parameters`)
  }
}
