# 按真实成本计费：价格表修正 + 价格数据化 + 时段定价

日期：2026-09-10 ／ worktree：`/Users/mac/Desktop/seichigo-wt-pricing` ／ 分支：`feat/dynamic-model-pricing`

## 1. 背景：现在扣错了多少

计费机制本身是对的——run 开始按档位固定预扣，结束用 `settleRun({ actualMicros })` 按真实 token 数冲销。**问题全在价格表。**

`lib/billing/priceTable.ts` 的 `MODEL_PRICES` 是 2026-09-06 手抄的硬编码常量，里面三个条目（`deepseek-v4-flash` / `deepseek-chat` / `deepseek-reasoner`）在当前 DeepSeek 账号的 `/models` 里**一个都不存在**。实际在用的 `deepseek-flash` 不在表里，于是走 `default` 兜底价。

真实牌价对比（每百万 token）：

| | 当前收（default） | 实际 peak | 实际 off-peak |
|---|---|---|---|
| input 未命中 | $0.28 | $0.30 | $0.15 |
| input 命中缓存 | $0.028 | **$0.006** | **$0.003** |
| output | $0.42 | **$1.20** | **$0.60** |

两个大头方向相反：**output 少收 2.9 倍，缓存命中多收 4.7 倍**。

用一次真实 run 实测（inputMiss 31,657 / inputCacheHit 158,592 / output 26,256）：

- 我们扣了 **24,832** 微美元
- 真实成本 peak ≈ **42,456**（少收 41%，每次贴 1.7 万微美元）
- 真实成本 off-peak ≈ **21,478**（多收 16%）

DeepSeek 的 peak 时段是 **01:00–04:00 与 06:00–10:00 UTC，周一至周五**，换算北京时间是工作日 09:00–12:00 与 14:00–18:00 —— 正好覆盖中文用户主要活跃时段，所以少收的那一档占了大部分真实流量。

## 2. 边界

同一仓库有别的会话在别的 worktree 干活。

允许改：`lib/billing/**`、`lib/planAgent/runCost.ts`、`lib/llm/types.ts`、`lib/llm/registry.ts`、`lib/llm/handlers/**`（仅为透传价格字段）、相应测试。

**绝不要改**：`app/(authed)/**`、`features/map/**`、`app/api/anitabi/**`、`workers/**`、`prisma/schema.prisma` 的非 LlmProvider 部分、`wrangler.jsonc`、`package.json`、`line-budget.allowlist.json`。

不要 `git commit`、不要 `git push`、不要切分支、不要跑 prisma 迁移命令。

## 3. P0：价格表止血

### 3.1 补齐真实价格

`MODEL_PRICES` 用 **peak 价**填（宁可略保守，off-peak 的差价留作毛利缓冲，这是产品决定）。单位是微美元每百万 token（$1 = 1,000,000 微美元）：

```
deepseek-flash    : inputMissPerM 300_000,   inputCacheHitPerM 6_000,   outputPerM 1_200_000
deepseek-v4-pro   : inputMissPerM 1_320_000, inputCacheHitPerM 44_000,  outputPerM 3_960_000
```

`default` 兜底价改成**已知模型里最贵的那档**（即 `deepseek-v4-pro` 的 peak 价）——未知模型宁可多收也绝不能贴钱；配错了会被 3.2 的告警立刻暴露。

表里那三个不存在的旧条目（`deepseek-v4-flash`/`deepseek-chat`/`deepseek-reasoner`）删掉，别留着误导。

`PRICE_TABLE_VERSION` 改成 `'2026-09-10'`（run log 用它标记计价口径，必须跟着改）。

加一条注释记录：**2026-09-14 起 `deepseek-v4-pro` 的请求会被路由到 V4.1 Flash 并按 Flash 价计费**（V4 Pro 退役期）。本次不实现自动切换，但要留痕，否则那天之后用 v4-pro 会按 3.3 倍多收。

### 3.2 兜底计价告警

`RunCostSummary.priceFallbackModels` 这个埋点已经存在，但没有任何地方消费它。改成：非空时上报（仓库已接入 Sentry，见 `sentry.server.config.ts` / `instrumentation.ts`；用 `captureMessage` 之类的既有手法，跟随仓库现有风格）+ `console.warn`。

含义是「有模型在按兜底价计费」，属于配置错误，必须可见。

## 4. P1：价格从代码挪进数据

`lib/llm/types.ts` 的 `LlmModelConfig` 现在只有 `{ name, contextLength, maxOutputTokens? }`，加三个**可选**价格字段（沿用微美元每百万 token 口径）：

