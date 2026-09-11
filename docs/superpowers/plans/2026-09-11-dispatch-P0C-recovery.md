# Phase 0-C：恢复推断识别"当前 run 身份"

worktree：`/Users/mac/Desktop/seichigo-wt-dispatch` ／ 分支：`feat/dispatch-phase0`

> 背景：`docs/superpowers/plans/2026-09-11-dispatch-joint-plan-v1.md` §2 不变量 4、§3 故障演练 F3/F5/F6。
> P0-A（claim）与 P0-B（admission/撤销）已在本分支，`getAgentRunState` / `revokeExpiredUnclaimed` 已存在，**不要重做**。

## 要修的隐患（为什么）

`lib/planAgent/resume.ts` 的 `stopIsFinalTail`：最后一条运行日志是 `stopped` 且晚于最后一条 human → 判"用户主动停笔"，`inferInterrupted` 返回 null。但 **resume 回合不追加 human**（`beginAgentRun` content=null）。于是：用户 stop → 手动 resume → 派发丢了（DO/队列都可能）→ busy TTL 过期 → 这条旧 `stopped` 日志仍然把新尝试遮蔽成"主动停笔"，GET 永远不报可恢复，用户卡死。

修法：恢复推断要看**当前 run 的身份**——计划上的 `agentRunToken` / `agentRunStartedAt` / `agentBusyUntil` 与运行日志的 `runToken`。

## 效率要求
- **只读下面列出的文件**，不要读前端（除 3 里指定的 30 行）、不要读 `lib/planAgent/loop.ts`、不要 grep 全仓。
- **不要调用任何技能**。

### 必读文件
1. `lib/planAgent/resume.ts`（全文）
2. `lib/tripPlan/handlers/planById.ts` `:30-80`
3. `app/api/me/plans/[id]/agent/route.ts` 的 `if (resume) { ... canResume ... }` 段（约 `:100-110`）
4. `app/(authed)/plan/[id]/ui.tsx` `:165-195`（只看自动续跑怎么消费 `interrupted`，**不改它**）
5. `lib/tripPlan/repo.ts` 的 `getAgentRunState` 与 `TripPlanRunLogRecord` 类型（确认日志记录带 `runToken`）
6. `tests/planAgent/resume.test.ts`（既有）、`tests/tripPlan/handlers/`（既有 planById 测试）

## 边界
允许改：`lib/planAgent/resume.ts`、`lib/tripPlan/handlers/planById.ts`、POST 路由的 resume 判定那几行、相关测试。
**绝不要改**：`app/(authed)/**`、`lib/billing/**`、`lib/planAgent/loop.ts`、`lib/planAgent/runAdmission.ts`、`prisma/**`、`worker/**`、`wrangler.jsonc`。
不要 `git commit` / `push`；不要跑 `dev` / `build` / `cf:*` / playwright / prisma。

## 改什么

### 1. `resume.ts`：给推断加"当前 run"输入

```ts
export type CurrentRunState = { token: string; busyUntil: Date | null; startedAt: Date | null } | null

export function inferInterrupted(messages, runLogs, current?: CurrentRunState): InterruptedInference | null
export function canResume(messages, runLogs, current?: CurrentRunState): boolean
```
规则（按顺序）：
1. **`stopIsFinalTail` 只在"没有更新的尝试"时成立**：若 `current` 非空且 `current.token !== lastStoppedLog.runToken`（stopped 之后又 `beginAgentRun` 了新 token）→ 不算主动停笔，继续往下推断。`current` 缺省（旧调用方）→ 行为与今天逐字相同。
2. **新增 reason `'unclaimed'`**（加进 `InterruptedReason` 联合）：`current` 非空、`current.startedAt === null`、`current.busyUntil` 已过期、且 `runLogs` 里**没有** `runToken === current.token` 的记录 → 这次尝试从未被任何执行者领取（派发丢失）。`at` 用 `current.busyUntil`，`turnIndex` 沿用既有算法。它的优先级排在既有 `run_log` 之前——因为它是关于**当前** token 的直接证据。
3. 既有三条（run_log / missing_run_log / dangling）不动。
4. `canResume` 与 `inferInterrupted` 共用同一套判断（今天就是这么设计的，保持）。

### 2. `planById.ts`
`!agentBusy` 分支里取 `current = await deps.repo.getAgentRunState(planId)`（多 1 次往返，只在非 busy 时），传给 `inferInterrupted`。`stopped` 标志的计算也要用同一规则：最后 stopped 日志的 token 与 current.token 不同则 `stopped=false`。

### 3. POST resume 判定
`canResume(messages, runLogs, await deps.repo.getAgentRunState(id))`。

### 4. 前端
`ui.tsx` 的自动续跑只看 `interrupted` 是否非空，不区分 reason（你读 `:165-195` 确认；若它**区分** reason 白名单，把发现写进报告，**不要改前端**，由另一位负责）。

## 测试（F3 / F5 / F6 单测层，`tests/planAgent/resume.test.ts` 扩展 + planById 测试）
- stopped 尾日志 + `current.token` 与该日志 token **相同** → null（今天的行为）。
- stopped 尾日志 + `current.token` **不同**、startedAt null、busy 过期、无该 token 日志 → `reason:'unclaimed'`。
- stopped 尾日志 + `current.token` 不同、已 claim（startedAt 非空）、无该 token 日志 → 走既有规则（resume 无 human 时最可能是 `dangling`/null；把实际结果作为回归快照记下来，**不要为了好看改规则**）。
- `current` 缺省 → 所有既有用例逐字不变（回归）。
- `planById`：非 busy + unclaimed 过期 → `interrupted.reason === 'unclaimed'`，`stopped === false`。
- busy 中（TTL 未过）→ `interrupted` 仍为 null（不变）。

## 验收
```
npm run typecheck
npm test
```

## 报告
简短中文汇报：规则改动点、`'unclaimed'` 的判定条件、前端是否区分 reason（只报告）、两条验收命令的**实际输出**。不要 `git commit`。
