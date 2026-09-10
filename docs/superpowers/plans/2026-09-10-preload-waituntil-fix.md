# 修复：preload 边缘缓存的 ctx.waitUntil 从未生效

## 问题（评审发现，非猜测）

`lib/anitabi/handlers/preloadChunks.ts` 与 `preloadManifest.ts` 里这么传：

```ts
waitUntil: deps.ctx?.waitUntil,
```

两个缺陷叠加，导致档 2 边缘缓存的写入在生产环境**没有任何 waitUntil 保护**：

1. **`deps.ctx` 全仓库没有任何地方赋值。** 它只是 `AnitabiApiDeps`（`lib/anitabi/api.ts`）上一个可选字段，`getAnitabiApiDeps()` 从不填充它。所以生产里 `waitUntil` 恒为 `undefined`，`preloadEdgeCache.ts` 的 `if (waitUntil)` 直接跳过 —— `store.put()` 变成无保护的游离 Promise，isolate 随时可能在写入完成前回收它。这正是 `preloadEdgeCache.ts` 自己的文件头注释里警告的那个坑。
2. 即使把 `ctx` 填上，`deps.ctx?.waitUntil` 取的是**未绑定的方法引用**；Workers 运行时里以 `waitUntil(write)` 裸调会抛 `Illegal invocation`（`ExecutionContext.prototype.waitUntil` 需要正确的 `this`）。

`tests/anitabi/preload-handlers.test.ts:133` 那条测试之所以绿，是因为注入的是 `vi.fn()` —— mock 函数既不在乎 `this`，也掩盖了「生产根本没人给 `ctx` 赋值」这一事实。

## 本仓库已有的正确写法

`open-next.config.ts:17`：

```ts
const { ctx } = getCloudflareContext()
ctx.waitUntil(
  doQueue.send(msg).catch((err: unknown) => { /* ... */ }),
)
```

即：从 `@opennextjs/cloudflare` 的 `getCloudflareContext()` 拿到 `ctx`，**以方法形式**在 `ctx` 上调用。

## 要做的事

1. 让 preload 的缓存写入真正走上 `ctx.waitUntil`，采用与 `open-next.config.ts` 一致的方式（`getCloudflareContext()` 取 `ctx`，`ctx.waitUntil(...)` 方法调用）。
   - 注意 `lib/anitabi/cf/bindings.ts:82` 附近已有一段「mirrors what getCloudflareContext does」的实现，先看它是否更适合本仓库的调用约定，**复用既有约定，不要另起一套**。
2. 非 Workers 环境（`next dev` / vitest / Node）必须优雅退化：取不到 ctx 时不抛错，行为退回当前的直通逻辑。
3. `preloadEdgeCache.ts` 里 `waitUntil` 的传递方式相应调整，确保**不会**出现「取出裸方法再裸调」的形态。

## 验收（关键：测试必须能抓住这两个缺陷）

- 新增一条测试，用**带 `this` 校验的替身**（例如一个对象，其 `waitUntil` 方法在 `this !== 该对象` 时抛错），证明现在的调用方式不会触发 `Illegal invocation`。单纯的 `vi.fn()` 不算数。
- 新增一条测试，证明在「调用方没有显式注入 ctx」的默认路径下，缓存写入**仍然**拿得到 waitUntil（即不再依赖 `deps.ctx` 这个从没人填的字段）。
- 取不到 Cloudflare context 的环境下不抛错、退化为直通，有测试覆盖。
- 现有 preload 缓存行为（key 口径、s-maxage=300 TTL 语义、命中/未命中头）不变，回归测试全绿。
- `npm run typecheck` 与 `npm test`（含 check-line-budget）全绿。

## 约束

- 分支 `perf/map-integration`，worktree `/Users/mac/Desktop/seichigo-wt-map-b`。只加新提交，不要 rebase、不要改写既有提交。
- 禁止 `git push`、禁止合并到 main、禁止任何部署命令。
- 端口 3457 上有个 `next start` 在跑（本地冒烟用），不要 kill 它；**不要在这个 worktree 里跑 `npm run build`**（会和它冲突），跑 vitest 即可。
- 不要碰 `features/map/**`、`components/map/**`、`lib/anitabi/image*.ts`（与本次无关）。
- 完成后用简短中文汇报：改了哪些文件、新测试是怎么验证 `this` 绑定的、测试结果。
