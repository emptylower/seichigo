import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { TripPlanMessageKind, TripPlanStartupRead } from './repo'

/**
 * P2-B（2026-09-11）：getStartupRead 的 Prisma 实现（独立文件只为守住
 * repoPrisma.ts 的 750 行预算——SQL 与行映射约 60 行整体搬出）。
 *
 * 前奏一次性读取——**单条原生 SQL / 1 次往返**（TripPlan 主行 + EXISTS
 * 子查询算 hasPointItem + json_agg 聚合全量消息），替代前奏原先
 * isAgentRunStopped + listMessages + getStageInputs 的 3 次串行往返
 * （pool=1 下每次 ~0.164s）。绝不能用 Prisma 嵌套 include/select 关系：
 * relation load strategy 会拆成多条查询（getPlan(PLAN_INCLUDE) 就是 5 条）。
 * hasPointItem 谓词与 getStageInputs 完全一致（pointId IS NOT NULL AND
 * <> ''）；消息排序与 listMessages 一致（createdAt asc，同毫秒按 id 稳定）。
 * json 聚合里 createdAt 回来是字符串 → new Date(...)；bangumiIds
 * （Int[]）$queryRaw 回来就是 number[]。开发库实测（sqlCount=1）见
 * scratch/verify-startup-read.mjs。
 *
 * ⚠️ createdAt 必须 to_char 成带 `Z` 的字符串：该列是 timestamp(3)（无时区，
 * 存的就是 UTC 瞬时），json_build_object 直接放列值会输出
 * `2026-09-10T06:45:40.014` 这种不带偏移的串，`new Date()` 按**运行时本地
 * 时区**解析——dev 机器（UTC+8）上实测比 listMessages 差 8 小时（生产
 * workerd 恰好是 UTC 才没暴露）。带 Z 之后与 listMessages 逐条同瞬时，
 * 见 scratch/verify-startup-read.mjs 的 createdAtEqual。
 */

/** 原生 SQL 的行形状（json_agg 的 createdAt 由 to_char 输出带 Z 的 ISO 串） */
type StartupReadRow = {
  agentRunToken: string | null
  bangumiIds: number[]
  startDate: Date | null
  dayCount: number
  hasPointItem: boolean
  messages: Array<{ id: string; planId: string; kind: string; content: unknown; createdAt: string }>
}

export function fetchStartupRead(planId: string): Promise<TripPlanStartupRead | null> {
  return prisma
    .$queryRaw<StartupReadRow[]>`
      SELECT
        "TripPlan"."agentRunToken",
        "TripPlan"."bangumiIds",
        "TripPlan"."startDate",
        "TripPlan"."dayCount",
        EXISTS (
          SELECT 1 FROM "TripPlanDay" d
          JOIN "TripPlanItem" i ON i."dayId" = d."id"
          WHERE d."planId" = "TripPlan"."id" AND i."pointId" IS NOT NULL AND i."pointId" <> ''
        ) AS "hasPointItem",
        COALESCE (
          (
            SELECT json_agg (
              json_build_object('id', m."id", 'planId', m."planId", 'kind', m."kind", 'content', m."content", 'createdAt', to_char(m."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
              ORDER BY m."createdAt", m."id"
            )
            FROM "TripPlanMessage" m WHERE m."planId" = "TripPlan"."id"
          ),
          '[]'::json
        ) AS "messages"
      FROM "TripPlan"
      WHERE "TripPlan"."id" = ${planId}
    `
    .then((rows) => {
      const row = rows[0]
      if (!row) return null
      return {
        agentRunToken: row.agentRunToken,
        stageInputs: {
          bangumiIds: row.bangumiIds,
          startDate: row.startDate,
          dayCount: row.dayCount,
          hasPointItem: row.hasPointItem,
        },
        messages: row.messages.map((m) => ({
          id: m.id,
          planId: m.planId,
          kind: m.kind as TripPlanMessageKind,
          content: m.content as Prisma.JsonValue,
          createdAt: new Date(m.createdAt),
        })),
      }
    })
}
