import { orderDaysBySchedule, runScheduleEnricher, type ScheduleEnrichResult } from './enrich/scheduleEnricher'
import { runEnrichers } from './enrich'
import type { EnrichContext, EnrichDay, EnrichReport } from './enrich/types'
import { dispatchPointImagePrewarm } from './pointImagePrewarm'

/**
 * save_plan_days 与补齐续跑（enrichContinuation）共用的补齐管道：
 * 排序（enrichers 必须在归一化时间序上运行，见 orderDaysBySchedule 注释，
 * 归一化失败的天保持原序）→ runEnrichers（共享预算、幂等、失败静默）→
 * 确定性时间归一化（ok/errors 喂给时间门；ok 时输出可直接落库的天结构）。
 * 原地改写 days。
 *
 * 第六轮 C：补齐完成后派发"保存即预热"（点位图 h160/w640q80 变体后台进
 * R2）；无 bucket（本地）直接跳过，任何失败只 warn，不影响主流程。
 */
export async function enrichAndNormalizeDays(
  days: EnrichDay[],
  ctx: EnrichContext,
): Promise<{ enrich: EnrichReport; schedule: ScheduleEnrichResult }> {
  orderDaysBySchedule(days)
  const { report: enrich } = await runEnrichers(days, ctx)
  const schedule = runScheduleEnricher(days)
  // 第六轮 E3d：从条目的 pointId 与 coordsByPointId.get(pointId).image 组装预热
  // 入参，状态行 sourceId 与 cron 侧同键（point-image + 点位 id）。
  dispatchPointImagePrewarm(
    [...ctx.coordsByPointId.entries()].flatMap(([pointId, coord]) =>
      typeof coord.image === 'string' && coord.image.trim() !== ''
        ? [{ pointId, imageUrl: coord.image }]
        : [],
    ),
  )
  return { enrich, schedule }
}
