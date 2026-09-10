# 价格表补全：覆盖生产实际在用的全部模型名

worktree：`/Users/mac/Desktop/seichigo-wt-pricing` ／ 分支：`feat/dynamic-model-pricing`

> P0/P1/P2 已完成并验收通过。这份只改 `MODEL_PRICES` 的条目与 `default` 取值，**不要动 P1/P2 的任何机制**（价格解析优先级、时段判定、逐次计价、告警）。

## 效率要求

**只读 2 个文件**：`lib/billing/priceTable.ts`、`tests/billing/priceResolver.test.ts`（看现有测试写法）。不要读别的，不要调用技能。

## 为什么要改

上一批把 `default` 定成了「已知最贵档」（v4-pro peak）。查了生产库之后发现这是错的：

生产的 agent 实际走管理面板 DB provider，模型名是 **`deepseek-v4.1-flash-expires-on-0910`** —— 这个名字不在表里，会命中 `default`。按最贵档兜底的话，用户额度消耗会瞬间涨到约 4.4 倍（input miss）和 3.3 倍（output）。

而且查证后确认：**当前所有在用的 DeepSeek 模型最终都按 Flash 价计费**，所以 Flash 价作为兜底不只是更安全，对绝大多数情况就是准确的。

## 要改的内容

### 1. 两档基准价（peak；off-peak 为其一半，沿用现有 `halfPrice()` 机制）

```
FLASH: inputMissPerM 300_000, inputCacheHitPerM 6_000, outputPerM 1_200_000
PRO  : inputMissPerM 1_320_000, inputCacheHitPerM 44_000, outputPerM 3_960_000
```

把这两档提成具名常量（如 `DEEPSEEK_FLASH` / `DEEPSEEK_PRO`），条目引用常量，不要把数字抄五遍。

### 2. 条目

| 模型 id | 用哪档 | 必须写进注释的理由 |
|---|---|---|
| `deepseek-flash` | FLASH | 当前正式名 |
| `deepseek-v4-flash` | FLASH | 旧名已退役，请求由 V4.1-Flash 承接并**按 Flash 价计费**（官方说明） |
| `deepseek-v4-flash-vision-exp` | FLASH | 同上 |
| `deepseek-v4.1-flash-expires-on-0910` | FLASH | **生产 agent 当前在用的模型**（DB provider `DeepSeek（环境变量）`，takeoverAgent=true） |
| `deepseek-v4-pro` | PRO | ⚠️ 见下方 3 |
| `default` | **FLASH** | 兜底改成 Flash peak，不再是最贵档 |

### 3. v4-pro 的日期转换（只写注释，不实现自动切换）

官方说明：**2026-09-14 12:00 北京时间（= 04:00 UTC）起，`deepseek-v4-pro` 的请求会被路由到 V4.1 Flash 并按 Flash 价计费**，直到 V4.1 Pro 发布。

在 `deepseek-v4-pro` 条目上方写一条醒目注释，带上这个日期与含义。**不要实现按日期自动切档**——维护者会在那天手动改表（这是产品决定）。

### 4. 版本号

`PRICE_TABLE_VERSION` 保持 `'2026-09-10'`（同一天内的修订，不用再改）。但把表头注释更新成：价格于 2026-09-10 核对自 DeepSeek 官方定价页，并列出核对到的两档基准价。

### 5. 未覆盖的模型要说清楚

生产库里还有别的 provider（Gemini `gemini-3.8-flash` / `gemini-3.8-flash-high`、freecode 的 `gpt-5.6-*`），它们 `takeoverAgent=false`，不参与规划 agent 计费，**本次不填价格**。在表头注释里写明这一点，免得后来者以为是漏了。

## 不要动的东西

`lib/billing/priceResolver.ts` 的时段判定与解析优先级、`lib/planAgent/runCost.ts` 的逐次计价、`lib/billing/cost.ts` 的告警——全部保持现状。本批只改价格数据。

## 验收

```
npm run typecheck
npm test
```

两个都要过。（`npm run lint` 本仓库没装 eslint、脚本带 `|| true`，无效验收，跳过。）

更新/新增测试，至少覆盖：

- `deepseek-v4.1-flash-expires-on-0910` **命中表价（Flash）而非 default**，且不进 `priceFallbackModels`——这是本批的核心，必须有。
- 四个 DeepSeek flash 系列名字都解析到同一档 Flash 价。
- `deepseek-v4-pro` 仍是 PRO 价。
- `default` 等于 Flash peak。
- 已有的时段/逐次计价/优先级测试全部保持通过（不要改它们的断言）。

不要跑 `npm run dev` / `build` / `cf:*` / playwright。不要 `git commit`。

## 报告

简短中文汇报：表最终长什么样、两条验收命令的**实际输出**。
