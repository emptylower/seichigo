// @ts-expect-error 由 cf:build 生成（.open-next/worker.js），本地不存在
import handler from '../.open-next/worker.js'
// @ts-expect-error 同上
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from '../.open-next/worker.js'
import { consumePlanAgentBatch, type PlanAgentExportedHandler, type PlanAgentWorkerEnv } from './planAgentConsumer'
import { stripNextRouterVaryFromResponse } from './preloadVaryStrip'

/**
 * 2026-09-06 §0.1：自定义 Worker 入口——wrangler main 指向本文件，OpenNext
 * 生成的 handler 变成这里的一个导出，同时挂上规划 run 的队列消费者。
 * 三个 Durable Object 类必须原样再导出（OpenNext 的队列/标签缓存依赖）。
 *
 * 2026-09-10 任务 2：preload 响应在出口剥掉 Next 追加的 rsc/router vary，
 * 让边缘/中间层缓存不再被名义变体拆散（详见 preloadVaryStrip.ts）。
 *
 * 2026-09-11 P1-A：再导出 per-run 派发器 DO（PLAN_RUN_DISPATCHER binding，
 * 默认关，白名单 canary；见 planRunDispatcher.ts）。
 */
export { PlanRunDispatcher } from './planRunDispatcher'
export default {
  fetch: (request: globalThis.Request, env: PlanAgentWorkerEnv, ctx: unknown) =>
    handler
      .fetch(request, env, ctx)
      .then((response: globalThis.Response) => stripNextRouterVaryFromResponse(request.url, response)),
  queue: consumePlanAgentBatch,
} satisfies PlanAgentExportedHandler<PlanAgentWorkerEnv>
