# plan agent M4 第一期 实施计划：补齐层 + 质量门控 + 阶段推断 + 运行日志

> 设计：`docs/superpowers/specs/2026-09-02-plan-agent-m4-orchestration-quality-gates-design.md`（必读 §3–§7）。
> 工作方式：先 `git status`/`git diff` 通读现状（工作树有大量未提交但已验证的改动，不要动无关文件）；每个任务先补失败测试再实现；不要 git commit。本期只有 A（后端）。
> 文件边界：A 只碰 `lib/**`、`prisma/**`、`tests/planAgent/**`、`tests/tripPlan/**`、`tests/googlePlaces/**`；B 只碰 `app/(authed)/plan/[id]/**`、`tests/plan/**`。
> 行数预算：`node scripts/check-line-budget.mjs` 必须通过；`lib/planAgent/tools.ts` 已接近上限，新逻辑一律放新文件。

**Goal:** 规划结果落库前由服务端脚本补齐（地点/餐厅/交通/时间/图片）并通过质量门控；每回合由持久化证据推断阶段并注入提示词；每回合写运行日志。

**Architecture:** 新增 `lib/planAgent/enrich/`（五个 enricher + 汇总）、`lib/planAgent/gates.ts`（纯函数门控）、`lib/planAgent/stage.ts`（证据推断）、`TripPlanRunLog` 表与 repo 方法。`save_plan_days` 流程改为：解析 → enrichers → 校验/归一化 → gates → 硬失败拒绝/通过落库（daymap 携带 quality）。loop 每回合开始把阶段与门控摘要拼进 system prompt 尾部。

---

## A. 后端（glm-5.3）

### A1 门控纯函数 `lib/planAgent/gates.ts`

```ts
export type GateId = 'coords' | 'transport' | 'schedule' | 'provenance' | 'density' | 'media' | 'estimate_ratio'
export type GateFailure = { gate: GateId; severity: 'hard' | 'soft'; dayIndex: number; itemTitle?: string; fix: string }
export type PlanQualityReport = {
  passed: boolean                       // 无 hard 失败
  hard: GateFailure[]
  soft: GateFailure[]
  stats: {
    visitItems: number; withCoords: number; withMedia: number
    transitLegs: number; transitReal: number; transitEstimated: number; missingTransit: number
    daySpanMaxMin: number
  }
  evaluatedAt: string
}
export type GateDayInput = { dayIndex: number; items: Array<{ type: string; title: string; pointId?: string | null; payload?: Record<string, unknown> | null }> }
export function evaluatePlanGates(days: GateDayInput[], coordsByPointId: Map<string, { lat: number; lng: number }>, scheduleOk: boolean): PlanQualityReport
```

规则（设计 §5）：可到访条目 = type ∈ {point, attraction, lodging, meal}。坐标：`coordsByPointId.get(pointId)` 或 `payload.place.lat/lng`。交通门：同一天相邻两个有坐标条目之间必须存在一条 `type='transit'` 且 `payload.transport.provider` 非空，缺失记 hard（fix 文案："用 estimate_travel 补「A」→「B」的交通"）。时间门：`scheduleOk === false` 记 hard；每天首末 `payload.schedule` 跨度 > 13h 记 hard。出处门：`payload.place` 缺 provider/placeId 记 hard；`transport.estimated === true` 但 `provider !== 'estimate'` 记 hard。密度门：每天可到访条目 <3 或 >9 记 soft。图片门：有 media 或（pointId 且调用方传入 hasImage）的比例 <0.8 记 soft（coordsByPointId 的值类型扩为 `{lat,lng,image?:string|null}`）。估算门：`transitEstimated / transitLegs > 0.6` 记 soft。
测试 `tests/planAgent/gates.test.ts`：每个门一条正例一条反例 + stats 计数。

### A2 补齐层 `lib/planAgent/enrich/`

