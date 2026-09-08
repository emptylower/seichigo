# 2026-09-08 ISR 过期瞬间不再阻塞响应 + 首页再生成周期放宽

## 背景

2026-09-07 部署了 OpenNext 缓存拦截（`enableCacheInterception`）与 Durable Object 队列（`open-next.config.ts` 的 `queue: doQueue`）。生产日志与 WebPageTest 复测发现一个残留问题：

- 首页 `app/(site)/page.tsx`、`app/en/page.tsx`、`app/ja/page.tsx` 都是 `revalidate = 120`。
- 缓存过期那一刻（响应头 `s-maxage=1`），`@opennextjs/aws` 的拦截器 `node_modules/@opennextjs/aws/dist/core/routing/cacheInterceptor.js` 第 64 行 `await globalThis.queue.send(...)` 会**同步等待**队列投递完成再返回旧页面。
- `do-queue` 的 `send` 是 `await stub.revalidate(msg)`，一次 DO 远程调用；DO 冷启动或跨区域时会到秒级。实测一次 `GET /en` CPU 13 ms、wall 2722 ms，客户端 TTFB 2.9 s。
- 首页每次再生成 CPU 1.4 s、wall 最长 9 s（等 Neon），每 120 s 就要来一次，每次都让一个访客背这段等待。

## 任务 A：队列投递改为不阻塞响应

文件：`open-next.config.ts`（如需拆文件，可新建 `lib/opennext/nonBlockingQueue.ts`，但 open-next.config.ts 是构建期被 OpenNext 单独打包的入口，先确认它能正常 import 项目内文件；不确定就直接写在 open-next.config.ts 里）。

做法：不改 node_modules。写一个包装队列对象，`name` 保持 `"durable-queue"` 之类的字符串，`send(msg)` 内部：

```ts
import { getCloudflareContext } from '@opennextjs/cloudflare'
import doQueue from '@opennextjs/cloudflare/overrides/queue/do-queue'

const nonBlockingDoQueue = {
  name: 'durable-queue-nonblocking',
  send: async (msg) => {
    const { ctx } = getCloudflareContext()
    ctx.waitUntil(doQueue.send(msg).catch(() => {}))   // 错误吞掉：IgnorableError 本就不该影响响应
  },
}
```

要点：
- `getCloudflareContext()` 的返回类型在 `node_modules/@opennextjs/cloudflare/dist/api/cloudflare-context.d.ts`（第 49 行 `ctx: Context`），先读一下确认字段与同步/异步用法。
- `send` 的参数类型从 `@opennextjs/aws/types/overrides` 的 `Queue` / `QueueMessage` 取，保证 `defineCloudflareConfig({ queue })` 类型能过。
- 在 `waitUntil` 里也要把 `IgnorableError` 之外的错误 `console.warn` 一行（带 msg.MessageBody.url），方便日志排查。
- 中文注释写明日期与原因（拦截器会 await send；DO RPC 冷启动秒级）。

## 任务 B：首页 ISR 周期 120 s → 1800 s

文件：`app/(site)/page.tsx`、`app/en/page.tsx`、`app/ja/page.tsx`，把 `export const revalidate = 120` 改为 `1800`，并在旁边加一行中文注释（2026-09-08，首页数据变化慢，缩短再生成频率以减少过期瞬间的访客等待）。不要改 `dynamic = 'force-static'`。

## 验收

- `npm run typecheck`（`typecheck:tests` 有 3 个 HEAD 上预存错误，忽略）；`npm run test` 全绿。
- `npm run cf:build` 成功；`grep -c "durable-queue-nonblocking" .open-next/server-functions/default/handler.mjs` 或对应产物中能找到包装队列（确认 OpenNext 打包进去的是包装后的对象）。
- `npx wrangler deploy --dry-run --outdir scratch/wr-dry-q` 无报错。

## 约束

- **不要 git commit**，不要 push，不要执行 `deploy` / `upload` / `cf:deploy` / `cf:upload`（dry-run 允许）。
- 不要改 node_modules、`wrangler.jsonc`、`middleware.ts`、`components/**`。
- 不要改其它页面的 revalidate。

## 完成后

用简短中文汇报：改动文件；包装队列的最终代码；typecheck/test/cf:build/dry-run 结果；存疑点。
