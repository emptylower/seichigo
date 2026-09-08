import { defineCloudflareConfig, getCloudflareContext } from '@opennextjs/cloudflare'
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache'
import d1NextTagCache from '@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache'
// 2026-09-07 首页 TTFB 修复：ISR 再生成从 MemoryQueue（同 isolate waitUntil，
// 拖慢并发请求）改为 Durable Object 队列，独立于请求 isolate 执行
import doQueue from '@opennextjs/cloudflare/overrides/queue/do-queue'
import { IgnorableError } from '@opennextjs/aws/utils/error.js'
import type { Queue, QueueMessage } from '@opennextjs/aws/types/overrides'

// 2026-09-08 队列投递不阻塞响应：OpenNext 缓存拦截器在缓存过期瞬间会
// `await globalThis.queue.send(...)`，而 do-queue 的 send 是一次 DO 远程调用
// （冷启动/跨区域可达秒级），导致过期瞬间的访客多等数秒。这里把真正的投递
// 放进 `ctx.waitUntil` 后台执行，send 立即返回，旧缓存照常秒回。
const nonBlockingDoQueue: Queue = {
  name: 'durable-queue-nonblocking',
  send: async (msg: QueueMessage) => {
    const { ctx } = getCloudflareContext()
    ctx.waitUntil(
      doQueue.send(msg).catch((err: unknown) => {
        // IgnorableError（如未配置 DO binding）本就不该影响响应，静默吞掉
        if (err instanceof IgnorableError) return
        console.warn(
          `[nonblocking-queue] revalidation send failed for ${msg.MessageBody.url}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }),
    )
  },
}

export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  tagCache: d1NextTagCache,
  queue: nonBlockingDoQueue,
  // 2026-09-07 首页 TTFB 修复：开启缓存拦截——ISR 命中时在中间件之后直接返回
  // 增量缓存内容并下发 s-maxage，让 Cloudflare 边缘接住后续请求
  enableCacheInterception: true,
})
