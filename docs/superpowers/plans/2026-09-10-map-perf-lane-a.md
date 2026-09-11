# 地图页性能优化 — Lane A（数据 / 图片）

## 背景与实测证据

2026-09-10 用 Playwright 实测 `https://seichigo.com/map` 与对标站 `https://www.anitabi.cn/map`（同网络、日本出口）：

| 指标 | anitabi | seichigo |
|---|---|---|
| 总响应数 | 80 | **266** |
| 总字节 | 5.1 MB | **31.9 MB** |
| 点位/封面图 | 18 张 / **0.13 MB** | 118 张 / **29.8 MB** |
| 点位数据加载完成 | ~9.2s | **~17.4s** |

用户主观感受：anitabi 一两秒出图，我们要 5–10 秒。

本 Lane 负责服务端 / 数据 / 图片管线三件事。地图前端启动顺序与底图样式由 **Lane B** 在另一个 worktree 并行处理，见下面「文件归属」。

---

## 任务 1（P0，最高优先）：地图封面图改用 h160 变体

### 问题

地图标记头像（`kind: 'cover'`）在下**原图**。实测同一文件：

```
img-tc.anitabi.cn/bangumi/328609.jpg            → 761,592 B
img-tc.anitabi.cn/bangumi/328609.jpg?plan=h160  →   8,604 B   （cf-cache-status: HIT）
```

线上抓到的最大几张：1.9MB、1.5MB、1.25MB、1.07MB。下完之后在浏览器里被 `cutSpriteSheet` 切成几十像素的圆头像 —— 超采 88–150 倍。这堆图从 10s 一直占满连接到 24s。

### 根因位置

`lib/anitabi/imageNormalize.ts` 的 `normalizeAnitabiDisplayVariant()`：非点位路径分支（文件末尾 `// 非点位路径（bangumi 封面等）保持原有处理` 那段）只给 `kind === 'point-thumbnail'` 补 `plan=h160`，`kind === 'cover'` 什么也不做，于是走原图。

调用点：`features/map/anitabi/media.ts:172` 与 `:183`（`toMapDisplayImageUrl(raw, { kind: 'cover' })`）—— **media.ts 归 Lane B，不要改它**，只改 imageNormalize 侧的归一逻辑即可生效。

### 要做的事

1. 让 anitabi bangumi 封面路径（`/bangumi/<id>.jpg`，即 `isAnitabiPointImagePath()` 为 false 的 anitabi 图片）在 `kind === 'cover'` 时也补 `plan=h160`。
2. **关键坑**：`image.anitabi.cn/bangumi/328609.jpg?plan=h160` 返回 **403**，只有 `img-tc.anitabi.cn` 支持 `?plan=`。实测：
   ```
   image.anitabi.cn/bangumi/328609.jpg?plan=h160   → 403
   img-tc.anitabi.cn/bangumi/328609.jpg?plan=h160  → 200, 8604 B
   ```
   所以补 plan 之前必须确保 host 已经归一到 `img-tc.anitabi.cn`（看 `normalizeAnitabiMirrorUrl` 现有行为，必要时扩展）。
3. `lib/anitabi/imageMirrorVariants.ts`：`enumeratePointImageVariants()` 目前对 `/bangumi/` 路径直接返回 `[]`（因为 `isAnitabiPointImagePath` 为 false），所以 R2 镜像里没有封面的 h160 变体。新增一条 bangumi 封面的 h160 变体枚举，让镜像同步任务能把它灌进 R2。
   - **务必与现有 mirror key 口径零漂移**：key 由 `computeCanonicalImageUrl` + `computeMirrorKey`（SHA-256 前 24 hex）算出，8.5 万现有对象不能失效。新增变体只能是**新增** key，不能改动已有 canonical 的算法。
4. `lib/anitabi/imageProxy.ts` 的候选梯（R2 → 代理 → 代理重试 → 直连）保持不变；未镜像时 404 回落代理的行为要继续成立（h160 变体在 R2 里还没灌之前，必须能回落到 `img-tc.anitabi.cn?plan=h160` 直取，而不是回落成原图）。

### 验收

- 单测覆盖：`kind: 'cover'` + anitabi bangumi 路径 → 产出带 `plan=h160` 且 host 为 `img-tc.anitabi.cn` 的 URL。
- 单测覆盖：`image.anitabi.cn` 输入也要被归一到 `img-tc.anitabi.cn` 后再补 plan。
- 回归：`kind: 'point' | 'point-preview'`（w640q80）、`kind: 'point-thumbnail'`（h160）、bgm 封面（`/pic/cover/l/` → `/pic/cover/m/`）行为**完全不变**。
- 现有 mirror key 零漂移：`computeCanonicalImageUrl` 对既有输入的输出必须逐字节不变，加个断言测试锁住。

---

## 任务 2（P0）：preload chunk / manifest 上边缘缓存

### 问题

`/api/anitabi/preload/chunks/{0..5}?locale=zh` 连测三次 TTFB 稳定在 **2.47 / 2.51 / 2.51 秒**，响应头里**完全没有 `cf-cache-status`**，说明 Cloudflare 边缘缓存根本没接管，每次都回源打 Neon。响应头带着：

```
cache-control: public, s-maxage=300, stale-while-revalidate=1800
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
x-opennext: 1
```

那个 `vary` 基本注定不可缓存。manifest 自己耗时 6.5s。6 个 chunk 分三批并发发出，点位数据 **17.4s** 才齐。

对标：anitabi 的 `/d/g*.json` 是构建期产出的静态文件，`cf-cache-status: HIT`，2MB 的 g.json TTFB 0.55s、总耗时 0.95s。数据体量跟我们差不多，差距全在缓存。