- `types.ts`：`EnrichBudget = { googleCalls: number; max: number }`（默认 max 12）；`EnrichReport = { applied: Record<EnricherName, number>; skipped: Array<{ enricher: EnricherName; itemTitle: string; reason: string }>; googleCallsUsed: number }`；`EnricherName = 'place' | 'restaurant' | 'transport' | 'schedule' | 'media'`。
- `placeEnricher.ts`：包装既有 `backfillExternalPlaces`（把其 `maxGoogleCalls` 接到共享 budget）。
- `restaurantEnricher.ts`：meal 条目仍无合法 `payload.place` 时，取同一天该条目之前最近一个有坐标条目为中心，调 `deps.findRestaurants({ lat, lng })`（现有 nearby 能力，签名以 `lib/planAgent/serverDeps.ts` 为准），取第 1 家写入 `payload.place`（完整 ResolvedPlace，含 photo），`note` 追加"备选：B（4.4）、C（4.3）"；无前置坐标或无结果记 skipped；每次调用计入 budget。
- `transportEnricher.ts`：把 `tools.ts` `estimate_travel` case 里"查询 + 组装 transportPayload（含日本公交兜底）"抽成 `lib/planAgent/travelQuery.ts` 的 `queryTravelBetween(deps, { from, to, mode, departureTimeSec })`，tool 与 enricher 共用。enricher 规则：同一天相邻两个有坐标条目之间若无 transit 行，插入 `{ type:'transit', title:'A → B', payload:{ transport } }`；mode 取 `plan.preferences.travelMode`（'walk'|'transit'|'driving'|'mixed'，缺省 mixed：直线距离 ≤1.5 km 用 walking，否则 transit）；每次调用计入 budget；失败记 skipped 不插行。
- `scheduleEnricher.ts`：调用 `normalizeDaySchedule`，返回 ok 与 errors（自愈已在 normalizer 内）。
- `mediaEnricher.ts`：对有 place 无 media 的条目调 `derivePlaceMedia`。
- `index.ts`：`runEnrichers(days, ctx): Promise<{ days; report: EnrichReport }>` 按 place → restaurant → transport → media 顺序执行（schedule 由 save 流程原位置调用并把结果喂给 gates），幂等；任何 enricher 抛错只记 skipped。
- 测试 `tests/planAgent/enrich/*.test.ts`：每个 enricher 的正例、预算耗尽、失败静默；`runEnrichers` 顺序与幂等（连跑两次 applied 第二次为 0）。

### A3 阶段推断 `lib/planAgent/stage.ts`

```ts
export type PlanStage = 'works' | 'dates' | 'points' | 'enrich' | 'deliver' | 'revise'
export function derivePlanStage(input: { plan: TripPlanWithDays; messages: TripPlanMessage[]; quality: PlanQualityReport | null }): PlanStage
export function buildStageContext(stage: PlanStage, quality: PlanQualityReport | null, enrich?: EnrichReport): string  // 追加到 system prompt 尾部的中文段落，≤ 600 字
```
判定表见设计 §3；`revise` = 最近一条 daymap 之后存在 human 消息。`buildStageContext` 输出形如："## 当前状态\n阶段：enrich（有行程但门控未过）。未通过：交通门 3 处（Day2 A→B …）、图片门 2 处。建议下一步：补齐交通后再保存。你可以按用户最新意图跳转阶段。"
测试 `tests/planAgent/stage.test.ts`：六种阶段各一例 + 中途换作品回退到 works（bangumiIds 被清空）。

### A4 `TripPlanRunLog` 表 + `TripPlan.stage`

