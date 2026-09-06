# 权限与预算层评审修复（Part B 后续）

对提交 `feat(billing): 权限与预算层` 的只读评审结论：REQUEST CHANGES。以下逐条修复，每条先写失败测试再改。不要 `git commit`。除 G10 明确列出的两个前端文件外，不要碰 `app/(authed)/**`、`app/(site)/**`、`components/**`、`hooks/**`。迁移文件 `prisma/migrations/20260906000000_add_billing_tier_ledger/migration.sql` **尚未在任何数据库执行过**，可以直接改它，不要新建第二个迁移；改完只跑 `npx prisma generate`。完成后跑 `npm run typecheck` 与 `npx vitest run tests/billing tests/planAgent tests/tripPlan tests/api tests/llm`。

## G1（blocker）孤儿预扣判定会退掉正在跑的 run

问题：`refundStaleReserves` 按 reserve 行的 `createdAt` 早于 `now − 2×90s` 判孤儿。真实 run 靠续租可跑 13 分钟，超过 3 分钟的 run 会被下一次 POST 退款，随后 `settleRun` 找不到 open reserve 直接 return，成本永久漏账。

修法：
1. `lib/billing/service.ts` 的 `createBillingService` deps 增加 `isRunActive: (planId: string, runRef: string) => Promise<boolean>`。`refundStaleReserves` 对每条候选 reserve：`planId` 为空视为不活跃；否则 `await deps.isRunActive(planId, runRef)` 为 true 的跳过不退。
2. `lib/billing/serverDeps.ts` 注入 `isRunActive: async (planId, runRef) => (await prisma.tripPlan.count({ where: { id: planId, agentRunToken: runRef } })) > 0`（import prisma）。测试里用 memory：`isRunActive` 由测试传入的 `Set<string>` 决定。
3. 路由里的阈值改为常量 `STALE_RESERVE_AFTER_MS = 16 * 60 * 1000`（软截止 13 分钟 + 两倍 TTL），放在 `lib/billing/service.ts` 导出。
4. `settleRun` 兜底：找不到 open reserve 时，若存在同 `runRef` 的 `refund` 行且 `hadModelOutput && actualMicros > 0`，仍追加一条 `settle`，delta = `-actualMicros`（用该 refund 行的 userId/planId/periodStart）。`UsageLedgerRepo` 增加 `findByRunRef(runRef): Promise<LedgerEntry[]>`（memory 与 prisma 各实现）。

测试（`tests/billing/service.test.ts` 追加）：
- 活跃 run（`isRunActive` 返回 true）的 reserve 超过阈值也不被退；不活跃的被退。
- reserve 已被误退后 `settleRun({ hadModelOutput: true, actualMicros: 300_000 })` 仍写一条 `-300_000` 的 settle。

## G2（blocker）天数上限没卡在 save_plan_days

`lib/planAgent/tools.ts` 的 `save_plan_days` 分支，在现有 `if (days.length > 30)` 之前加：

```ts
        if (deps.maxDays !== undefined && days.length > deps.maxDays) {
          return JSON.stringify({ error: `当前档位单个行程最多 ${deps.maxDays} 天，请缩减天数后重新保存`, code: 'tier_max_days' })
        }
```

同时按 S11 恢复无档位路径的旧行为：`cluster_points` 与 `update_plan_meta` 里只有 `deps.maxDays !== undefined` 时才返回 `tier_max_days`，否则维持原来的 `Math.min(30, …)` 钳制。`const maxDays = deps.maxDays ?? 30` 这行删掉，改为直接读 `deps.maxDays`。

测试（`tests/planAgent/tierTools.test.ts` 追加）：`maxDays: 3` 时 `save_plan_days` 传 4 天返回 `tier_max_days` 且计划未被写入；不传 `maxDays` 时 `update_plan_meta` 传 50 天被钳到 30 而不是报错。

## G3（blocker）队列路径取档位失败时放开全部能力

`app/api/internal/plan-agent/run/route.ts`：`getAccount` 失败改为 fail-closed：

```ts
  const billingAccount = await getBillingService()
    .getAccount(plan.userId)
    .catch((err) => {
      console.error('[api/internal/plan-agent/run] getAccount failed, falling back to free entitlements', err)
      return null
    })
  const billing = billingAccount
    ? { entitlements: billingAccount.entitlements, runCapMicros: billingAccount.runCapMicros }
    : { entitlements: TIER_ENTITLEMENTS.free, runCapMicros: runCapMicros('free') }
```

测试（`tests/api/plan-agent-queue.test.ts` 追加，沿用该文件的 mock 方式）：mock `getAccount` 抛错 → `executePlanAgentRun` 收到的 `billing.entitlements.tier === 'free'`。

## G4（should-fix）周期锚点漂移与存量用户锚点回填

1. `prisma/schema.prisma` User 增加 `periodAnchor DateTime @default(now())`（注释：订阅日/注册日锚点，滚动周期时不变）。
2. 迁移 SQL 追加：
```sql
ALTER TABLE "public"."User" ADD COLUMN "periodAnchor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "public"."User" SET "periodStart" = "createdAt", "periodAnchor" = "createdAt";
```
3. `lib/billing/users.ts` 的 `BillingUser` 加 `periodAnchor: Date`；`usersPrisma.ts` select 它；`usersMemory.ts` 透传。
4. `service.getAccount` 用 `computePeriod(user.periodAnchor, current)` 计算，`setPeriod` 只写 periodStart/periodEnd。

测试（`tests/billing/service.test.ts`）：锚点 1/31，now 3/15 → periodStart 2/28、periodEnd 3/31（而不是 3/28）。相应修改 `tests/billing/period.test.ts` 若有需要。

## G5（should-fix）settle / refund 不加锁；withUserLock 改显式传参

