# 回归第六轮：点位图变体根因修复、R2 镜像任务复活、预热与断路器（2026-09-03）

工作方式同前：先通读现状；每条先补失败测试再实现；**不要 git commit**；**不跑任何数据库迁移**；`node scripts/check-line-budget.mjs` 必须通过（新逻辑放新文件）。

## 0. 总览：当前全部修复动作与状态

| 编号 | 内容 | 负责 | 状态 |
|---|---|---|---|
| 第四轮 | 图片去重、客户端计时/断路器/重挂载、点位 Google 兜底、餐厅固定推荐 | glm / k3 | 已完成，预览 acb355d3 |
| 第五轮 R1–R5 | `waitUntil` 脱离 ctx 的 500、照片引用长度 512→4096、Places 配额 6→40 与限速 8→60/分、餐厅并发去重、run 结束后不叫模型的补齐续跑、point-photo 错误码 | glm | 已完成（54 文件 / 532 用例全绿） |
| 模型接入 A | LlmProvider 表、密钥加密、OpenAI/Anthropic 客户端、接管 agent/翻译、管理 API | glm | 已完成（96 文件全绿；新增 `LLM_PROVIDER_SECRET`） |
| 模型接入 B | 管理面板页面与侧栏 | k3 | 已完成 |
| **第六轮 A**（本文件） | 点位图变体根因、镜像任务改投递域与清理、hourly 触发、诊断补状态码 | glm | 待派发 |
| **第六轮 B**（本文件） | DayCards 用缩略图变体、断路器阈值 | k3 | 待派发 |
| **第六轮 C**（本文件） | 保存即预热 R2（依赖第五轮的 `runInBackground`/`enrichPipeline`） | glm | 待派发 |
| **第六轮 E**（本文件） | 代理 `url` 参数双重解码导致 R2 键错位（多参数上游 URL 从未命中 5 月镜像） | glm | 第六轮 A 完成后派发 |

## 1. 线上实证（生产库 + 线上探测，2026-09-03）
- 上游 `image.anitabi.cn` 对大陆外 IP 一律 403；投递域 `img-tc.anitabi.cn` 正常。页面代理已走投递域；**镜像种子任务 `lib/anitabi/mirror/seed.ts` 仍直接 fetch canonical**，8/31–9/1 跑的 2,703 条里 2,209 条 `upstream 403`。
- 镜像任务实际只在 5 月做过全量（bootstrap 5/3–5/14），之后几乎没跑（6 月 158 条、8 月底 2,703 条）：`docs/api.md` 里 `GET /api/cron/anitabi/hourly` 是 external trigger，早已停摆。8 月新增 4,224 个点位没有任何镜像状态；总计 4,606 个有图点位无状态。
- **根因**：`normalizeAnitabiDisplayVariant` 对 kind=point/point-preview 的图，路径不是 `/points/` 开头时（用户上传的 `/user/<uid>/bangumi/<id>/points/…` 都是）一律改写成 `plan=h320`；上游没有这个变体（EdgeOne 返回 404），5 月全量镜像时 41,668 条 h320 全被记成 `skipped_404`。于是 daymap 卡片与 /map 弹窗的每张点位图都是"R2 未命中 + 上游 404 → 代理 502（4–5 秒）"，三张后断路器封禁，其余秒失败。`plan=h160`（42,467 条已镜像，17 KB）与 `w=640&q=80`（已镜像，上游忽略缩放参数返回原图 177 KB）在生产上都是 R2 命中、2 秒内返回。
- 变体对照（同一张图，线上代理）：`plan=h320` → 502；`plan=h160` → 200 r2-primary 17 KB；`w=640&q=80` → 200 r2-primary 177 KB。

---

## A. 后端（glm-5.3）——只碰 `lib/anitabi/**`、`lib/mapImageDiag/**`、`app/api/admin/anitabi/**`、`.github/workflows/**`、`docs/api.md`、`tests/anitabi/**`、`tests/map/thumbnailUrl.test.ts`、`tests/map/loadMapImageWithCandidates.test.ts`。**不要碰** `lib/planAgent/**`、`lib/googlePlaces/**`、`components/**`、`app/(authed)/**`（其他人并行在改）。