Prisma：
```prisma
model TripPlanRunLog {
  id           String   @id @default(cuid())
  planId       String
  runToken     String?
  turnIndex    Int
  stage        String
  enrichReport Json?
  gateReport   Json?
  toolCalls    Json?
  modelUsage   Json?
  durationMs   Int
  createdAt    DateTime @default(now())
  plan         TripPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  @@index([planId, createdAt])
}
```
`TripPlan` 增加 `stage String?` 与 `runLogs TripPlanRunLog[]`。迁移目录 `prisma/migrations/20260902010000_add_trip_plan_run_log/migration.sql`（风格同 `20260902000000_add_external_place`）。开发库应用方式沿用上次：`prisma migrate dev` 会因存量漂移要求 reset，改用 `npx prisma db execute --file <migration.sql>` + `npx prisma migrate resolve --applied 20260902010000_add_trip_plan_run_log`，然后 `npx prisma generate`。绝不对生产库执行。
repo：`TripPlanRepo` 增加 `appendRunLog(entry)`、`updateStage(planId, stage)`；`repoPrisma.ts`、`repoMemory.ts` 各实现；`toPlanListItemView`/`toPlanView` 暴露 `stage`。测试 `tests/tripPlan/*`（内存实现）。

### A5 save 流程与 loop 接入

- `lib/planAgent/tools.ts` `save_plan_days`：解析 days 后 → `runEnrichers`（替换现有直接调用 `backfillExternalPlaces` 的那段）→ 既有校验 → 归一化（记录 scheduleOk）→ `evaluatePlanGates`（coords 来自 `getPointsByIds`，含 image）→ `report.passed === false` 时返回 `{ error: '质量门控未通过，未落库', gates: report.hard, softWarnings: report.soft, enrich: report }` 且不落库；通过则落库，daymap payload 增加 `quality: PlanQualityReport`（仅内部排查用，前端不渲染；`lib/tripPlan/view.ts` 的 `DaymapMessagePayload` 加可选 `quality`，`parseDaymapPayload` 透传），返回值增加 `quality` 与 `enrich`。
- `lib/planAgent/loop.ts`：run 开始时计算 `stage`（需要最近一次 quality：从最近 daymap 消息的 `quality` 取，没有则 null）与 `buildStageContext`，拼到 system 消息尾部；`deps.repo.updateStage(planId, stage)`（失败忽略）；run 结束（finally）`appendRunLog`：turnIndex、stage、toolCalls 摘要（名称 + 耗时）、enrich/gate（取本 run 最后一次 save 的结果）、durationMs。tool 执行器需要把最后一次 save 的 `{ enrich, quality }` 回传给 loop：在 `PlanAgentToolDeps` 加 `onSaveEvaluated?: (r: { enrich: EnrichReport; quality: PlanQualityReport }) => void`。
- 提示词 `prompt.ts`：加一句"保存被质量门控拒绝时，按返回的 gates 列表逐条补齐再重新保存；soft 警告只需在总结里说明"。
- 测试：`tests/planAgent/tools.save-plan-days-gates.test.ts`（缺交通 → 拒绝且返回 fix 文案；补齐后通过且 daymap 带 quality）；`tests/planAgent/loop.test.ts` 补两条（system 尾部含"当前状态"；run 结束写了 runLog）。

完成标准：`npx vitest run tests/planAgent tests/tripPlan tests/googlePlaces` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 除 `tests/lib/prisma-client-lifecycle.test.ts` 的 3 条存量外无新增；`node scripts/check-line-budget.mjs` 通过；汇报每个任务改了什么、开发库迁移是否应用。

---

## B. 前端（本期无用户可见改动）

产品原则（2026-09-02 用户决定）：质量门控、阶段、补齐报告都是**内部机制**，不向 C 端用户展示。用户只应看到结果本身：点位图片、地图渲染、交通信息齐全。因此本期**不做**质量卡与阶段 chip；daymap payload 里的 `quality` 字段仅供运行日志与后续内部排查，前端忽略即可（`parseDaymapPayload` 透传但不渲染）。

## C. 人工收尾
- 生产库迁移 `20260902010000_add_trip_plan_run_log`（我来执行，需同时注入 DATABASE_URL 与 DATABASE_URL_UNPOOLED）。
- 上传预览并冒烟：保存时缺交通应被服务端自动补齐（用户无感）；点位图、地图、交通信息齐全；`TripPlanRunLog` 有行、`gateReport` 有内容。
