# 修复：SWR 的存储 TTL 被 cloudflare-cdn-cache-control 压掉，stale 分支生产不生效

## 生产实测：stale 分支没有生效

预览版 `33a33d14`（version override 定向真实生产环境）实测：

```
1 冷启      → miss  3.601s
2 立刻      → hit   0.479s
3 等 310 秒 → miss  3.510s   ← 期望是 stale，实际是 miss
4 再打      → hit   1.400s
```

单测全绿但生产失效。原因是测试替身是个普通 Map，完全不解析缓存头，无法暴露真实边缘的 TTL 语义。

## 根因（有官方文档依据）

`lib/anitabi/preloadEdgeCache.ts` 的 `toStorageResponse()` 只把 **`cache-control`** 换成了长 TTL（`public, max-age=86700`），但响应里还带着 `preloadCacheResponseHeaders()` 设的：

```
cloudflare-cdn-cache-control: public, max-age=300, stale-while-revalidate=1800
```

Cloudflare Workers 缓存的头优先级（https://developers.cloudflare.com/workers/cache/configuration/ 的 Header precedence 一节）：

> 1. `cloudflare-cdn-cache-control` — Cloudflare-specific, **highest precedence**. Consumed by Cloudflare and stripped from the response returned to clients.
> 2. `cdn-cache-control`
> 3. `Cache-Control`

所以存储条目的实际寿命由 `max-age=300` 决定，300 秒后条目就被边缘丢弃，`match()` 拿不到 → 永远落 miss，stale 窗口形同虚设。

## 正确做法（同一篇文档明确推荐）

> Use `cloudflare-cdn-cache-control` when you want a longer edge TTL than you expose to browsers without leaking the directive downstream.

也就是说这个头**本来就是**用来表达"边缘 TTL 比浏览器 TTL 长"的官方机制。改法：

1. `toStorageResponse()`：把**存储 TTL 写进 `cloudflare-cdn-cache-control`**（`public, max-age=<FRESH+STALE>`），而 `cache-control` **保持浏览器口径原值不动**（preload 的 `s-maxage=300`、spriteSheet 的 immutable 1y）。
2. 既然 `cache-control` 不再被篡改，`x-preload-browser-cc` 这个私有头连同 `toBrowserResponse()` 里的还原逻辑**整套删掉** —— 不需要了，简化实现。
3. Cloudflare 会在返回给客户端前自动剥掉 `cloudflare-cdn-cache-control`，所以长 TTL 不会泄漏给浏览器；但请**保留**一条测试断言确认返回给调用方的 `cache-control` 仍是浏览器口径（不要依赖 Cloudflare 的剥除行为来保证正确性）。
4. `x-preload-cached-at` 时间戳与三态（hit / stale / miss）判定逻辑**不变**，那部分是对的。

## 验收（关键：要能抓住这次这种"单测绿但生产假"的缺陷）

- 新增/改造测试：断言**写入缓存的那个响应**（put 收到的 Response）上，`cloudflare-cdn-cache-control` 的 max-age == FRESH+STALE，且 `cache-control` 仍是浏览器口径原值。这条能直接钉死本次根因。
- 断言返回给调用方的响应里 `cache-control` 是浏览器口径，且不含存储用的长 TTL。
- 既有 SWR 行为测试（hit / stale 立即返回不等待 / waitUntil 方法形式调度一次 / 并发去重 / 超窗口 miss / 无 store 直通）全部保留并通过。
- `npm run typecheck` 与 `npm test`（含 check-line-budget）全绿。

## 约束

- 分支 `perf/map-integration`，worktree `/Users/mac/Desktop/seichigo-wt-map-b`。只加新提交，不要 rebase。
- 禁止 `git push`、禁止合并到 main、禁止任何部署命令，不要跑 `npm run build`。
- 不要碰 `lib/anitabi/imageNormalize.ts` / `imageMirrorVariants.ts` / `features/map/**` / `components/map/**`。
- 缓存 key 口径不变。
- 完成后用简短中文汇报：改了什么、新断言长什么样、测试结果。
