# Phase 2-A：POST /agent 瘦身——归属读投影 + 预扣并入 begin 事务

worktree：`/Users/mac/Desktop/seichigo-wt-post` ／ 分支：`perf/post-slim`

> 背景：DO 派发上线后用户可见首字 ≈ 6.4–7.0s，其中 **POST 占 2.0–3.8s**，是现在最大的一段。
> pool=1 强制串行、单次往返 0.164s。POST 关键路径上约 20 个往返：session 1 + `getPlan(PLAN_INCLUDE)` **5** +
> `getAccount` 3 + `beginAgentRun` 事务 ~5 + `reserveForDispatch` 事务 **~6** + DO 接纳 1。本批砍两处：
> `getPlan` 5→1，`reserveForDispatch` 并进 `beginAgentRun` 同一事务（省整个第二事务）。预期 POST −1.0～1.5s。
> 联合方案 v1 不变量 2（预扣先于派发、同事务核验 token）在 begin 事务内天然成立——token 就是在这里生成的。

## 效率要求
- **只读下面列出的文件**，不要读前端、不要读 `lib/planAgent/loop.ts`、不要 grep 全仓。
- **不要调用任何技能**，直接干活。

### 必读文件
1. `app/api/me/plans/[id]/agent/route.ts`（全文）
2. `lib/tripPlan/repo.ts` 的 `beginAgentRun` / `getPlan` / `getAgentRunState` 声明
3. `lib/tripPlan/repoPrisma.ts` 的 `beginAgentRun`（`:270-300`）与 `getPlan`
4. `lib/tripPlan/repoMemory.ts` 对应方法
5. `lib/planAgent/runAdmission.ts`、`runAdmissionMemory.ts`（全文）
6. `lib/billing/ledgerPrisma.ts` 的构造器与 `append`
7. `tests/planAgent/runAdmission.test.ts`、`tests/planAgent/routeAdmission.test.ts`、`tests/api/plan-agent-queue.test.ts`、`tests/tripPlan/claimAgentRun.test.ts`

## 边界
允许改：上述文件 + 相关测试。
**绝不要改**：`lib/planAgent/loop.ts` / `execute.ts` / `dispatch.ts` / `resume.ts`、`app/api/internal/**`、`worker/**`、`lib/billing/service.ts`、`app/(authed)/**`、`prisma/**`、`wrangler.jsonc`、`package.json`、`line-budget.allowlist.json`。
不要 `git commit` / `push`；不要跑 `dev` / `build` / `cf:*` / `wrangler` / playwright / prisma。

## 改什么

### 1. 归属读投影（5 条 SQL → 1 条）
POST 对 `plan` 的**全部**消费只有两处：`plan.userId`（403 判定）与 `plan.agentBusyUntil`（撤销预判）；`:234` 那行是注释。新增仓储方法（三处）：
```ts
/** POST /agent 准入用的最小投影（1 条 SQL）：归属 + 租约到期。计划不存在返回 null。 */
getPlanAdmission(planId: string): Promise<{ userId: string; agentBusyUntil: Date | null } | null>
```
Prisma：`findUnique({ where:{id}, select:{ userId:true, agentBusyUntil:true } })`。POST 里 `deps.repo.getPlan(id)` → `getPlanAdmission(id)`；`getPlan` 保留不动（别处在用）。404/403 分支响应逐字不变。

### 2. 预扣并入 begin 事务（省一整个事务 ≈ 6 往返）
- `TripPlanRepo.beginAgentRun` 增加**可选**参数 `inTx?: (tx: unknown) => Promise<void>`：在事务内、抢到 busy 位并落库 human 消息**之后、提交之前**调用；抛错则整个事务回滚（`quota_exceeded` / `busy` 分支**不**调用它）。Prisma 实现把 `tx`（Prisma.TransactionClient）原样传入；Memory 实现在同一同步段里调用。
- `runAdmission.ts` 新增：
  ```ts
  /**
   * 不变量 2 的合并实现：begin 与预扣同一事务——token 在此生成，"仍是本 run、未 claim、未过期"天然成立；
   * 管理员不记账；成功返回 begin 的结果（含 token）。quota_exceeded / busy 原样透传，不记账。
   */
  beginAndReserve(input: BeginAgentRunInput & { account: BillingAccount }): Promise<BeginAgentRunResult>
  ```
  Prisma：`repo.beginAgentRun({ ...input, inTx: async (tx) => { if (account.isAdmin) return; await new PrismaUsageLedger(tx).append({ userId, planId, runRef: <token>, kind:'reserve', deltaMicros: -RESERVE_MICROS[account.tier], periodStart: account.periodStart }) } })`。
  ⚠️ `inTx` 回调需要拿到刚生成的 token——把 `inTx` 签名定为 `(tx: unknown, ctx: { token: string }) => Promise<void>`。
  锁顺序不变：begin 事务开头已是用户 advisory lock → TripPlan 行。
- POST：`beginAgentRun(...)` + `reserveForDispatch(...)` 两步合并为 `admission.beginAndReserve({...})`；`token_gone → 409` 分支自然消失（token 不可能在同一事务里失效）。`reserveForDispatch` 保留（内联/其它调用者若无则标注 deprecated，不删）。
- `revokeExpiredUnclaimed` 不动。

### 3. 不要动的
- `getAccount` 三读（含写分支，必须留在 POST）。
- `answerMetaPatch` 直写顺序、`dispatchedAt` 取时点（仍在预扣成功之后、派发之前——现在即 begin 成功之后）。
- 内联 SSE 路径与 P0-A 的 claim 早退。

## 测试
- `getPlanAdmission`：存在/不存在；POST 用它后 404/403 用例逐字通过；`getPlan` 在 POST 里**不再被调用**（spy 断言）。
- `beginAndReserve`（Memory + 若有集成基建则 Prisma）：成功 → 恰一条 reserve 且 runRef=token；`quota_exceeded`/`busy` → 无账目；`inTx` 抛错 → busy 位未被占、human 消息未落库、无账目（回滚）；管理员 → 无账目。
- POST：202 之前账本已有 reserve（既有断言）；`plan-agent-queue.test.ts` 的精确对象断言若受影响同步改；`routeAdmission.test.ts` 的 `token_gone→409` 用例改写或删除并说明。
- 既有 4824 个测试仍全绿。

## 验收
```
npm run typecheck
npm test
```

## 报告
简短中文汇报：`inTx` 钩子的落点（事务内哪一步之后）、POST 现在的关键路径顺序、删掉/保留了哪些方法、两条验收命令的**实际输出**。不要 `git commit`。
