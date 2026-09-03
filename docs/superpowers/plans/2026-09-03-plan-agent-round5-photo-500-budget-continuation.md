# 回归第五轮：地点图片接口 500、照片引用被拒、Places 配额与补齐续跑（2026-09-03）

工作方式同前：先通读现状；每条先补失败测试再实现；**不要 git commit**；**不跑任何数据库迁移**；只碰 `lib/googlePlaces/**`、`lib/planAgent/**`（**不要碰 `lib/planAgent/api.ts`**）、`lib/directions/googleClient.ts`、`tests/planAgent/**`、`tests/googlePlaces/**`、`tests/directions/**`；`node scripts/check-line-budget.mjs` 必须通过（tools.ts 已 749 行，不要再加行；新逻辑放新文件）。另有两个 opencode 并行在改 `lib/llm/**`、`lib/planAgent/api.ts`、`lib/translation/**`、`app/api/admin/llm/**`、`app/(authed)/admin/llm/**`，不要碰。

## 线上实证（2026-09-03 预览 acb355d3，管理员账号复现）
1. **`/api/google/place-photo?placeId=…` 与 `/api/google/point-photo` 一律 500**（上一版预览 9d10fdc7 同样 500；`?ref=` 路径对随机 ref 返回 502 说明依赖装配正常）。调试版抓到堆栈：`TypeError: Illegal invocation: function called with incorrect 'this' reference`——`lib/googlePlaces/api.ts` 把 `bindings.ctx.waitUntil` 这个方法**脱离 ctx 传出**（`waitUntil: bindings.ctx.waitUntil`），handler 里 `deps.waitUntil(write)` 调用时 `this` 不对。所以所有 Google 地点图（含点位兜底图）在 Cloudflare 上从未成功过；能显示的只是曾经走过 anitabi 代理或浏览器缓存的图。`lib/planAgent/serverDeps.ts` 的 `runInBackground` 同样脱离 ctx 调用（被 try/catch 吞掉，表现为镜像状态偶尔写不上）。
2. **餐厅已找到但全部 `photo: null`**：Google Nearby 实测每家都带 1 张照片，但 `photo_reference` 现在长 644–671 字符，`isValidPhotoReference` 上限 512 → 全部丢弃。`ExternalPlace.photos` 落成 `[]`/`null`，去重与 Place Details 补拉也就无从谈起。
3. **配额**：用户最新计划 10 天 19 餐，`places` 每次保存只有 6 次、`places.ts` 限速 8 次/分钟；地点解析 6 次用完后 13 餐记 `restaurantPending`，5 处住宿「本次保存的自动解析预算已用完」；agent 随后 ask_user 结束回合，没有任何环节再来补。Google Maps 平台按 SKU 每月免费 10,000 次（Essentials）/ 5,000 次（Pro），当前用量远低于此。
4. anitabi 点位图代理冷路径 5–9 秒（上游在国内），边缘缓存命中后 1.6–1.9 秒；R2 写入正常。

---

### R1 绑定 waitUntil（`lib/googlePlaces/api.ts`、`lib/planAgent/serverDeps.ts`）
- 两处都改成闭包：`waitUntil: (promise) => bindings.ctx!.waitUntil!(promise)`（api.ts 两个 deps 装配点）；serverDeps 的 `runInBackground` 用 `const ctx = getCfBindings()?.ctx; if (ctx?.waitUntil) ctx.waitUntil(promise)`。
- 全库 grep `ctx?.waitUntil\b`/`ctx.waitUntil\b` 的其他脱离调用一并修（`lib/anitabi/handlers/imageServe.ts:54` 是方法调用形式，正确，不动）。
- 测试：`tests/googlePlaces/api.test.ts` 补「注入的 bindings.ctx.waitUntil 是一个检查 `this === ctx` 的方法（不对就抛 Illegal invocation），经 `getGooglePlacesApiDeps()` 取到的 `waitUntil` 调用不抛」；`tests/planAgent/serverDeps.test.ts` 同款断言 `runInBackground` 路径。

### R2 照片引用长度（`lib/googlePlaces/places.ts`）
- `isValidPhotoReference` 上限 512 → 4096（字符集不变）。
- 测试：`tests/googlePlaces/places.test.ts` 补 700 字符合法引用通过；`tests/googlePlaces/nearby.test.ts` 用 700 字符 `photo_reference` 断言餐厅 `place.photo` 非空、`photos.length === 1`。

