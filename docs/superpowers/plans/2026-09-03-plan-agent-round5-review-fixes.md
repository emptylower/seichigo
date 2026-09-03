# 第五轮审查修复（2026-09-03）

背景：`docs/superpowers/plans/2026-09-03-plan-agent-round5-photo-500-budget-continuation.md` 的 R1–R5 已实现并全绿，审查发现补齐续跑（R4）在生产上是失效的，且有并发覆盖风险。工作方式同前：每条先补失败测试再改；**不要 git commit**；**不跑迁移**；只碰 `lib/planAgent/enrichContinuation.ts`、`lib/planAgent/loop.ts`、`lib/planAgent/serverDeps.ts`、`lib/planAgent/enrich/restaurantEnricher.ts`、`lib/planAgent/enrich/scheduleEnricher.ts`、`lib/tripPlan/{repo,repoPrisma,repoMemory}.ts`、`tests/planAgent/**`、`tests/tripPlan/**`。**不要碰** `lib/planAgent/api.ts`、`lib/planAgent/enrichPipeline.ts`、`lib/planAgent/pointImagePrewarm.ts`、`app/api/**`、`lib/anitabi/**`、`lib/llm/**`（其他人并行在改）。line-budget 必须通过（loop.ts 486 行、tools.ts 745 行，tools.ts 不要动）。

## 高

### S1 续跑在 Cloudflare 上根本不会执行（`lib/planAgent/loop.ts`、`lib/planAgent/serverDeps.ts`）
`deps.runInBackground` 没有任何 route 注入，生产走 `void task()`，隔离体随响应结束而销毁，61 秒的 sleep 永远醒不来。修法（不改 route）：把 `serverDeps.ts` 里的 `runInBackground(task)` 导出（内部已按 `getCfBindings()?.ctx` 以方法形式调用 `waitUntil`），`loop.ts` 用 `deps.runInBackground ?? runInBackground`。测试：`tests/planAgent/loop.test.ts` 注入假的 `globalThis[Symbol.for('__cloudflare-context__')] = { ctx: { waitUntil(p) { 断言 this === ctx; 收集 p } } }`，run 结束后 `waitUntil` 被调用一次；`fenced` 时不调用；调用发生在 `appendRunLog` 之后（用调用顺序记录断言）。

### S2 写回前必须再次栅栏 + 版本守卫（`lib/planAgent/enrichContinuation.ts`、`lib/tripPlan/{repo,repoPrisma,repoMemory}.ts`）
- `TripPlan` 类型暴露 `agentRunToken: string | null`、`agentBusyUntil: Date | null`（repoPrisma 的 `toPlan` 补映射；内存实现同步）。
- `TripPlanRepo` 新增 `replaceDaysIfUnchanged(id, expectedUpdatedAt: Date, days): Promise<TripPlanWithDays | null>`：Prisma 实现在同一事务里先 `updateMany({ where: { id, updatedAt: expectedUpdatedAt }, data: { updatedAt: new Date() } })`，`count === 0` 返回 null 不写；否则执行与 `replaceDays` 相同的 deleteMany/createMany。内存实现同语义。
- 续跑每轮：读计划后若 `plan.agentRunToken !== input.runToken` → 结束；enrich 完成后**再读一次**计划，`agentRunToken` 仍相同且 `isAgentBusy` 为 false 才用 `replaceDaysIfUnchanged(planId, plan.updatedAt, days)` 写回；返回 null（期间被改）→ 结束本轮不写日志。
- 测试：`enrichContinuation.test.ts` 补「enrich 期间（注入的 findRestaurants 回调里）另一次保存改了 updatedAt → 不写回、不写日志」「runToken 在 sleep 期间被换 → 不写回」。

## 中

### S3 只在保存通过门控时续跑（`loop.ts`）
`onSaveEvaluated` 记录的评估里带 `quality.passed`；`planNeedsContinuation` 只在最后一次保存 `quality.passed === true` 时判定。先判 `planNeedsContinuation(evaluation.enrich)`，为 false 直接跳过，不做 `getPlan` 往返（S10 合并于此）。测试补两条。

### S4 同一天不重复推荐同一家餐厅（`restaurantEnricher.ts`）
按天维护已分配 `placeId` 集合：每个 meal 依次从其搜索组结果里取第一个未在当天用过的餐厅；全用过才允许重复。`tests/planAgent/enrichContinuation.test.ts:117` 那条期望 `['ChIJ_cont_0','ChIJ_cont_0']` 的断言改为两家不同。

### S5 `date` 透传（`enrichContinuation.ts`、`enrich/scheduleEnricher.ts`）
`EnrichDay` 增加可选 `date: Date | null`；`toEnrichDays` 带上；`runScheduleEnricher` 输出的 `TripPlanDayInput` 带 `date`。保存路径（tools.ts）不动（它本来就没有 date）。测试：续跑后 `day.date` 保持原值。

### S6 预留逐条释放（`restaurantEnricher.ts`）
第一阶段收集时，对每个 lunch/dinner 且无 place 的 meal 条目都释放 1 个 `reserved`（不论后续是否派发），保证"逐条释放"契约；注释里"缓存命中退款"改为"限流/配置错误/坐标非法时退款"。测试：3 餐里 1 餐无中心 → reserved 归零。

### S7 `turnIndex` 取最大值（`enrichContinuation.ts`）
`turnIndex = max(listRunLogs.map(l => l.turnIndex)) + 1`（空则 1）。测试补一条同毫秒两条日志的用例。

完成标准：`npx vitest run tests/planAgent tests/tripPlan tests/googlePlaces` 全绿；`npx tsc --noEmit` 在本轮文件上无错（`lib/anitabi/mirror/delta.ts` 若有报错属另一并行任务，忽略）；`npm run typecheck:tests` 无新增；line-budget 在本轮文件上通过；简短中文汇报。
