# 规划 agent 启动延迟：POST 关键路径瘦身 + 分段埋点

日期：2026-09-10 ／ worktree：`/Users/mac/Desktop/seichigo-wt-latency` ／ 分支：`perf/agent-startup-latency`

## 1. 背景：生产实测数据

今天在生产上分段计时（相对用户点击发送的时刻）：

| 区间 | 耗时 | 内容 |
|---|---|---|
| 0 → 4.8s | 4.8s | POST 前半段，busy 位在此落定 |
| 4.8 → 6.4s | 1.6s | `reserveRun` + `queue.send` → 返回 202 |
| 6.4 → 21.3s | **15.0s** | 队列投递 + 消费者 + 自引用 + 内部路由 → 首个 status 落库 |
| 21.3 → 31.9s | 10.6s | 首次模型调用 TTFT（模型本身慢，本任务不管） |

**根因是数据库往返太贵。** 实测每次 Neon 往返约 **0.6 秒**（连测 5 次 `/api/me/plans/:id` 稳定 3.1s，减掉 0.42s 的 isolate 基线，除以约 4-5 次往返）。原因：Neon 在 `ap-southeast-1`（新加坡），Worker 在 NRT（东京），而且**没有配 Hyperdrive**，每个 isolate 都要重新建 Postgres 连接。

启动路径上要做十次左右这样的往返，所以每一段都被放大。

本任务做两件确定收益、零架构风险的事。**不动队列架构**（那 15 秒里约 11 秒是减法推出来的队列开销，需要先有埋点数据才能决定动不动它——这正是本任务第二部分要提供的）。

## 2. 边界

允许改：
- `app/api/me/plans/[id]/agent/route.ts`
- `app/api/internal/plan-agent/run/route.ts`
- `lib/planAgent/execute.ts`、`lib/planAgent/loop.ts`、`lib/planAgent/runCost.ts`、`lib/planAgent/queueMessage.ts`
- `lib/billing/service.ts`（仅为把清扫作业挪出关键路径）
- 相应测试

**绝不要改**：`app/(authed)/**`（另一个 agent 稍后会改 `useSmoothText.ts`，文件不重叠但仍别碰）、`features/map/**`、`prisma/schema.prisma`、`wrangler.jsonc`、`package.json`、`line-budget.allowlist.json`。

**绝对不要跑任何 prisma 迁移命令**，也不要新增数据库列——埋点数据写进现有的 Json 列（见 §4）。

不要 `git commit`、不要 `git push`、不要切分支。

## 3. 第一部分：POST 关键路径瘦身

位置：`app/api/me/plans/[id]/agent/route.ts`（第 100 行起那段）。

现在的串行顺序是：`getSession` → `getPlan` → `refundStaleReserves` → `getAccount` → `beginAgentRun` → `reserveRun` → `updateMetaIfActive`(可选) → `queue.send` → 202。

三处确定的省法，每处约省 0.6 秒：

### 3.1 `refundStaleReserves` 挪出关键路径

它是**每请求都跑的孤儿预扣清扫作业**，与本次请求的正确性无关（清的是别的 run 留下的孤儿）。

改成用 `ctx.waitUntil` 在响应之后跑。⚠️ 注意：`waitUntil` 必须通过 `getCfBindings()` 拿到的 ctx 调用（仓库里有 `ctx.waitUntil` 的既有用法，跟随它；这个项目踩过"没有真正调用 ctx.waitUntil 导致任务被丢弃"的坑，务必确认拿到的是真实的 ExecutionContext）。拿不到 ctx 时**回落到原来的行为**（同步 await），不要静默跳过。

### 3.2 `getPlan` 与 `getAccount` 并行

两者互不依赖（一个查计划归属，一个查计费账户），现在是串行。改成 `Promise.all`。

⚠️ 归属校验（`plan.userId !== userId` → 403）的语义不能变：仍然要在 `beginAgentRun` 之前完成校验，只是把两个**读**并行化。

### 3.3 `reserveRun` 不阻塞 202

`reserveRun` 是抢到 busy 位之后的**无条件预扣**（`force: true`），它的结果不影响要不要投队列——代码里现在也已经 `.catch()` 吞掉失败继续跑了。

把它挪到 `queue.send` 与 202 之后，用 `ctx.waitUntil` 执行。⚠️ 前提：`runToken` 已经拿到（预扣的 `runRef` 就是它），所以顺序上没有依赖问题。同样地，拿不到 ctx 时回落到原行为。

### 3.4 不要动的东西

