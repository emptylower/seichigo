import { runPlaceEnricher } from './placeEnricher'
import { runRestaurantEnricher } from './restaurantEnricher'
import { runTransportEnricher } from './transportEnricher'
import { runMediaEnricher } from './mediaEnricher'
import { runImageDedupeEnricher } from './imageDedupeEnricher'
import { runNeighborImageEnricher } from './neighborImageEnricher'
import { runMealEnricher } from './mealEnricher'
import {
  ENRICH_BUDGET_WINDOW_MS,
  ENRICH_DIRECTIONS_MAX_DEFAULT,
  ENRICH_PLACES_MAX_DEFAULT,
  countGoogleCall,
  createEnrichBudget,
  emptyEnrichReport,
  meterGoogleCall,
  modelDirectionsCap,
  modelPlacesCap,
  placesRemaining,
  readTravelMode,
  rollEnrichBudgetWindow,
  type EnrichBudget,
  type EnrichContext,
  type EnrichDay,
  type EnrichReport,
  type EnrichTravelMode,
  type EnricherName,
} from './types'

export type { EnrichBudget, EnrichContext, EnrichDay, EnrichReport, EnrichTravelMode, EnricherName }
export {
  createEnrichBudget,
  readTravelMode,
  rollEnrichBudgetWindow,
  modelDirectionsCap,
  modelPlacesCap,
  placesRemaining,
  countGoogleCall,
  meterGoogleCall,
  ENRICH_BUDGET_WINDOW_MS,
  ENRICH_DIRECTIONS_MAX_DEFAULT,
  ENRICH_PLACES_MAX_DEFAULT,
}

/**
 * 补齐层汇总入口：按 meal → place → restaurant → transport → media →
 * dedupe → neighbor 顺序执行（schedule 由 save 流程原位置调用并把结果喂给
 * gates）。原地改写 days，任何 enricher 抛错只记 skipped，绝不让保存失败。
 * 全部幂等——连跑两次，第二次 applied 恒为 0。预算按 provider 分桶
 * （directions/places），由 ctx.budget 传入（同一 run 内多次 save 共享一份），
 * 缺省时才新建；每次保存开始先滚动时间窗（距窗口开始 ≥60s 时 used 归零，A5）。
 */
export async function runEnrichers(
  days: EnrichDay[],
  ctx: EnrichContext,
): Promise<{ days: EnrichDay[]; report: EnrichReport }> {
  const budget: EnrichBudget = ctx.budget ?? createEnrichBudget()
  rollEnrichBudgetWindow(budget)
  const report = emptyEnrichReport()
  const fullCtx: EnrichContext = { ...ctx, budget }
  const runners: Array<{ name: EnricherName; run: () => Promise<void> | void }> = [
    { name: 'meal', run: () => runMealEnricher(days, fullCtx, report) },
    { name: 'place', run: () => runPlaceEnricher(days, fullCtx, report) },
    { name: 'restaurant', run: () => runRestaurantEnricher(days, fullCtx, report) },
    { name: 'transport', run: () => runTransportEnricher(days, fullCtx, report) },
    { name: 'media', run: () => runMediaEnricher(days, fullCtx, report) },
    { name: 'dedupe', run: () => runImageDedupeEnricher(days, fullCtx, report) },
    { name: 'neighbor', run: () => runNeighborImageEnricher(days, fullCtx, report) },
  ]
  for (const { name, run } of runners) {
    try {
      await run()
    } catch (err) {
      // 单个 enricher 崩溃只记一条 skipped（不指向具体条目），其余照常执行
      console.warn(`[planAgent] enricher ${name} failed`, err)
      report.skipped.push({ enricher: name, itemTitle: '', reason: '补齐脚本异常（已跳过）' })
    }
  }
  report.googleCallsUsed = { directions: budget.directions.used, places: budget.places.used }
  return { days, report }
}