```ts
inputMissPerM?: number | null
inputCacheHitPerM?: number | null
outputPerM?: number | null
```

它存在 `LlmProvider.models` 这个 Json 列里，**不需要 prisma 迁移**。

**价格解析优先级**（新建一个 `lib/billing/priceResolver.ts` 之类的模块承载，别塞进 `cost.ts`）：

1. 当前生效的 DB provider（`resolveLlmForScope('agent')` 返回的那个）里该模型的价格字段——三个字段齐全才算命中，缺任一个视为未配置
2. `MODEL_PRICES[model]`
3. `MODEL_PRICES.default` + 记入 `priceFallbackModels`

⚠️ 注意 `lib/llm/registry.ts` 有缓存（`CacheEntry`）。价格改了之后不能等缓存自然过期才生效——确认缓存失效路径能覆盖到价格变更（管理面板保存 provider 时应当已有清缓存动作，跟随现有实现即可）。

## 5. P2：时段定价（本批最需要小心的部分）

### 5.1 时段定义

```
peak   = UTC 周一至周五的 01:00–04:00 与 06:00–10:00
off-peak = 其余全部时间（含周末全天）
off-peak 价 = peak 价的一半
```

判定必须用 **UTC 的星期与小时**，不要用本地时区。边界按左闭右开处理（01:00:00 算 peak，04:00:00 算 off-peak），并为四个边界各写一个测试。

价格结构建议扩成 `{ peak: ModelPrice; offPeakMultiplier: number }` 或 `{ peak: ModelPrice; offPeak: ModelPrice }`——你选一个更好写测试的，但**必须让"半价"这个关系显式可读**，不要散落成魔数。

### 5.2 计价点必须从 run 结束挪到每次模型调用

**这一条是 P2 的核心，不做的话时段定价是假的。**

现在 `lib/planAgent/runCost.ts` 的 `recordModelCall` 只累加 token 到 `usageByModel: Map<string, LlmUsage>`，然后 `summarizeRunCost` 在 run 结束时把整个 run 的累计 token 乘以单价算一次。

而一个 run 最长能跑 13 分钟（软截止），完全可能跨过 04:00 或 10:00 UTC 的边界——那样整段会按同一个价算，peak/off-peak 差一倍。

改法：`recordModelCall` 时就用**当时的时刻**定价，累加 `costMicros`；token 仍然照常累加（run log 要用）。`summarizeRunCost` 的 `costMicros.model` 变成「每次调用成本之和」。

时钟要可注入（`now?: () => number`），否则时段逻辑没法测。

### 5.3 兼容性

`TripPlanRunLog.modelUsage` 的 JSON 形状**只能加字段不能改已有字段**——历史日志还要能读。`tokens` / `models` / `calls` / `costMicros` / `usageMissing` / `priceTableVersion` / `priceFallbackModels` 全部保留原语义。

建议新增（可选）：每次调用的计价时段分布，便于事后对账（例如 `pricingWindows: { peak: number; offPeak: number }` 记两个时段各自的调用次数）。

`TITLE_OVERHEAD_MICROS` 是个 500 的固定摊销值，本批保持不变，但加注释说明它没有走时段定价。

## 6. 验收

worktree 根目录（`node_modules` 已装好）：

```
npm run typecheck
npm test
```

两个都要过。（`npm run lint` 本仓库没装 eslint 二进制、脚本带 `|| true`，跑了永远 exit 0，是**无效验收**，可跳过。）

`npm test` 第一步是行数预算：**单文件不得超过 750 行**，超了拆文件，不要动 `line-budget.allowlist.json`。

测试至少覆盖：

- **P0**：`deepseek-flash` 命中表价而非 default；未知模型进 `priceFallbackModels` 并触发告警；`default` 是最贵档。
- **P1**：DB provider 的价格覆盖 env 表；三字段缺一即视为未配置、回落表价。
- **P2**：peak/off-peak 四个边界时刻；周末全天 off-peak；**同一个 run 跨边界时，跨界前后的调用各自按各自时段计价**（这条是本批的核心，必须有）。
- **回归**：`modelUsage` 的既有字段语义不变；`usageMissing` 行为不变。

用注入的假时钟驱动时段测试，不要依赖真实系统时间。

不要跑 `npm run dev` / `npm run build` / `npm run cf:*` / playwright。

## 7. 报告

简短中文汇报：改了哪些文件、P0/P1/P2 各自怎么实现、两条验收命令的**实际输出**、有没有需要人工确认的取舍。不要 `git commit`。