- `beginAgentRun` 的事务与按用户 advisory lock：这是并发正确性的核心，**一个字都不要改**。
- 预算预检（`canStartRun` → 402）必须仍在 `beginAgentRun` **之前**，不能挪到后面——否则超额用户的请求会先落库人类消息再被拒。
- `answerMetaPatch` 的直写仍必须在 `queue.send` **之前**完成（现有注释说明了原因）。

## 4. 第二部分：分段埋点

目标：把上面那 15 秒拆开，直接量出「队列投递」到底占多少，为后续决定是否改队列架构提供依据。

### 4.1 数据落在哪

**不新增数据库列**（不许迁移）。把埋点写进 `TripPlanRunLog.modelUsage` 这个既有 Json 列，加一个 `timings` 顶层键：

```
timings: {
  enqueuedAt: string          // ISO，队列消息里已有
  consumerEnteredAt: string   // 内部路由收到请求的时刻
  loopStartedAt: string       // runPlanAgent 进入的时刻
  firstStatusAt: string       // 首条 status 事件发出的时刻
  firstModelByteAt: string    // 首个模型 delta 到达的时刻
  queueLatencyMs: number      // consumerEnteredAt - enqueuedAt ← 本任务最想要的数
  loopStartMs: number         // loopStartedAt - consumerEnteredAt
  toFirstStatusMs: number     // firstStatusAt - consumerEnteredAt
  toFirstModelByteMs: number  // firstModelByteAt - consumerEnteredAt
}
```

⚠️ `modelUsage` 的**既有字段语义一个都不能改**（`tokens`/`models`/`calls`/`costMicros`/`usageMissing`/`priceTableVersion`/`priceFallbackModels`/`pricingWindows`），历史日志还要能读。只加 `timings` 这一个新键，且它必须是**可选**的——SSE 内联路径没有 `enqueuedAt`，那种情况下 `queueLatencyMs` 省略。

### 4.2 同时打一条结构化日志

除了写库，在内部路由入口 `console.log` 一条带稳定前缀的结构化行（例如 `[planAgent/timing]` 开头，后面跟 JSON），这样用 `wrangler tail` 也能实时看，不必等 run 结束落库。

### 4.3 实现要点

- `enqueuedAt` 在 `lib/planAgent/queueMessage.ts` 的消息类型里**已经有了**，直接用。
- 内部路由（`app/api/internal/plan-agent/run/route.ts`）在入口记 `consumerEnteredAt`，算出 `queueLatencyMs`，往下传给 `executePlanAgentRun`。
- `executePlanAgentRun` 加一个可选入参承载这些时刻，往下传给 `runPlanAgent`。
- `loop.ts` 记 `loopStartedAt`、首条 status 与首个模型 delta 的时刻。注意首条 status 现在由 `startupStatus.ts` 的发送器发出，`firstStatusAt` 要能覆盖到它。
- `runCost.ts` 的 `summarizeRunCost` 输出里带上 `timings`。
- POST 路由自己也 `console.log` 一条从请求进入到返回 202 的耗时（同样的 `[planAgent/timing]` 前缀），这样 POST 那 6.4 秒也能持续观察。

时钟要可注入（`now?: () => number`），否则埋点逻辑没法写测试。

## 5. 验收

```
npm run typecheck
npm test
```

两个都要过。（`npm run lint` 本仓库没装 eslint、脚本带 `|| true`，是无效验收，跳过。）

`npm test` 第一步是行数预算：**单文件不得超过 750 行**。`lib/planAgent/loop.ts` 目前 742 行，**已经贴着上限**，你的改动几乎必然超——要拆文件（例如把埋点收集抽成 `lib/planAgent/runTimings.ts`），**不要**动 `line-budget.allowlist.json`。

测试至少覆盖：

- `refundStaleReserves` 经 waitUntil 执行；**拿不到 ctx 时回落为同步 await**（这条容易漏）。
- `getPlan`/`getAccount` 并行后，归属校验与 402 预检的顺序语义不变（回归）。
- `reserveRun` 挪到 202 之后仍以正确的 `runRef`（= runToken）入账。
- `timings` 各字段计算正确（用假时钟）；**SSE 内联路径没有 `enqueuedAt` 时不炸、`queueLatencyMs` 省略**。
- `modelUsage` 既有字段语义不变（回归）。

仓库有内存版 repo（`lib/tripPlan/repoMemory.ts`）可用于测试，不需要真实数据库。

不要跑 `npm run dev` / `build` / `cf:*` / playwright。不要跑 prisma 迁移。

## 6. 报告

简短中文汇报：改了哪些文件、`loop.ts` 行数怎么解决的、三处瘦身与埋点各自怎么实现、两条验收命令的**实际输出**、有没有需要人工确认的取舍。不要 `git commit`。
