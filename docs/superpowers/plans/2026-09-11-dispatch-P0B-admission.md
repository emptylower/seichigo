# Phase 0-B：同步幂等预扣先于派发 + 过期未 claim 的撤销退款 + 暂停开关 + dispatchedAt

worktree：`/Users/mac/Desktop/seichigo-wt-dispatch` ／ 分支：`feat/dispatch-phase0`

> 背景：`docs/superpowers/plans/2026-09-11-dispatch-joint-plan-v1.md` §1 Phase 0、§2 不变量 2 与 5、§3 软截止与开关。
> P0-A（claim）已完成并在本分支：`claimAgentRun` / `getAgentRunState` / `agentRunStartedAt` 已存在，**不要重做**。

## 要修的隐患（为什么）

昨天为省 POST 时间把"预扣额度"挪到返回 202 之后异步做（`app/api/me/plans/[id]/agent/route.ts` 里 `runAfterResponse(reserveRun())`）。队列派发慢掩盖了它；派发一旦变成毫秒级，run 可能在预扣落账前结束，`settleRun` 找不到 reserve → 成本漏记，随后落账的 reserve 变成孤儿占用余额。修法：**预扣同步完成、按 runRef 幂等，且在同一事务里核验 token 仍是本 run、未 claim、租约未过期**；派发失败或过期未执行的尝试能在同一事务里撤销 token + 退款。

## 效率要求

- **只读下面列出的文件**，不要读前端、不要读 `lib/planAgent/loop.ts`、不要 grep 全仓。
- **不要调用任何技能**，直接干活。

### 必读文件
1. `app/api/me/plans/[id]/agent/route.ts`（全文，约 310 行）
2. `lib/billing/service.ts`（`reserveRun` / `settleRun` / `refundStaleReserves`）
3. `lib/billing/ledger.ts`（接口）、`lib/billing/ledgerPrisma.ts`（`withUserLock` 事务）、`lib/billing/ledgerMemory.ts`（若存在）
4. `lib/billing/serverDeps.ts`
5. `lib/tripPlan/repo.ts` 的 `beginAgentRun` / `claimAgentRun` / `getAgentRunState` 声明；`lib/tripPlan/repoPrisma.ts` 对应实现
6. `lib/planAgent/queueMessage.ts`（48 行）、`app/api/internal/plan-agent/run/route.ts`（`SOFT_DEADLINE_MS` 与 `deadlineAt`）
7. `tests/api/plan-agent-queue.test.ts`、`tests/billing/`（既有）

## 边界

允许改：上述文件 + 新建 `lib/planAgent/runAdmission.ts`（及 Memory 实现）+ 相关测试 + `wrangler.jsonc` **仅**加一个 `PLAN_AGENT_STARTS_PAUSED` var（默认 `"0"`）。
**绝不要改**：`lib/planAgent/loop.ts`、`lib/planAgent/resume.ts`、`lib/tripPlan/handlers/**`、`app/(authed)/**`、`worker/**`、`prisma/schema.prisma`（本批**不加**字段）、`package.json`、`line-budget.allowlist.json`。
不要 `git commit` / `push`；不要跑 `dev` / `build` / `cf:*` / playwright / prisma 迁移。

## 改什么

### 1. 新增 `lib/planAgent/runAdmission.ts`

一个事务协调模块，Prisma 实现 + Memory 实现（供 vitest）。**锁顺序统一：用户 advisory lock → TripPlan 行**（与 `beginAgentRun`、`ledger.withUserLock` 一致；`ledgerPrisma.withUserLock` 的实现就是 `prisma.$transaction` + `pg_advisory_xact_lock(hashtext(userId))`，本模块可以用同样的模式自己开事务，在事务里同时做 TripPlan 条件更新与账本读写；**不要在一个事务里再调用会另开事务的 service 方法**）。

```ts
export interface RunAdmission {
  /**
   * 不变量 2：预扣成功先于派发。同一事务内：
   *  1) 用户锁；
   *  2) TripPlan 条件更新 `id AND agentRunToken=token AND agentRunStartedAt IS NULL AND agentBusyUntil > now`
   *     （data 只续租 agentBusyUntil）—— 影响 0 行 => token 已失效/已领取/已过期，返回 { ok:false, reason:'token_gone' }，不记账；
   *  3) 同 runRef 已有 reserve 行 => 幂等返回 { ok:true, idempotent:true }；
   *  4) 否则 append reserve（金额与 RESERVE_MICROS[tier] 一致；管理员直接 ok 不记账，沿用 service 的豁免）。
   */
  reserveForDispatch(input: { account: BillingAccount; planId: string; runToken: string }): Promise<
    { ok: true; idempotent: boolean } | { ok: false; reason: 'token_gone' | 'insufficient' }
  >
  /**
   * 不变量 5：撤销过期且未 claim 的本 token 并退款其 open reserve，同一事务提交或回滚。
   * 条件更新 `id AND agentRunToken=token AND agentRunStartedAt IS NULL AND agentBusyUntil < now`
   * → 清 token/busy；0 行（已被 claim / 已换 token）=> 不退款，返回 { revoked:false }。
   * 幂等：没有 open reserve 就只撤销不退款。
   */
  revokeExpiredUnclaimed(input: { userId: string; planId: string; runToken: string }): Promise<{ revoked: boolean; refunded: boolean }>
}
```
`insufficient`：非管理员且 `balance < amount` 且 **不** force——注意今天 POST 是 `force: true`（预检已在 `canStartRun` 做过），保持 `force` 语义：`reserveForDispatch` 不因余额不足失败，只因 token 失效失败。所以 `'insufficient'` 分支保留在类型里但当前不会触发，加注释说明。