### A1 变体映射根因修复（`lib/anitabi/imageNormalize.ts`）
- `normalizeAnitabiDisplayVariant`：kind 为 `point` / `point-preview` 时，**所有** anitabi 点位图路径（`/points/…` 与 `/user/<uid>/bangumi/<id>/points/…`，以及 `/images/` 前缀的同构路径）统一走现有的 `w=640&q=80` 分支（删掉 `plan`，无 w/h 时补 `w=640`，无 q 时补 `q=80`）；`point-thumbnail` 统一 `plan=h160`。删除末尾"非 /points/ 路径一律 `plan=h320`"的分支——`h320` 变体上游不存在，任何 kind 都不得再生成它。
- 判定点位路径复用 `lib/anitabi/imageMirrorVariants.ts` 里的正则（抽成共享的 `isAnitabiPointImagePath(pathname)` 放到 `imageNormalize.ts` 并在 variants 里引用），两处口径必须一致。
- 非点位路径（bangumi 封面等）保持原逻辑。
- 测试：`tests/map/thumbnailUrl.test.ts` / `tests/map/loadMapImageWithCandidates.test.ts` 补：`https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg` 在 kind=point 下候选 URL 的 `url` 参数解码后为 `…x.jpg?w=640&q=80`（不含 plan）；kind=point-thumbnail 为 `?plan=h160`；`/points/38125/y.jpg` 同样；全库不再有任何测试期望 `plan=h320`（改掉旧断言）。

### A2 镜像任务改走投递域 + 去掉 h320 + 清理与补漏（`lib/anitabi/mirror/seed.ts`、`lib/anitabi/imageMirrorVariants.ts`、`lib/anitabi/mirror/delta.ts`、新文件 `lib/anitabi/mirror/cleanup.ts`、新路由 `app/api/admin/anitabi/image-mirror/cleanup/route.ts`）
- `seed.ts`：fetch 目标改为 `resolveAnitabiDeliveryUrl(new URL(item.canonicalUrl)).toString()`；R2 key 与状态表仍用 `item.canonicalUrl`（key 零漂移）。`user-agent` 不变。
- `imageMirrorVariants.ts`：只返回 `[h160, w640q80]`；`h320` 彻底移除。
- `cleanup.ts`：`cleanupObsoleteMirrorState(prisma)`：① `deleteMany({ variant: 'h320' })`；② 把 `status='failed'` 且 `lastError` 含 `upstream 403` 的行重置为 `status='pending', attempts=0, lastError=null`；③ 返回 `{ deletedH320, resetFailed }`。分批执行（每批 5,000，循环直到没有），避免一次删 4 万行超时。
- `delta.ts`：读完现有游标逻辑后确认新点位（`AnitabiPoint.updatedAt` 晚于游标）会被枚举；另加一个每 tick 最多 500 个的"无状态补漏"：`AnitabiPoint` 有 `image` 且 `MapImageMirrorState` 无对应 `point-image` 行的，生成两个变体的 pending 行（用 `NOT EXISTS` 子查询或 `findMany` + `notIn`，注意 4,606 条规模）。
- 管理路由 `POST /api/admin/anitabi/image-mirror/cleanup`：管理员会话（同 `image-mirror/status` 路由的鉴权方式）→ 调 `cleanupObsoleteMirrorState` → `{ ok: true, ...result }`。
- 测试：`tests/anitabi/mirror-seed*.test.ts` 补「fetch 收到的 URL host 是 img-tc.anitabi.cn，而 putMirroredImage 的 canonical 仍是 image.anitabi.cn」；variants 测试改为 2 个变体；cleanup 测试用 Prisma mock 断言两类操作；delta 测试补「无状态点位被补进 pending」。

