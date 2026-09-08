import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache'
import d1NextTagCache from '@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache'
// 2026-09-07 首页 TTFB 修复：ISR 再生成从 MemoryQueue（同 isolate waitUntil，
// 拖慢并发请求）改为 Durable Object 队列，独立于请求 isolate 执行
import doQueue from '@opennextjs/cloudflare/overrides/queue/do-queue'

export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  tagCache: d1NextTagCache,
  queue: doQueue,
  // 2026-09-07 首页 TTFB 修复：开启缓存拦截——ISR 命中时在中间件之后直接返回
  // 增量缓存内容并下发 s-maxage，让 Cloudflare 边缘接住后续请求
  enableCacheInterception: true,
})