### 2. POST 路由重排

顺序改为（在 `beginAgentRun` 成功拿到 `runToken` 之后）：
1. `answerMetaPatch` 直写（位置不变）。
2. **`const adm = await admission.reserveForDispatch({ account, planId: id, runToken })`**
   - `ok:false, token_gone` → 记 warn，返回 `NextResponse.json({ error: errors.planBusy }, { status: 409 })`（token 已不是我们的，不派发、不进内联、不 endAgentRun 别人的）。
3. **`dispatchedAt = new Date().toISOString()`**（成功预扣后、首次派发前取一次；后续降级原样携带，不刷新）。
4. 队列可用 → `queue.send({ ...原字段, dispatchedAt })` → 202。**删除** `runAfterResponse(reserveRun())` 那行（预扣已同步完成）。
5. 队列不可用/发送失败 → 内联 SSE：**删除**内联段里的 `await reserveRun()`（已预扣），其余不动（P0-A 已加的 claim 早退保留）。
6. 原 `reserveRun` 闭包若无其它调用点则删除；`billing.reserveRun` 本身保留（别的地方可能用）。

**撤销的触发点**：在 `beginAgentRun` **之前**、拿到 `plan` 之后：
```ts
const prior = await deps.repo.getAgentRunState(id)   // 1 次往返；仅当 plan.agentBusyUntil 已过期且非 null 时才查，常见路径零成本
if (prior && prior.startedAt === null && prior.busyUntil && prior.busyUntil < new Date()) {
  await admission.revokeExpiredUnclaimed({ userId, planId: id, runToken: prior.token })
}
```
（`plan.agentBusyUntil` 在领域类型里已有，可先用它做零成本预判；`getAgentRunState` 只在需要时调。）

### 3. `PLAN_AGENT_STARTS_PAUSED`

POST 里，在 **stop 分支之后、`emptyMessage` 检查之前**：
```ts
if (process.env.PLAN_AGENT_STARTS_PAUSED === '1') {
  return NextResponse.json({ error: errors.serverError, code: 'starts_paused' }, { status: 503 })
}
```
stop、GET、观察流不受影响。`wrangler.jsonc` vars 加 `"PLAN_AGENT_STARTS_PAUSED": "0"`（只加这一行）。

### 4. `dispatchedAt` 与软截止

- `queueMessage.ts`：`dispatchedAt?: string`（可选；校验器：**缺省放行**，存在但非字符串或 `Date.parse` 为 NaN 则拒绝——这是联合方案"新字段非法拒绝"的约定，与 `tier` 的"完全不校验"不同，注释写明原因：它参与软截止计算）。
- 内部路由：`deadlineAt = body.dispatchedAt ? Date.parse(body.dispatchedAt) + SOFT_DEADLINE_MS : Date.now() + SOFT_DEADLINE_MS`（旧消息缺字段沿用入口起算）。若 `deadlineAt <= Date.now()`（已过期的新消息）：**不调 executePlanAgentRun**，改为 `claimAgentRun` 成功后直接 `endAgentRun` + 写一条 `stage:'interrupted'` 运行日志（用既有 repo 方法 `appendRunLog` 或等价物；若没有现成方法就只 endAgentRun 并 console.warn，报告里说明）+ 退款（`billing.settleRun({ runRef, actualMicros: 0, hadModelOutput: false })` 即退 reserve）→ 响应 `{ skipped: 'expired' }`。

## 测试（F7 / F8 / F10 的单测层）

- `reserveForDispatch`：同 runRef 两次 → 只有一条 reserve 行、第二次 `idempotent:true`；token 已被 claim（先 `claimAgentRun`）→ `token_gone` 且无账目；token 过期 → `token_gone`；管理员 → ok 不记账。
- `revokeExpiredUnclaimed`：过期未 claim + open reserve → token 清空 + 一条 refund，余额恢复；已 claim → `revoked:false` 且无 refund；无 reserve → `revoked:true, refunded:false`；同一输入调两次幂等。
- POST（`tests/api/plan-agent-queue.test.ts` 扩展）：202 之前账本里已有 reserve（不再依赖 waitUntil）；`queue.send` 载荷含 `dispatchedAt`（两处精确断言要补字段）；`PLAN_AGENT_STARTS_PAUSED=1` → 503 且不 `beginAgentRun`，stop 仍可用；上一轮 token 过期未 claim 时本次 POST 先 revoke+refund 再 begin。
- 内部路由：`dispatchedAt` 过期 → `{ skipped:'expired' }`、不调 `executePlanAgentRun`、reserve 被退；`dispatchedAt` 非法字符串 → 400；缺省 → 正常。
- 既有 Memory/Prisma 双实现的 admission 行为一致（至少 Memory 全覆盖）。

## 验收

```
npm run typecheck
npm test
```

## 报告

简短中文汇报：`runAdmission` 的事务边界怎么实现的（锁顺序、用没用嵌套事务）、POST 新顺序、删掉了哪些异步预扣代码、两条验收命令的**实际输出**。不要 `git commit`。
