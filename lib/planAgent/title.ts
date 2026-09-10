import { DEFAULT_PLAN_TITLE } from '@/lib/tripPlan/repo'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'

export type TitleSideChannelDeps = {
  repo: TripPlanRepo
  planId: string
  /**
   * 生成标题的外部调用（DeepSeek 无工具小请求）。返回 null 表示这次没生成
   * 出可用标题，直接放弃写入。
   */
  createTitle: (userMessage: string) => Promise<string | null>
  /** 标题写入成功后回调（路由用它向客户端补发一次 plan_updated 事件） */
  onTitleUpdated?: () => void
}

/**
 * 标题侧信道：与 agent 主循环并行的一次独立轻量标题生成，让标题在第一轮
 * 消息后几秒内出现，而不是等主流程走到 prompt 第 5 步的 update_plan_meta。
 *
 * 写入前重新查一次 plan，仅当标题仍是默认值时才写——不覆盖 agent 主流程
 * 已经写好的更好标题。刻意不走 run-token 栅栏（直接 repo.updateMeta，而非
 * updateMetaIfActive）：标题是幂等的展示字段，不属于 agent run 的写序列，
 * 不参与并发互斥。任何失败都静默吞掉，兜底交给主流程。
 */
export async function maybeSetGeneratedTitle(deps: TitleSideChannelDeps, userMessage: string): Promise<void> {
  try {
    const title = await deps.createTitle(userMessage)
    if (!title) return
    // CUT-8：只取 title 的单字段投影，不再拉整棵 PLAN_INCLUDE（原先多条
    // 串行 SQL、20+ KB，在 pool=1 下与主 loop 抢唯一连接）。null 唯一对应
    // "计划不存在"，与原先的 !plan 同判定；空串由第二个条件挡掉。
    const title0 = await deps.repo.getPlanTitle(deps.planId)
    if (title0 === null || title0 !== DEFAULT_PLAN_TITLE) return
    await deps.repo.updateMeta(deps.planId, { title })
    deps.onTitleUpdated?.()
  } catch {
    // 静默失败：侧信道绝不能影响主 agent loop 的响应
  }
}
