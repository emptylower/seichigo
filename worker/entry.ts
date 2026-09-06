// @ts-expect-error 由 cf:build 生成（.open-next/worker.js），本地不存在
import handler from '../.open-next/worker.js'
// @ts-expect-error 同上
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from '../.open-next/worker.js'
import { consumePlanAgentBatch, type PlanAgentExportedHandler, type PlanAgentWorkerEnv } from './planAgentConsumer'

/**
 * 2026-09-06 §0.1：自定义 Worker 入口——wrangler main 指向本文件，OpenNext
 * 生成的 handler 变成这里的一个导出，同时挂上规划 run 的队列消费者。
 * 三个 Durable Object 类必须原样再导出（OpenNext 的队列/标签缓存依赖）。
 */
export default {
  fetch: handler.fetch,
  queue: consumePlanAgentBatch,
} satisfies PlanAgentExportedHandler<PlanAgentWorkerEnv>