### A3 hourly 触发接回来（`.github/workflows/anitabi-hourly.yml`、`docs/api.md`）
- 先读 `lib/anitabi/handlers/cron.ts` 确认 hourly 接受的鉴权方式（header / bearer / `?secret=`）与环境变量名，workflow 按该方式调用。
- workflow：`on: schedule: cron: '7 * * * *'` + `workflow_dispatch`；一步 `curl --fail --max-time 120` 调 `${{ vars.SITE_URL || 'https://seichigo.com' }}/api/cron/anitabi/hourly`，密钥来自 `${{ secrets.ANITABI_CRON_SECRET }}`；失败让 job 失败（GitHub 会发通知）。
- `docs/api.md` 的 hourly 行注明由该 workflow 触发。

### A4 诊断补上游状态码（`lib/anitabi/handlers/imageServe.ts` 或其发事件的辅助模块）
- `proxy_fetch_terminal` 失败事件的 `evidence` 增加 `upstreamStatus`（数字）与 `deliveryHost`；成功事件同样带 `upstreamStatus: 200`。imageServe.ts 在行数白名单里（824 行上限），只允许改这几行；如需新函数放 `lib/anitabi/handlers/imageServeEvidence.ts`。
- 测试补一条断言 evidence 含 `upstreamStatus`。

### A 完成标准
`npx vitest run tests/anitabi tests/map` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增错误；line-budget 通过；简短中文汇报（含 workflow 需要的 secret 名称）。

---

## B. 前端（kimi k3）——只碰 `components/map/ResilientMapImage.tsx`、`components/map/utils/mapImageHostPolicy.ts`、`app/(authed)/plan/[id]/components/DayCards.tsx`、`tests/map/resilient-map-image*.test.tsx`、`tests/map/mapImageHostPolicy.*.test.ts`、`tests/plan/dayCards.test.tsx`。

### B1 daymap 卡片用缩略图变体
- `ResilientMapImage` 的 `kind` 增加 `'point-thumbnail'`（候选梯直接透传给 `getMapDisplayImageCandidates`；断路器 scope 映射为 `'point-thumbnail'`；超时按 point 同款 20 秒）。
- `DayCards.tsx` 的 `TimelineCardRow` 图片（80–96 px）改用 `kind="point-thumbnail"`；返程/交通目的地卡片若渲染点位图同样改。Google 地点图（相对路径）不受影响。
- 测试：`dayCards.test.tsx` 断言站内点位 img 的 src 解码后含 `plan=h160`。

### B2 断路器阈值
- `mapImageHostPolicy.ts`：`DEGRADED_HOST_FAILURE_THRESHOLD` 2 → 3，`BLOCKED_HOST_FAILURE_THRESHOLD` 3 → 6（窗口仍 10 秒）。更新对应测试。

### B 完成标准
`npx vitest run tests/map tests/plan` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增错误；简短中文汇报。

---

## C. 保存即预热（glm-5.3，第五轮完成后派发）——只碰 `lib/planAgent/pointImagePrewarm.ts`（新）、`lib/planAgent/enrichPipeline.ts`（第五轮新建）、`tests/planAgent/pointImagePrewarm.test.ts`

- `prewarmPointImages(input: { imageUrls: string[]; bucket: R2MirrorBucket; prisma; fetchImpl?; maxImages = 40; concurrency = 4; timeoutMs = 8_000 })`：对每个点位图 URL 生成 `h160` 与 `w640q80` 两个 canonical 变体（复用 `imageMirrorVariants`），`getMirroredImage` 未命中的才 fetch 投递域 URL → `putMirroredImage(bucket, canonical, bytes, mime, 'lazy')` → upsert `MapImageMirrorState`（mirrored）。任何失败只 warn。
- 接线：`enrichAndNormalizeDays` 之后（save_plan_days 与补齐续跑两处共用）通过第五轮新增的 `runInBackground` 派发；无 bucket（本地）直接跳过。
- 测试：注入 bucket/fetch 假件，3 个点位图 → 6 次 get、其中 2 次命中不 fetch、4 次 fetch+put；超过 maxImages 截断。

---