### 涉及文件

- `app/api/anitabi/preload/manifest/route.ts`
- `app/api/anitabi/preload/chunks/[index]/route.ts`
- `lib/anitabi/handlers/preloadChunks.ts`（响应头在这里设）
- manifest 对应的 handler
- `lib/anitabi/read.ts` 的 `listPreloadChunk`

### 要做的事

按下面顺序尝试，**做到哪一档就停在哪一档，并在汇报里说明选了哪档、为什么**：

**档 1（先做，成本最低）**：去掉那个 `vary` 头，让 CF 边缘能缓存 Worker 响应。OpenNext 在 Cloudflare 上对 API route 的缓存拦截行为要确认 —— 如果去掉 vary 后 `cf-cache-status` 出现 HIT 就成了。

**档 2（档 1 无效时）**：在 handler 里显式用 Cloudflare Cache API（`caches.default.match` / `caches.default.put`）自己做边缘缓存，key 用 `locale + index + 数据版本`。注意 Worker 里 `put` 要放进 `ctx.waitUntil`（本仓库踩过坑：`open-next.config.ts` 里包装队列就是为这个）。

**档 3（最彻底，若前两档都不理想再考虑）**：像 anitabi 一样把点位数据在构建期/定时任务里预生成成静态 JSON 丢 R2 或静态资源，用内容 hash 当版本号，前端从 CDN 直取。**这档改动面大，动手前先在汇报里说明方案，不要直接实施。**

### 验收

- `curl -sSI 'https://<预览或本地>/api/anitabi/preload/chunks/0?locale=zh'` 第二次起出现 `cf-cache-status: HIT`（本地验不了边缘缓存的话，至少证明 vary 已去除、Cache API 命中路径有单测覆盖）。
- 目标：chunk TTFB 2.5s → <200ms（缓存命中时）。
- 数据正确性不变：同一 locale/index 返回的点位内容与改造前一致，加单测锁住。
- s-maxage=300 的过期语义保留，不能让点位数据永久 stale。

---

## 任务 3（P1，**必须等任务 1、2 都完成并各自验证通过后再开始**）：服务端预生成图标 sprite sheet

### 背景

anitabi 把所有番剧图标预先打成**一张** `bangumi-icons.webp`（460,996 B）+ 一个 `bangumi-icons.json` atlas，一次请求全拿到。我们现在是 118 个独立图片请求，在浏览器里用 `components/map/utils/spriteRenderer.ts` 的 `cutSpriteSheet` 现切。

任务 1 做完后单张图会从 ~250KB 降到 ~8KB，字节数问题基本解决；本任务解决的是**请求数**（118 → 1）和主线程切图开销。

### 涉及文件

- `components/map/utils/spriteRenderer.ts`
- `components/map/utils/coverAvatarLoader.ts`
- `features/map/anitabi/useCompleteMode.ts`（`cutSpriteSheet` 调用点在 772 行附近，`COMPLETE_MODE_SPRITE_BUDGET_MS` 预算逻辑在 757–806）
- 新增一个服务端生成/托管 sprite sheet 的路由或构建脚本

### 要做的事

1. 服务端（构建期脚本或定时任务）把番剧图标合成一张 webp sprite sheet + atlas JSON，产物走 R2 / 静态资源，带内容 hash 版本号。
2. 客户端优先加载 sprite sheet + atlas；sprite sheet 不可用时**回落到现有的 `cutSpriteSheet` 逐张路径**，不要删掉回落分支。
3. 保留现有的 `COMPLETE_MODE_SPRITE_BUDGET_MS` 时间预算与 `warmupMetricRef` 指标上报语义。

### 验收

- sprite sheet 命中时，地图 complete 模式下的图标请求数从 ~118 降到 1–2。
- sprite sheet 缺失/404 时能无感回落到旧路径，`tests/map/completeMode.integration.test.tsx` 与 `tests/map/coverAvatarLoader.test.ts` 仍然通过。

---

## 全局约束

### 文件归属（Lane B 正在另一个 worktree 并行改这些，**绝对不要碰**）

- `features/map/anitabi/media.ts`
- `features/map/anitabi/useMapStyleFailover.ts`
- `features/map/anitabi/useAnitabiMapController.ts`
- `features/map/anitabi/useAnitabiSelection.ts`
- `features/map/anitabi/MapShell.tsx`
- `features/map/anitabi/AnitabiMapLayout.tsx`

如果任务确实需要改上面任一文件，**不要改，在最终汇报里写清楚需要什么改动**，由人去协调。

### 其他

- 当前分支 `perf/map-data-images`，worktree `/Users/mac/Desktop/seichigo-wt-map-a`。
- 可以在本分支 `git commit`（小步、原子），但**禁止 `git push`、禁止合并到 main、禁止任何部署命令**（`wrangler deploy` / `opennextjs-cloudflare deploy` / `npm run cf:deploy` 一律不许跑）。
- 需要起本地 dev server 时用端口 **3457**，不要用 3001（被别的服务占用）；停进程按 pid 停，不要按端口 kill。
- 数据库：脚本默认连 `.env` 里的开发库，不要动 `.env.local`（那是生产 Neon）。不要跑迁移。
- 每个文件有行数预算，`npm test` 里的 `scripts/check-line-budget.mjs` 会卡；文件写长了要拆模块而不是放宽预算。

### 完成标准（三条都必须绿）

```bash
npm run typecheck
npm test
npx vitest run tests/map tests/anitabi
```

### 汇报

完成后用简短中文汇报：每个任务改了哪些文件、任务 2 选了哪一档缓存方案及原因、测试结果、以及任何你判断需要人来决策的点。
