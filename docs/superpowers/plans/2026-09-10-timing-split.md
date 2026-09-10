# 把剩下两段未知拆开：队列段与「status→首字节」段

worktree：`/Users/mac/Desktop/seichigo-wt-timing` ／ 分支：`perf/timing-split`

> 零行为改动，只加两刀埋点。**不要顺手做任何性能优化**——本批的全部价值在于把数据拆准，优化是下一批的事。

## 效率要求

**只读下面列出的 4 个文件**，不要读 `app/api/me/plans/[id]/agent/route.ts`、不要读 `lib/billing/**`、不要读前端。**不要调用 `executing-plans` 之类的技能**，直接干活。

### 必读文件

1. `lib/planAgent/runTimings.ts`（113 行，上一批刚建的埋点收集器）
2. `worker/planAgentConsumer.ts`（约 95 行）
3. `app/api/internal/plan-agent/run/route.ts`
4. `lib/planAgent/loop.ts` 的 **430–460 行**（首次模型调用附近）——不要通读

## 背景：现有埋点还剩两段是黑盒

上一批的埋点已在生产落库，实测 3 个样本：

| 段 | 均值 | 状态 |
|---|---|---|
| `queueLatencyMs`（enqueuedAt → 内部路由入口） | 5137ms | ⚠️ **混合段**，里面至少有三样东西 |
| `loopStartMs`（内部路由入口 → runPlanAgent 入口） | 2234ms | 已知，是内部路由的 DB 前奏 |
| loop 入口 → 首条 status | 379ms | 已知 |
| 首条 status → 首个模型字节 | 4364ms | ⚠️ **混合段**，不是纯模型 TTFT |

**第一段混了什么**：Cloudflare Queue 派发 + 消费者 isolate 冷启动 + 服务绑定跳 + OpenNext 动态 import Next server chunk。不拆开就无法判断「换执行宿主」这类大改动值不值得。

**第二段混了什么**：`lib/planAgent/loop.ts` 里首条 status（264 行 `emitStartup('readHistory')`）到首次模型调用（444 行 `deps.createMessage`）之间串着 `listMessages`、`getPlan`（days→items→point→i18n 四层嵌套 join）、`updateStage`。真实模型 TTFT 到底占多少，目前完全未知。

## 边界

允许改：`worker/planAgentConsumer.ts`、`app/api/internal/plan-agent/run/route.ts`、`lib/planAgent/runTimings.ts`、`lib/planAgent/loop.ts`、`lib/planAgent/execute.ts`、`lib/planAgent/runCost.ts`、相应测试。

**绝不要改**：`app/api/me/plans/[id]/agent/route.ts`、`app/(authed)/**`、`lib/billing/**`、`lib/db/prisma.ts`、`features/map/**`、`prisma/schema.prisma`、`wrangler.jsonc`、`package.json`、`line-budget.allowlist.json`。

**不要新增数据库列、不要跑 prisma 迁移**（沿用 `modelUsage.timings`）。
**不要做任何性能优化**——本批只加观测。

不要 `git commit`、不要 `git push`、不要切分支。

## 第一刀：拆开队列段

### 1.1 消费者侧打时间戳

`worker/planAgentConsumer.ts` 的 for 循环里、`env.WORKER_SELF_REFERENCE.fetch(...)` **之前**取 `Date.now()`，作为请求头 `x-plan-agent-consumer-at` 传给内部路由。

⚠️ **该文件必须继续只 import `queueMessage.ts`**（文件头注释说明了原因：不能把 Prisma/Next 打包进 worker 入口）。加时间戳与请求头不需要任何新依赖。

### 1.2 加 invocation 序号（关键，不能省）

同文件模块顶层加 `let INVOCATION_SEQ = 0`，每次 `queue()` handler 进入时 `++INVOCATION_SEQ`，一并放进请求头 `x-plan-agent-consumer-seq`。

⚠️ **为什么必须要它**：workerd 的 `Date.now()` 在无 I/O 期间是**冻结的**（官方 security-model 文档：`Date.now()` returns the time of the last I/O，代码执行期间不推进）。所以**时间戳测不出 isolate 冷启动**。`seq === 1` 表示这次 invocation 跑过全局作用域（即冷 isolate），用它把样本切成冷/热两组，才是区分「队列派发慢」与「消费者冷启动慢」的唯一可靠办法。

### 1.3 内部路由消费这两个头

`app/api/internal/plan-agent/run/route.ts` 读这两个头，算出并记入 timings：

```
consumerBatchAt?: string      // 消费者取的时刻
consumerSeq?: number          // invocation 序号（1 = 冷 isolate）
queueDispatchMs?: number      // consumerBatchAt - enqueuedAt   ← 纯队列派发
selfRefHopMs?: number         // consumerEnteredAt - consumerBatchAt ← 服务绑定跳 + OpenNext 动态 import
```

现有的 `queueLatencyMs` **保留不动**（= queueDispatchMs + selfRefHopMs，用于与历史数据对比）。

头缺失时（旧版消费者的在途消息、或本地/SSE 路径）这四个字段**整体省略**，不写 0/NaN。这条必须有测试。

同时把这四个字段并进已有的 `[planAgent/timing]` 结构化日志行。

## 第二刀：拆开「status → 首字节」段

`lib/planAgent/runTimings.ts` 的收集器加 `markModelRequestSent()`（幂等，只记第一次），在 `lib/planAgent/loop.ts` **首次 `deps.createMessage(...)` 调用之前**调用。产出：

```
modelRequestSentAt?: string
toModelRequestMs?: number     // modelRequestSentAt - consumerEnteredAt
realModelTtftMs?: number      // firstModelByteAt - modelRequestSentAt  ← 真实模型 TTFT
```

⚠️ 注意 loop 有重试与多轮循环（`createMessage` 会被调用多次），`markModelRequestSent` 只记**第一次**，与现有 `markStatus`/`markModelByte` 的幂等语义保持一致。

## 验收

```
npm run typecheck
npm test
```

两个都要过。（`npm run lint` 本仓库没装 eslint、脚本带 `|| true`，无效验收，跳过。）

行数预算单文件 ≤750。`lib/planAgent/loop.ts` 目前 727 行，余量不多——超了就继续往 `runTimings.ts` 或新文件拆，不要动 allowlist。

测试至少覆盖：

- 两个请求头都在时，`queueDispatchMs` / `selfRefHopMs` / `consumerSeq` 计算正确，且 `queueDispatchMs + selfRefHopMs === queueLatencyMs`。
- **请求头缺失时四个字段整体省略、不炸**（旧消费者在途消息 + SSE 内联路径两种情况都要覆盖）。
- `realModelTtftMs` 用假时钟算得正确；**loop 多轮调用 createMessage 时只记第一次**。
- `modelUsage` 既有字段（含上一批的 `timings` 既有键）语义不变（回归）。
- 消费者文件仍然只 import `queueMessage.ts`（可用一个 import 断言或注释说明，不必强测）。

不要跑 `npm run dev` / `build` / `cf:*` / playwright。

## 报告

简短中文汇报：改了哪些文件、两刀各自怎么实现、`loop.ts` 最终行数、两条验收命令的**实际输出**。不要 `git commit`。