## D. 自测清单（主会话执行，派发完成后）
1. 预览上用管理员 cookie 请求用户计划 37 张点位图的**新候选 URL**（`w=640&q=80` 与 `plan=h160`）：预期全部 200 且 `x-seichigo-image-source: r2-primary`。
2. `/api/google/place-photo?placeId=…` 与 `/api/google/point-photo?pointId=…` 预期 200 image/jpeg。
3. 本地脚本用真实 key 调 `createNearbySearch`：餐厅 `place.photo` 非空（引用长度 > 512）。
4. 预览上 `POST /api/admin/anitabi/image-mirror/cleanup` → 返回删除/重置计数；随后 `GET /api/cron/anitabi/hourly`（带 secret）一次 → `status` 端点 `mirrored` 增加、`failed` 减少。
5. 对管理员自己的计划触发一次保存（或运行补齐续跑）后，run log 出现 `stage='enrich'` 且 `restaurantPending` 减少。

---

## E. 代理 `url` 参数被双重解码导致 R2 键错位（glm-5.3，第六轮 A 完成后派发）——只碰 `lib/anitabi/handlers/imageServe.ts`（或新文件 `lib/anitabi/handlers/imageServeTarget.ts`）、`lib/anitabi/imageProxy.ts`、`tests/anitabi/**`、`tests/map/loadMapImageWithCandidates.test.ts`

### 线上实证（2026-09-03，预览 acb355d3 与生产 seichigo.com 一致）
- 请求 `/api/anitabi/image-render?url=<单次 encodeURIComponent 的 https://image.anitabi.cn/...jpg?q=80&w=640>`：服务端拿到的目标是 `...jpg?q=80`（`X-Original-Source` 证实），`w=640` 被当成了代理自己的顶层参数——Cloudflare/OpenNext 上 `req.url` 的 query 已被解码过一次，`new URL(req.url).searchParams.get('url')` 在第一个 `&` 处截断。
- 同一目标改成**双重编码**后：服务端目标完整，R2 键 `1e748fba…` 与 5 月种子任务写入的键完全一致，`x-seichigo-image-source: r2-primary` 直接命中。
- 影响：所有带两个以上参数的上游 URL（`w=640&q=80`，即全部 point/point-preview 图）从未命中过 5 月镜像，而是拉上游并把对象写到错误的键下；这就是诊断表里 50% 缓存未命中和 /map 弹窗图慢/失败的来源。单参数的 `plan=h160` 不受影响。
- 本地 Node 开发服务器没有这个双重解码（`computeCanonicalImageUrl` 本地结果正确），所以修复必须两端兼容。

### E1 服务端稳健解析（`imageServe.ts` 的 `parseTargetUrl` 调用处）
- 新增 `resolveProxyTargetUrl(req: Request): URL | null`（放新文件 `imageServeTarget.ts`，imageServe.ts 在行数白名单内只允许改调用行）：
  1. 从 `req.url` 取原始 query 字符串（`?` 之后的部分，**不要先经 URLSearchParams**），用正则找 `(^|&)url=([^&]*)`，取到值 `v`；
  2. `v` 先 `decodeURIComponent` 一次；若结果仍含 `%3A%2F%2F` 或 `%3F` 或 `%26`（说明客户端双重编码）再解一次；
  3. 若解出的目标 URL 没有 `?`，但原始 query 里 `url=` 之后还跟着**非代理参数**（不在 `url`、`_retry`、`name`、`__mi_*` 集合里的键，如 `w`、`q`、`h`、`plan`），把它们按原顺序追加回目标 URL 的 query（这是对"已被平台解码一次、客户端又只单次编码"的存量 URL 的兜底）；
  4. 其余校验（协议、凭据、私网 host）沿用 `parseTargetUrl`。
- 测试 `tests/anitabi/imageServeTarget.test.ts`：三种输入（单次编码完整 / 平台已解码一次导致截断 / 双重编码）都解析成 `https://image.anitabi.cn/...jpg?q=80&w=640`；带 `_retry=1&__mi_session=x` 不被误并入目标；`w` 出现在目标 query 里时不重复追加。

