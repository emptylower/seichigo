# B 部分：启动链路分段埋点

worktree：`/Users/mac/Desktop/seichigo-wt-latency` ／ 分支：`perf/agent-startup-latency`

> A 部分（POST 瘦身，改的是 `app/api/me/plans/[id]/agent/route.ts`）已完成并验收通过，**不要重做也不要改它**。本份只做埋点。

## 效率要求（重要）

上一次把 A、B 放在一起执行的会话，因为一次性读了十几个文件、context 过大而卡死。这次请：

- **只读下面「必读文件」列出的 5 个文件**，不要读 `app/api/me/plans/[id]/agent/route.ts`（A 部分已改完，本次不碰）、不要读 `lib/billing/**`、不要读 `lib/planAgent/api.ts`。
- **不要调用 `executing-plans` 之类的技能**，直接干活。
- 不要为了"了解上下文"去 grep 整个仓库。

### 必读文件

1. `lib/planAgent/queueMessage.ts`（很短，`enqueuedAt` 已经在里面）
2. `app/api/internal/plan-agent/run/route.ts`（128 行）
3. `lib/planAgent/execute.ts`（约 120 行）
4. `lib/planAgent/runCost.ts`（139 行，`summarizeRunCost` 的输出要加字段）
5. `lib/planAgent/loop.ts` 的**前 120 行**（`runPlanAgent` 函数开头，埋点插在这里）——不要通读全文件

## 背景：要量什么

生产实测（相对用户点击发送的时刻）：

| 区间 | 耗时 |
|---|---|
| POST 返回 202 | 6.4s |
| **→ 首个 status 落库** | **+15.0s** ← 要拆开的就是这一段 |
| → 首个模型文字 | +10.6s（模型 TTFT，不管） |

那 15 秒里至少有三样东西：CF Queue 投递延迟、消费者 isolate 冷启动 + 自引用 fetch、内部路由自己的开销（Next isolate + 四次数据库往返）。**目前只能靠减法估算，没有实测。** 本任务提供实测，用于决定要不要动队列架构。

## 边界

允许改：`lib/planAgent/queueMessage.ts`、`app/api/internal/plan-agent/run/route.ts`、`lib/planAgent/execute.ts`、`lib/planAgent/runCost.ts`、`lib/planAgent/loop.ts`、新建文件、相应测试。

**绝不要改**：`app/api/me/plans/[id]/agent/route.ts`（A 部分成果）、`app/(authed)/**`、`lib/billing/**`、`features/map/**`、`prisma/schema.prisma`、`wrangler.jsonc`、`package.json`、`line-budget.allowlist.json`。

**绝对不要新增数据库列、不要跑任何 prisma 迁移。**

不要 `git commit`、不要 `git push`、不要切分支。

## 要做的事

### 1. 埋点数据落在哪

写进 `TripPlanRunLog.modelUsage` 这个**既有** Json 列，加一个 `timings` 顶层键：

```
timings?: {
  enqueuedAt?: string          // ISO，队列消息里已有；SSE 内联路径没有
  consumerEnteredAt: string    // 内部路由收到请求的时刻
  loopStartedAt: string        // runPlanAgent 进入的时刻
  firstStatusAt?: string       // 首条 status 事件发出的时刻
  firstModelByteAt?: string    // 首个模型 delta 到达的时刻
  queueLatencyMs?: number      // consumerEnteredAt - enqueuedAt ← 本任务最想要的数
  loopStartMs: number          // loopStartedAt - consumerEnteredAt
  toFirstStatusMs?: number     // firstStatusAt - consumerEnteredAt
  toFirstModelByteMs?: number  // firstModelByteAt - consumerEnteredAt
}
```

⚠️ **`modelUsage` 既有字段语义一个都不能改**（`tokens`/`models`/`calls`/`costMicros`/`usageMissing`/`priceTableVersion`/`priceFallbackModels`/`pricingWindows`）——历史日志还要能读。只加 `timings` 这一个新键，**整体可选**。

⚠️ **SSE 内联路径没有 `enqueuedAt`**（那条路径不经队列），此时 `queueLatencyMs` 与 `enqueuedAt` 都省略，**不要炸、不要写 NaN、不要写 0**。这条必须有测试。

### 2. 同时打一条结构化日志

在内部路由入口 `console.log` 一条带稳定前缀的行（`[planAgent/timing]` 开头 + JSON），这样 `wrangler tail` 能实时看，不必等 run 结束落库。

### 3. 实现路径

- `enqueuedAt` 在 `queueMessage.ts` 的消息类型里**已经有了**，直接用，不要重新加。
- 内部路由在入口记 `consumerEnteredAt`、算 `queueLatencyMs`，往下传给 `executePlanAgentRun`。
- `executePlanAgentRun` 加一个**可选**入参承载这些时刻，往下传给 `runPlanAgent`。
- `loop.ts` 在 `runPlanAgent` 开头记 `loopStartedAt`；记首条 status 与首个模型 delta 的时刻。注意首条 status 现在由 `startupStatus.ts` 的发送器发出，`firstStatusAt` 要能覆盖到它（也就是埋点的 hook 要在 emit 链路上，不要只盯工具调用的 status）。
- `runCost.ts` 的 `summarizeRunCost` 输出里带上 `timings`。

时钟要可注入（`now?: () => number`），否则埋点逻辑没法写测试。

### 4. 行数预算

`lib/planAgent/loop.ts` 目前贴着 750 行上限，改动几乎必然超——把埋点收集抽成新文件（例如 `lib/planAgent/runTimings.ts`）。**不要**动 `line-budget.allowlist.json`。

## 验收

```
npm run typecheck
npm test
```

两个都要过。（`npm run lint` 本仓库没装 eslint、脚本带 `|| true`，无效验收，跳过。）

测试至少覆盖：

- `timings` 各字段用假时钟算得正确。
- **SSE 内联路径（无 `enqueuedAt`）时不炸，`queueLatencyMs`/`enqueuedAt` 省略**（这条最容易漏）。
- `firstStatusAt` 能覆盖到 `startupStatus` 发出的首条 status（不是只覆盖工具调用的 status）。
- `modelUsage` 既有字段语义不变（回归）。
- A 部分的 `tests/api/plan-agent-queue.test.ts` 12 个用例仍全过（回归，不要改它们）。

不要跑 `npm run dev` / `build` / `cf:*` / playwright。不要跑 prisma 迁移。

## 报告

简短中文汇报：改了哪些文件、`loop.ts` 行数怎么解决的、两条验收命令的**实际输出**。不要 `git commit`。