1. `lib/billing/ledger.ts`：`withUserLock<T>(userId: string, fn: (repo: UsageLedgerRepo) => Promise<T>): Promise<T>`。`ledgerPrisma.ts` 里 `fn(scoped)`；`ledgerMemory.ts` 里 `fn(this)`。
2. `service.ts` 全部改为 `withUserLock(userId, async (ledger) => { ... })`，包括 `settleRun` 与 `refundStaleReserves`（settle 需要先由 `findByRunRef` 得到 userId 再进锁；锁内重新 `findOpenReserve` 判断幂等）。
3. `settleRun` 入口：`const actual = Number.isFinite(input.actualMicros) ? Math.max(0, Math.round(input.actualMicros)) : 0`。

测试：`tests/billing/service.test.ts` 追加“连续两次 settleRun 只产生一条 settle”“actualMicros 为 NaN 时按 0 结算不抛错”；`tests/billing/ledgerMemory.test.ts` 的 withUserLock 用例改为显式参数。

## G6（should-fix）价格常量自相矛盾

`lib/billing/priceTable.ts`：`RESERVE_MICROS.standard` 与 `pro` 改为 `250_000`。`tests/billing/budget.test.ts` 追加不变式：对三个档位 `runCapMicros(tier) >= RESERVE_MICROS[tier]`，且 `monthlyBudgetMicros(tier) >= 2 * RESERVE_MICROS[tier]`。

## G7（should-fix）单次上限的系统状态插在 assistant 消息之前

`lib/planAgent/loop.ts`：把 runCap 检查块从“收到 response 之后”挪到 `messages.push(assistantParam)` 之后、工具执行之前的位置（工具回执 push 完成后再 push 系统状态 user 消息；若该轮没有 tool_calls 则在本轮 break 前不注入，因为对话已结束）。具体：在处理完本轮所有 tool 回执、进入下一轮之前执行检查并 push 那条 user 消息。`withTitle` 与最终结算口径一致用 `Boolean(userMessage)`。

测试（`tests/planAgent/loop.tier.test.ts` 追加）：cap 触发的那轮，createMessage 第二次收到的 messages 末尾顺序为 `assistant(tool_calls) → tool → user([系统状态])`。

## G8（should-fix）续跑补齐不带档位也不计费

1. `lib/planAgent/enrichContinuation.ts` 的输入增加 `entitlements?: Entitlements` 与 `onExtraCost?: (micros: number) => Promise<void>`；内部 budget 创建后按 entitlements 设置 `places.max`/`directions.max`，`EnrichContext` 带 `entitlements`；结束时若 `budget.calls` 有非零项且 `onExtraCost` 存在，`await onExtraCost(costOfGoogleCalls(budget.calls))`（失败只 warn）。
2. `lib/planAgent/loop.ts` 派发续跑时透传 `entitlements: deps.entitlements` 与 `onExtraCost: deps.onExtraCost`；`PlanAgentDeps` 加 `onExtraCost?: (micros: number) => Promise<void>`。
3. `lib/billing/service.ts` 加 `chargeExtra({ runRef, micros })`：由 `findByRunRef` 取 userId/planId/periodStart，锁内追加一条 `kind: 'settle'`、delta `-micros`。
4. `lib/planAgent/execute.ts` 注入 `onExtraCost: (micros) => getBillingService().chargeExtra({ runRef: runToken, micros })`。

测试：`tests/planAgent/enrichContinuation.test.ts` 追加免费档 entitlements 下 restaurant 与 transport 不发外呼；`tests/billing/service.test.ts` 追加 `chargeExtra` 写一条负 settle。

## G9（should-fix）标准/高级档拿不到天数上限提示

`lib/billing/tiers.ts` 的 `tierPromptNote`：不再对全开档返回 null；始终返回含天数上限那行的附注（免费档另有交通与餐厅两行）。更新 `tests/billing/tiers.test.ts` 中 `tierPromptNote(std)` 的断言为“包含 `最多 7 天` 且不包含 `直线估算`”。

## G10（should-fix）“<1%” 的表达

1. `lib/billing/usageView.ts` 的 `UsageView` 加 `nearlyEmpty: boolean`（= `!isAdmin && balanceMicros > 0 && remainingPercent === 0`）；更新 `tests/billing/usageView.test.ts` 的全量断言。
2. 前端只改两个文件：`hooks/useUsage.ts` 的类型加 `nearlyEmpty?: boolean`；`components/billing/UsageMeter.tsx` 里 `formatPercent(usage.nearlyEmpty ? 0.5 : percent)`（`formatPercent` 已支持 0<x<1 显示 `<1%`）。`tests/billing/UsageMeter.test.tsx` 追加一例。

## G11（nit，顺手改）

- `app/api/me/plans/[id]/agent/route.ts`：`account` 为空时返回 500 与 `errors.serverError`（若字典无此键则加一个三语条目）。
- `lib/billing/priceTable.ts`：`import type { Tier }` 移到文件顶部。
- `lib/planAgent/enrich/mealEnricher.ts`：条件改写为 `ctx.entitlements?.restaurants ?? true`，并在档位关闭餐厅时为每个 meal 条目 `report.skipped.push({ enricher: 'meal', itemTitle, reason: '当前档位不含餐厅推荐' })`。
- `lib/billing/service.ts` 的 `getAccount`：先无锁 `hasEntries`，为 true 时直接无锁读 `balance`，只有需要写 grant 时才进 `withUserLock`（锁内再查一次 `hasEntries` 保证幂等）。
- `lib/billing/period.ts` 的 `computePeriod`：用月差直接算 n（`(now.year − anchor.year) × 12 + (now.month − anchor.month)`，再前后各校正一次），保留现有测试通过。
