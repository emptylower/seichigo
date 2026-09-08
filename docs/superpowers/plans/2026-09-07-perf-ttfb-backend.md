# 2026-09-07 首页 TTFB 修复 · 后端部分

## 背景（你需要知道的全部事实）

PageSpeed 报告首页服务器响应时间：移动端 3.3 s，桌面端 1.5 s。诊断结论：

- 首页 `app/(site)/page.tsx` 是 `force-static` + `revalidate = 120`，ISR 命中时 Worker 内部只跑 100–350 ms，但客户端 TTFB 0.7–3.1 s。差额是 Cloudflare isolate 冷启动：`npx wrangler deploy --dry-run` 显示上传体积 **49 MB，gzip 5.75 MB**（压缩上限 10 MB）。
- 体积大头：`lib/seo/gsc/client.ts` 引入 `googleapis` 全量包，编译后仅 `app/api/admin/seo/sync/route.ts` 一条路由就 11.6 MB（Compute alpha/beta/v1 等几百个无关 API 全打进来）。OpenNext 把全部路由打进单个 handler.mjs，所以这一条路由拖慢全站冷启动。
- 每 2 分钟一次的 ISR 再生成通过 `open-next.config.ts` 里的 `MemoryQueue` 在同一 isolate 的 `waitUntil` 里跑，CPU 0.7–1.7 s、wall 4–15 s，会拖慢同 isolate 内并发请求。
- 响应头有 `x-nextjs-cache: HIT` 但没有 `cf-cache-status`，每个请求都进 Next 运行时。

技术栈：Next 15 App Router + `@opennextjs/cloudflare` 1.19 + wrangler 4，自定义入口 `worker/entry.ts`（已从 `.open-next/worker.js` 原样再导出 `DOQueueHandler`、`DOShardedTagCache`、`BucketCachePurge` 三个 DO 类）。

## 任务 A：去掉 `googleapis` 全量包（最高优先级）

涉及文件：`lib/seo/gsc/client.ts`、`lib/seo/gsc/sync.ts`、`app/api/admin/seo/sync/route.ts`、`package.json`。

1. 用 `google-auth-library`（已作为 googleapis 的传递依赖存在于 node_modules，需要改成显式依赖）+ 原生 `fetch` 直接调 Search Console REST：
   `POST https://www.googleapis.com/webmasters/v3/sites/{encodeURIComponent(siteUrl)}/searchAnalytics/query`，
   请求体与现在 `client.searchanalytics.query` 的 `requestBody` 完全一致（startDate/endDate/dimensions/dataState:'all'/searchType:'web'/rowLimit:25000），响应取 `rows`。
   鉴权：`new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] })` → `getClient()` → `getAccessToken()`，Bearer 头。
   如果你判断 `@googleapis/searchconsole` 单包体积更小且更省事，也可以用它，但必须在报告里给出 dry-run 体积对比。
2. `createGscClient()` / `fetchSearchAnalytics()` 的调用方签名尽量保持，`SearchAnalyticsRow`、`GscDimension` 类型导出不变；`sync.ts` 与 route 只做最小适配。
3. `package.json`：移除 `googleapis`，新增 `google-auth-library`（版本用当前 node_modules 里已装的那个）。跑 `npm install` 更新 lockfile。
4. 环境变量读取逻辑（`GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_SERVICE_ACCOUNT_PATH`）保持不变。

验收：`npm run typecheck && npm run test` 通过；`npm run cf:build` 成功；
`npx wrangler deploy --dry-run --outdir scratch/wr-dry` 输出的 `Total Upload` 明显下降（目标 gzip < 4.5 MB），把前后两组数字写进报告。

## 任务 B：开启缓存拦截

文件：`open-next.config.ts`。在 `defineCloudflareConfig({...})` 里加 `enableCacheInterception: true`。
先读 `node_modules/@opennextjs/cloudflare/dist/api/config.d.ts` 里该字段的注释确认语义与前置条件。
注意：本项目 `middleware.ts` 做 i18n 重写，拦截必须仍在中间件之后生效；如果文档说明拦截会绕过中间件，在报告里明确指出并停下等指示，不要自行取舍。

## 任务 C：ISR 再生成改走 Durable Object 队列

文件：`open-next.config.ts`、`wrangler.jsonc`。

1. `open-next.config.ts`：`queue` 从 `new MemoryQueue()` 改为 `@opennextjs/cloudflare/overrides/queue/do-queue` 的默认导出。
2. `wrangler.jsonc` 新增：
   - `durable_objects.bindings`: `{ "name": "NEXT_CACHE_DO_QUEUE", "class_name": "DOQueueHandler" }`
   - `migrations`: `[{ "tag": "v1", "new_sqlite_classes": ["DOQueueHandler"] }]`
   具体字段以 `node_modules/@opennextjs/cloudflare` 包内 README / `dist/api/cloudflare-context.d.ts` 为准；`worker/entry.ts` 已导出 `DOQueueHandler`，不需要改。
3. 保留 wrangler.jsonc 里现有的中文注释，新增配置也按同样风格加一行注释说明日期与目的（2026-09-07 首页 TTFB 修复）。

验收：`npm run cf:build` 成功；`npx wrangler deploy --dry-run` 无 binding 报错。

## 约束

- **不要 git commit**，不要 push，不要执行任何 `deploy` / `upload` / `cf:deploy` / `cf:upload`（dry-run 允许）。
- 不要碰 `components/**`、`hooks/**`、`middleware.ts`、`public/**`（另一个任务正在并行改这些文件）。
- 不要改 `app/(site)/page.tsx` 的 `revalidate` / `dynamic`。
- 不要改数据库 schema、不要跑 prisma migrate。
- `scratch/` 目录已在 .gitignore 里，dry-run 产物放那里。

## 完成后

用简短中文汇报：改动文件清单；dry-run 体积前后对比；typecheck/test/cf:build 结果；任务 B 关于中间件的确认结论；任何未完成或存疑的点。