### E2 客户端双重编码（`lib/anitabi/imageProxy.ts` 的 `buildProxyImageUrl` / `buildRetryProxyUrl`）
- `proxied.searchParams.set('url', encodeURIComponent(url.toString()))`（URLSearchParams 会再编码一次 → 线上解码一次后仍是合法的单次编码值，E1 第 2 步再解一次）。
- `readMapImageUpstreamHost`（`components/map/utils/mapImageHostPolicy.ts` 属于 B 的范围，**这里不改**）读取 `url` 参数后若仍是编码形式需再 `decodeURIComponent` 一次——在本节汇报里明确指出，由主会话安排前端跟进。
- 测试：`tests/map/loadMapImageWithCandidates.test.ts` / `tests/anitabi/imageProxy*.test.ts` 更新断言：候选 URL 的 `url` 参数解码两次后等于目标。

### E 完成标准
`npx vitest run tests/anitabi tests/map` 全绿；`npx tsc --noEmit` 无错；line-budget 通过；简短中文汇报。

### E3 并行改动的收口（同一次派发一并完成）
- `workers/**` 下镜像相关测试（bootstrap/delta/seed）仍断言 3 个变体与 canonical 域抓取：按 A2 的新口径改为 2 个变体（h160、w640q80）与投递域 `img-tc.anitabi.cn` 抓取；若 `workers/**` 有自己的 seed 实现也同步改成投递域抓取。
- `tests/map/resilient-map-image.test.tsx` 788 行超过 750 预算：把 point-thumbnail 与阈值相关用例拆到 `tests/map/resilient-map-image-thumbnail.test.tsx`，两文件都 ≤ 750。
- `components/map/utils/mapImageHostPolicy.ts` 的 `readMapImageUpstreamHost`：`url` 参数值若仍是编码形式（含 `%3A%2F%2F`）先 `decodeURIComponent` 一次再取 host（配合 E2 的双重编码）；更新 `tests/map/mapImageHostPolicy.proxyAware.test.ts`。
- `lib/planAgent/pointImagePrewarm.ts`：`MapImageMirrorState.sourceId` 改用点位 id（与 cron 侧同键，避免每个点位两套状态行）——`prewarmPointImages` 入参改为 `{ pointId: string; imageUrl: string }[]`，`enrichPipeline.ts` 从条目的 `pointId` 与 `coordsByPointId.get(pointId).image` 组装；对应测试更新。
- `line-budget.allowlist.json`：`lib/anitabi/handlers/imageServe.ts` 824 → 822（锁定缩小后的上限）。

### E 完成标准（合并 E1–E3）
`npx vitest run` 全量全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 只剩 `tests/lib/prisma-client-lifecycle.test.ts` 的 3 条存量；`node scripts/check-line-budget.mjs` 通过；简短中文汇报。

### E4 定时器真相与收口（覆盖 A3）
- 真正的镜像定时器是独立 worker `workers/anitabi-mirror`（`seichigo-anitabi-mirror`，crons `*/5`（cronTick 镜像队列）、`0 * * * *`（cronDelta + 转发主站 daily）、`15 3`（转发 translate/ops）），它直接 import 共享的 `@/lib/anitabi/mirror/*`；最后一次部署是 2026-05-10，镜像逻辑受 `MAP_IMAGE_MIRROR_CRON_ENABLED` 开关控制。所以 A3 的 GitHub Actions workflow 是多余的：**删除 `.github/workflows/anitabi-hourly.yml`**，`docs/api.md` 改回说明由该 worker 触发，并在 `docs/runbooks/anitabi-r2-mirror.md` 补一段"改了共享 mirror 代码后必须 `cd workers/anitabi-mirror && npx wrangler deploy`，并确认 `MAP_IMAGE_MIRROR_CRON_ENABLED=1`"。
- `workers/anitabi-mirror/src/__tests__/{seed,delta,bootstrap}.test.ts` 按 A2 新口径修正（2 个变体、投递域抓取）；确认 `workers/anitabi-mirror` 的 `npx vitest run`（或其 package.json 的 test 脚本）全绿。
- 部署该 worker 由主会话执行，本轮不要部署。