### R3 配额与限速上调 + 餐厅并发（`lib/planAgent/enrich/types.ts`、`lib/googlePlaces/places.ts`、`lib/directions/googleClient.ts`、`lib/planAgent/enrich/restaurantEnricher.ts`）
- `ENRICH_PLACES_MAX_DEFAULT` 6 → 40；`ENRICH_DIRECTIONS_MAX_DEFAULT` 12 → 40；`MODEL_PLACES_BUDGET_RESERVE` 2 → 10、`MODEL_DIRECTIONS_BUDGET_RESERVE` 4 → 10（模型自己最多用 30/30，补齐脚本可用满）。
- `places.ts` 的 `RATE_MAX_CALLS` 8 → 60（每计划每分钟）；`googleClient.ts` 的 `rateMax` 默认 15 → 60。
- 餐厅 enricher：把"逐条串行"改成"先收集待搜条目（含各自 center），再以并发 4 执行 `findRestaurants`，按原顺序写回"；预算与 reserved 计量语义不变（在发起前判定与扣减，避免并发超发：把 `budget.places.used += 1` 的预扣放到发起前，用 `onGoogleCall` 只做校准——若实际没有外呼则回退 1）。同一坐标的多次搜索（同一天多餐同中心）复用第一次结果（内存 Map，key=`lat,lng` 四位小数），第二餐取第 2 名餐厅、第三餐取第 3 名，避免同一天推荐同一家。
- 测试：`tests/planAgent/enrich/restaurantEnricher.test.ts`（新建）：4 餐同中心 → `findRestaurants` 只调 1 次且四条拿到不同餐厅；预算 2 → 只成功 2 条其余 `restaurantPending`；并发不超过 4（注入的 findRestaurants 记录同时在飞的数量）。

### R4 补齐续跑（新文件 `lib/planAgent/enrichContinuation.ts`；接线 `lib/planAgent/loop.ts` 的 finally 之后）
目标：run 结束时若最后一次保存仍有「预算已用完」类 skipped 或 `restaurantPending` 条目，服务端在后台**不叫模型**再跑补齐脚本，把缺口补上。
- `planNeedsContinuation(enrichReport)`：`skipped` 里 reason 含「预算已用完」/`'budget'` 或 applied 之外仍存在 `restaurantPending`（由调用方传入天数据判断）→ true。
- `runEnrichContinuation(input: { planId, runToken, repo, points, deps(serverDeps 里的 places/externalPlaces/findRestaurants/travel/fetchPlacePhotos), maxPasses = 2, waitMs = 61_000, sleep? })`：
  1. 每一轮：`sleep(waitMs)`（让 60 秒预算窗口滚动）→ 读取计划；若 `plan.agentRunToken !== runToken`（新 run 已接管）或 `agentBusyUntil` 在未来且 token 不同 → 直接结束；
  2. 把 `plan.days` 转成 `EnrichDay[]`（payload 原样、`type` 保留），构造与 `save_plan_days` 相同的 `EnrichContext`（新建 `createEnrichBudget()`），`orderDaysBySchedule` → `runEnrichers` → `runScheduleEnricher`；归一化失败则放弃本轮（不落库）；
  3. `repo.replaceDays(planId, normalizedDays)`；`repo.appendRunLog({ planId, runToken, turnIndex: 上一条 +1, stage: 'enrich', enrichReport, gateReport: null, toolCalls: [{ name: 'enrich_continuation', durationMs }], modelUsage: null, durationMs })`；
  4. 若本轮报告不再需要续跑 → 结束；否则进入下一轮直到 `maxPasses`。
  任何异常只 `console.warn`，绝不抛出。
- 接线：`loop.ts` 的 finally 写完运行日志后，若 `!fenced && planNeedsContinuation(...)`，通过 `deps.runInBackground?.(() => runEnrichContinuation(...))` 派发（`deps.runInBackground` 是新增的可选依赖，由 route 侧注入 `getCfBindings()?.ctx` 绑定后的 waitUntil——**route 文件由另一位并行修改，本轮只在 `loop.ts`/`tools.ts` 类型上加可选字段，不改 route**；缺省时用 `void promise` 浮动执行）。
- 提取 `save_plan_days` 里"构造 EnrichContext + 排序 + runEnrichers + schedule"这段为 `lib/planAgent/enrichPipeline.ts` 的 `enrichAndNormalizeDays(days, ctx)` 供两处共用；tools.ts 只允许行数减少。
- 测试 `tests/planAgent/enrichContinuation.test.ts`：内存 repo + 内存 store；场景 A：2 餐 `restaurantPending`、注入 findRestaurants 可用 → 一轮后两餐都有 place 且写了一条 stage='enrich' 的 run log；场景 B：runToken 已变 → 不改数据、不写日志；场景 C：第一轮仍有缺口、第二轮补齐 → 恰好两条日志；`sleep` 注入为立即返回。

### R5 点位图接口自检（`lib/googlePlaces/handlers/pointPhoto.ts`）
- `servePlacePhotoByPlaceId` 抛异常（非 404）时 point-photo 不要吞成 500 空响应：catch 后 `console.error` 带 `pointId/placeId`，返回 502 `{ error: '图片读取失败' }`（前端候选梯会回退占位）。测试补一条。

完成标准：`npx vitest run tests/planAgent tests/googlePlaces tests/directions tests/tripPlan` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增错误；line-budget 通过；简短中文汇报。
