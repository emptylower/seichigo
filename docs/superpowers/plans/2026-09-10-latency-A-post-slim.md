# A 部分：POST 关键路径瘦身

worktree：`/Users/mac/Desktop/seichigo-wt-latency` ／ 分支：`perf/agent-startup-latency`

> 这是「规划 agent 启动延迟」的**第一半**。第二半（分段埋点）在另一份任务书里，**本次不要做**，也不要为它提前改结构。

## 效率要求（重要）

上一次执行这个计划的会话，因为一次性读了十几个文件、context 过大而卡死。这次请：

- **只读下面「必读文件」列出的 3 个文件**，不要读 `lib/planAgent/loop.ts`、`runCost.ts`、`api.ts`、`execute.ts`、内部路由——A 部分完全用不到它们。
- **不要调用 `executing-plans` 之类的技能**，直接干活。
- 不要为了"了解上下文"去 grep 整个仓库。

### 必读文件

1. `app/api/me/plans/[id]/agent/route.ts`（263 行，主战场）
2. `lib/billing/service.ts` 里 `refundStaleReserves` 与 `reserveRun` 两个函数（**只看这两个函数**，不要通读）
3. `tests/api/plan-agent-queue.test.ts`（照抄它的 mock 与断言写法）

## 背景（一句话）

生产实测 POST 返回 202 要 **6.4 秒**，其中 4.8 秒花在 `beginAgentRun` 落定之前。根因是每次 Neon 往返约 0.6 秒（Worker 在东京、库在新加坡且没配 Hyperdrive，每个 isolate 都要重建 Postgres 连接），而这段路径串行做了 6 次左右。

本任务砍掉三次不必要的串行等待，**不动任何并发正确性逻辑**。

## 边界

允许改：`app/api/me/plans/[id]/agent/route.ts`、`lib/billing/service.ts`、相应测试。

**绝不要改**：`lib/planAgent/**`、`app/api/internal/**`、`app/(authed)/**`、`features/map/**`、`prisma/**`、`wrangler.jsonc`、`package.json`、`line-budget.allowlist.json`。

不要跑 prisma 迁移。不要 `git commit`、不要 `git push`、不要切分支。

## 三处改动

### 1. `refundStaleReserves` 挪出关键路径

它是**每请求都跑的孤儿预扣清扫**，清的是**别的 run** 留下的孤儿，与本次请求的正确性无关。

改成用 `ctx.waitUntil` 在响应之后执行。

⚠️ **必须确认拿到的是真实 ExecutionContext**：本项目踩过「没有真正调用 `ctx.waitUntil` 导致任务被静默丢弃」的坑。仓库里已有 `ctx.waitUntil` 的既有用法，跟随它的取用方式。**拿不到 ctx 时回落到原来的同步 `await`**，不要静默跳过——否则孤儿预扣永远不会被退还，用户额度会慢慢漏。

### 2. `getPlan` 与 `getAccount` 并行

两者互不依赖（一个查计划归属、一个查计费账户），现在是串行两次往返。改成 `Promise.all`。

⚠️ 归属校验（`plan.userId !== userId` → 403）与「计划不存在 → 404」的语义**不能变**，仍必须在 `beginAgentRun` 之前完成。只是把两个**读**并行化。

### 3. `reserveRun` 不阻塞 202

`reserveRun` 是抢到 busy 位之后的**无条件预扣**（`force: true`），代码里现在也已经 `.catch()` 吞掉失败继续跑了——它的成败不影响要不要投队列。

挪到 `queue.send` 与返回 202 **之后**，用 `ctx.waitUntil` 执行。`runToken`（预扣的 `runRef`）此时已经拿到，没有顺序依赖。同样地，**拿不到 ctx 时回落原行为**。

## 绝对不要动的东西

- **`beginAgentRun` 的事务与按用户 advisory lock**：并发正确性核心，一个字都不要改。
- **预算预检（`canStartRun` → 402）必须仍在 `beginAgentRun` 之前**。挪到后面会导致超额用户先落库人类消息再被拒。
- **`answerMetaPatch` 的直写仍必须在 `queue.send` 之前**完成（现有注释说明了原因）。
- 内联 SSE 回落路径（队列不可用时）的行为不变。

## 验收

```
npm run typecheck
npm test
```

两个都要过。（`npm run lint` 本仓库没装 eslint、脚本带 `|| true`，无效验收，跳过。）行数预算：单文件 ≤750 行。

测试至少覆盖：

- `refundStaleReserves` 经 `waitUntil` 执行；**拿不到 ctx 时回落为同步 await**（这条最容易漏，必须有）。
- `getPlan`/`getAccount` 并行后，404 / 403 / 402 三种拒绝路径的语义与顺序不变（回归）。
- `reserveRun` 挪到 202 之后仍以正确的 `runRef`（= runToken）入账。
- 队列不可用时的内联 SSE 路径行为不变（回归）。

不要跑 `npm run dev` / `build` / `cf:*` / playwright。

## 报告

简短中文汇报：改了哪些文件、三处各自怎么实现、两条验收命令的**实际输出**。不要 `git commit`。
