# plan agent 计量层实施计划（Part A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个 plan agent run 结束时，把 DeepSeek/Anthropic 的 token 用量、Google 各类调用次数和按价格表算出的成本写进 `TripPlanRunLog.modelUsage`。只记账，不扣费。

**Architecture:** 三条数据流汇到 loop：模型 usage 由两个流式客户端解析后以不可枚举属性附在返回消息上；Google 调用次数挂在现有 `EnrichBudget` 上随 run 累加；价格表与成本计算独立成 `lib/billing/`，loop 在写运行日志前汇总。

**Tech Stack:** TypeScript、Next.js、Prisma、vitest。测试命令 `npx vitest run <文件>`，类型检查 `npm run typecheck`。

**对应设计：** `docs/superpowers/specs/2026-09-06-plan-agent-billing-tiers-design.md` §7。

**约束（对执行者）：**
- 不要 `git commit`，不要碰 `app/(authed)/plan/**` 与 `components/**`（前端另有任务）。
- 不要运行任何 prisma migrate 命令，本部分不改 schema。
- `lib/planAgent/loop.ts` 已很大，只在指定位置加代码，不重排。
- 所有新测试放在 `tests/llm/` 与 `tests/planAgent/`，用现有 in-memory repo 与 mock fetch，不连数据库。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| 新建 `lib/llm/usage.ts` | `LlmUsage` 类型、两种协议的 usage 解析、附着/读取不可枚举 usage 属性 |
| 修改 `lib/llm/openaiClient.ts` | 请求带 `stream_options.include_usage`，解析末帧 usage |
| 修改 `lib/llm/anthropicClient.ts` | 解析 `message_start` 与 `message_delta` 的 usage |
| 修改 `lib/planAgent/api.ts` | env 路径同样带 include_usage 并附着 usage；`withModelUsageInRunLog` 改为合并而不是覆盖 |
| 新建 `lib/billing/priceTable.ts` | 价格表常量与版本号 |
| 新建 `lib/billing/cost.ts` | token/调用次数 → 微美元；run 成本汇总结构 |
| 修改 `lib/planAgent/enrich/types.ts` | `EnrichBudget.calls` 分类计数与 `countGoogleCall` / `meterGoogleCall` 助手 |
| 修改 7 处外呼计数点 | 改用助手，顺带打上类别 |
| 修改 `lib/planAgent/loop.ts` | 累加 usage，写 `modelUsage` |

---

### Task A1: `lib/llm/usage.ts` — usage 类型与解析

**Files:**
- Create: `lib/llm/usage.ts`
- Test: `tests/llm/usage.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/llm/usage.test.ts
import { describe, expect, it } from 'vitest'
import {
  addUsage,
  attachLlmUsage,
  EMPTY_USAGE,
  llmUsageOf,
  parseAnthropicUsage,
  parseOpenAiUsage,
} from '@/lib/llm/usage'

describe('parseOpenAiUsage', () => {
  it('reads DeepSeek cache hit/miss and reasoning tokens', () => {
    expect(
      parseOpenAiUsage({
        prompt_tokens: 1200,
        completion_tokens: 300,
        prompt_cache_hit_tokens: 1000,
        prompt_cache_miss_tokens: 200,
        completion_tokens_details: { reasoning_tokens: 120 },
      }),
    ).toEqual({ inputMiss: 200, inputCacheHit: 1000, output: 300, reasoning: 120 })
  })

  it('falls back to OpenAI prompt_tokens_details.cached_tokens', () => {
    expect(
      parseOpenAiUsage({ prompt_tokens: 500, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 100 } }),
    ).toEqual({ inputMiss: 400, inputCacheHit: 100, output: 50, reasoning: 0 })
  })

  it('returns null for missing or malformed usage', () => {
    expect(parseOpenAiUsage(undefined)).toBeNull()
    expect(parseOpenAiUsage({ prompt_tokens: 'x' })).toBeNull()
  })
})

describe('parseAnthropicUsage', () => {
  it('sums input + cache_creation as miss, cache_read as hit', () => {
    expect(
      parseAnthropicUsage(
        { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 800 },
        { output_tokens: 70 },
      ),
    ).toEqual({ inputMiss: 150, inputCacheHit: 800, output: 70, reasoning: 0 })
  })

  it('returns null when neither event carried usage', () => {
    expect(parseAnthropicUsage(undefined, undefined)).toBeNull()
  })
})

describe('attachLlmUsage / llmUsageOf', () => {
  it('attaches a non-enumerable property and reads it back', () => {
    const message = { role: 'assistant', content: 'hi' }
    attachLlmUsage(message, { inputMiss: 1, inputCacheHit: 2, output: 3, reasoning: 0 })
    expect(llmUsageOf(message)).toEqual({ inputMiss: 1, inputCacheHit: 2, output: 3, reasoning: 0 })
    expect(JSON.stringify(message)).toBe('{"role":"assistant","content":"hi"}')
    expect(llmUsageOf(null)).toBeNull()
    expect(llmUsageOf({})).toBeNull()
  })
})

describe('addUsage', () => {
  it('adds field-wise starting from EMPTY_USAGE', () => {
    const a = addUsage(EMPTY_USAGE, { inputMiss: 1, inputCacheHit: 2, output: 3, reasoning: 4 })
    expect(addUsage(a, { inputMiss: 10, inputCacheHit: 20, output: 30, reasoning: 40 })).toEqual({
      inputMiss: 11,
      inputCacheHit: 22,
      output: 33,
      reasoning: 44,
    })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/llm/usage.test.ts`
Expected: FAIL，找不到模块 `@/lib/llm/usage`。

- [ ] **Step 3: 实现**

```ts
// lib/llm/usage.ts
/**
 * 模型 token 用量的统一口径（设计 §7.1）。四个字段全部是 token 数：
 * - inputMiss：未命中缓存的输入（含 Anthropic 的 cache_creation）
 * - inputCacheHit：命中缓存的输入
 * - output：输出总量（含 reasoning）
 * - reasoning：输出里属于推理过程的部分（仅供分析，计价已含在 output 内）
 */
export type LlmUsage = {
  inputMiss: number
  inputCacheHit: number
  output: number
  reasoning: number
}

export const EMPTY_USAGE: LlmUsage = { inputMiss: 0, inputCacheHit: 0, output: 0, reasoning: 0 }

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputMiss: a.inputMiss + b.inputMiss,
    inputCacheHit: a.inputCacheHit + b.inputCacheHit,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * OpenAI 兼容协议的 usage：DeepSeek 在顶层给 prompt_cache_hit_tokens /
 * prompt_cache_miss_tokens，OpenAI 官方给 prompt_tokens_details.cached_tokens。
 * prompt_tokens 与 completion_tokens 缺失或非数字 → null（调用方记 usageMissing）。
 */
export function parseOpenAiUsage(raw: unknown): LlmUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  const prompt = num(u.prompt_tokens)
  const completion = num(u.completion_tokens)
  if (prompt === null || completion === null) return null
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>
  const completionDetails = (u.completion_tokens_details ?? {}) as Record<string, unknown>
  const hit = num(u.prompt_cache_hit_tokens) ?? num(details.cached_tokens) ?? 0
  const miss = num(u.prompt_cache_miss_tokens) ?? Math.max(0, prompt - hit)
  return {
    inputMiss: miss,
    inputCacheHit: hit,
    output: completion,
    reasoning: num(completionDetails.reasoning_tokens) ?? 0,
  }
}

export type AnthropicStartUsage = {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}
export type AnthropicDeltaUsage = { output_tokens?: number }

/** Anthropic：message_start 带输入侧，message_delta 带输出侧；两者都没有 → null。 */
export function parseAnthropicUsage(
  start: AnthropicStartUsage | undefined,
  delta: AnthropicDeltaUsage | undefined,
): LlmUsage | null {
  if (!start && !delta) return null
  return {
    inputMiss: (num(start?.input_tokens) ?? 0) + (num(start?.cache_creation_input_tokens) ?? 0),
    inputCacheHit: num(start?.cache_read_input_tokens) ?? 0,
    output: num(delta?.output_tokens) ?? 0,
    reasoning: 0,
  }
}

const USAGE_KEY = 'llm_usage'

/**
 * 把 usage 以不可枚举属性挂到返回消息上（与 lib/planAgent/api.ts 的
 * provider 同一手法）：任何 JSON 序列化路径都不会把它带进 TripPlanMessage。
 */
export function attachLlmUsage<T extends object>(message: T, usage: LlmUsage): T {
  Object.defineProperty(message, USAGE_KEY, {
    value: usage,
    enumerable: false,
    writable: false,
    configurable: true,
  })
  return message
}

export function llmUsageOf(message: object | null | undefined): LlmUsage | null {
  if (!message) return null
  const value = (message as Record<string, unknown>)[USAGE_KEY]
  return value && typeof value === 'object' ? (value as LlmUsage) : null
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/llm/usage.test.ts`
Expected: PASS，8 个用例。

---

### Task A2: openaiClient 流式请求带 include_usage 并附着 usage

**Files:**
- Modify: `lib/llm/openaiClient.ts`
- Test: `tests/llm/openaiClient.test.ts`

- [ ] **Step 1: 写失败测试**（追加到 `tests/llm/openaiClient.test.ts` 的 `describe('openai-compatible client')` 内）

```ts
  it('requests stream_options.include_usage and attaches the final usage chunk', async () => {
    const usageChunk =
      'data: ' +
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 300,
          prompt_cache_hit_tokens: 1000,
          prompt_cache_miss_tokens: 200,
          completion_tokens_details: { reasoning_tokens: 120 },
        },
      }) +
      '\n\n'
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([chunk({ role: 'assistant' }), chunk({ content: '好' }), chunk({}, 'stop'), usageChunk, 'data: [DONE]\n\n']),
    )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://api.deepseek.com/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const message = await client.streamChat({ model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 })

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).stream_options).toEqual({ include_usage: true })
    expect(message.content).toBe('好')
    expect(llmUsageOf(message)).toEqual({ inputMiss: 200, inputCacheHit: 1000, output: 300, reasoning: 120 })
    expect(Object.keys(message)).not.toContain('llm_usage')
  })
```

在文件顶部加 `import { llmUsageOf } from '@/lib/llm/usage'`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/llm/openaiClient.test.ts`
Expected: 新用例 FAIL（`stream_options` 为 undefined）。

- [ ] **Step 3: 实现**

在 `lib/llm/openaiClient.ts`：

1. import 追加：`import { attachLlmUsage, parseOpenAiUsage, type LlmUsage } from './usage'`
2. `streamChat` 的请求体里 `stream: true,` 后一行加 `stream_options: { include_usage: true },`
3. 在 `let finishReason` 声明后加 `let usage: LlmUsage | null = null`
4. SSE 回调里，`const choice = chunk.choices?.[0]` **之前**插入：

```ts
      // 末帧 usage（choices 为空数组）：先于 choice 判空读取，否则会被 return 丢掉
      const parsedUsage = parseOpenAiUsage((chunk as { usage?: unknown }).usage)
      if (parsedUsage) usage = parsedUsage
```

5. 构造 `message` 之后、`return message` 之前加：`if (usage) attachLlmUsage(message, usage)`

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/llm/openaiClient.test.ts`
Expected: 全部 PASS（旧用例也不受影响，它们没有 usage 帧，`llmUsageOf` 为 null）。

---

### Task A3: anthropicClient 解析 usage

**Files:**
- Modify: `lib/llm/anthropicClient.ts`
- Test: `tests/llm/anthropicClient.test.ts`

- [ ] **Step 1: 写失败测试**（追加到现有 describe 内；沿用该文件已有的 SSE 构造助手，若助手名不同按现有名替换）

```ts
  it('attaches usage from message_start and message_delta', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 800 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '好' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 70 } },
      { type: 'message_stop' },
    ].map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(events))
    const client = createLlmClient({
      protocol: 'anthropic',
      endpointUrl: 'https://api.anthropic.com/v1/messages',
      apiKey: 'sk-ant',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const message = await client.streamChat({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 })
    expect(llmUsageOf(message)).toEqual({ inputMiss: 150, inputCacheHit: 800, output: 70, reasoning: 0 })
  })
```

顶部加 `import { llmUsageOf } from '@/lib/llm/usage'`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/llm/anthropicClient.test.ts`
Expected: 新用例 FAIL（`llmUsageOf` 为 null）。

- [ ] **Step 3: 实现**

在 `lib/llm/anthropicClient.ts`：

1. import 追加：`import { attachLlmUsage, parseAnthropicUsage, type AnthropicDeltaUsage, type AnthropicStartUsage } from './usage'`
2. `AnthropicStreamEvent` 类型加两个字段：

```ts
  message?: { usage?: AnthropicStartUsage }
  usage?: AnthropicDeltaUsage
```

3. `streamChat` 里 `let stopReasonRaw` 后加：

```ts
    let startUsage: AnthropicStartUsage | undefined
    let deltaUsage: AnthropicDeltaUsage | undefined
```

4. SSE 回调里、`content_block_start` 判断之前插入：

```ts
      if (event.type === 'message_start' && event.message?.usage) {
        startUsage = event.message.usage
        return
      }
      if (event.type === 'message_delta' && event.usage) deltaUsage = event.usage
```

（注意 `message_delta` 分支不要 return，下面已有的 stop_reason 判断还要执行。）

5. 构造 `message` 之后、`return message` 之前加：

```ts
    const usage = parseAnthropicUsage(startUsage, deltaUsage)
    if (usage) attachLlmUsage(message, usage)
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/llm/anthropicClient.test.ts`
Expected: 全部 PASS。

---

### Task A4: env 路径（OpenAI SDK）带 include_usage；`withModelUsageInRunLog` 改合并

**Files:**
- Modify: `lib/planAgent/api.ts`
- Test: `tests/planAgent/api.test.ts`

- [ ] **Step 1: 写失败测试**（追加到 `tests/planAgent/api.test.ts`；该文件已有 mock OpenAI SDK 流式返回的方式，沿用它的 mock 构造，把末帧改为带 `usage` 且 `choices: []`）

```ts
  it('env path attaches usage from the final stream chunk', async () => {
    // 沿用本文件已有的 SDK stream mock 方式，最后追加一帧：
    //   { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6 } }
    const message = await createChatCompletion({ messages: [{ role: 'user', content: 'hi' }], tools: [] })
    expect(llmUsageOf(message)).toEqual({ inputMiss: 6, inputCacheHit: 4, output: 5, reasoning: 0 })
  })

  it('withModelUsageInRunLog merges provider info into an existing modelUsage object', async () => {
    const repo = createMemoryTripPlanRepo()
    const wrapped = withModelUsageInRunLog(repo)
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const record = await wrapped.appendRunLog({
      planId: plan.id,
      turnIndex: 1,
      stage: 'deliver',
      modelUsage: { tokens: { inputMiss: 1, inputCacheHit: 0, output: 1, reasoning: 0 } },
      durationMs: 1,
    })
    // 没有供应商接管时（env 路径）provider 字段为空，但 loop 写入的对象必须原样保留
    expect(record.modelUsage).toMatchObject({ tokens: { inputMiss: 1 } })
  })
```



- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/planAgent/api.test.ts`
Expected: 两个新用例 FAIL。

- [ ] **Step 3: 实现**

在 `lib/planAgent/api.ts`：

1. import 追加：`import { attachLlmUsage, parseOpenAiUsage, type LlmUsage } from '@/lib/llm/usage'`
2. `attemptStreamOnce` 里 SDK 请求对象加 `stream_options: { include_usage: true },`
3. `let finishReason` 后加 `let usage: LlmUsage | null = null`
4. `for await` 循环体第一行 `sawAnyChunk = true` 之后、`const choice = chunk.choices[0]` 之前插入：

```ts
    const parsedUsage = parseOpenAiUsage((chunk as { usage?: unknown }).usage)
    if (parsedUsage) usage = parsedUsage
```

5. 构造 `message` 后、`return message` 前加 `if (usage) attachLlmUsage(message, usage)`
6. `withModelUsageInRunLog` 的 appendRunLog 替换为：

```ts
        return async (entry: Parameters<TripPlanRepo['appendRunLog']>[0]) => {
          const usage = providerUsageOfMessage(lastReturnedMessage)
          if (!usage) return target.appendRunLog(entry)
          // loop 写入的 tokens/calls/costMicros 与供应商信息合并；两边字段名不重叠
          const base =
            entry.modelUsage && typeof entry.modelUsage === 'object' && !Array.isArray(entry.modelUsage)
              ? (entry.modelUsage as Record<string, unknown>)
              : {}
          return target.appendRunLog({
            ...entry,
            modelUsage: { ...base, ...usage } as unknown as Prisma.JsonValue,
          })
        }
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/planAgent/api.test.ts`
Expected: 全部 PASS。

---

### Task A5: 价格表与成本计算 `lib/billing/`

**Files:**
- Create: `lib/billing/priceTable.ts`
- Create: `lib/billing/cost.ts`
- Test: `tests/billing/cost.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/billing/cost.test.ts
import { describe, expect, it } from 'vitest'
import { costOfGoogleCalls, costOfModelUsage, EMPTY_GOOGLE_CALLS, summarizeRunCost } from '@/lib/billing/cost'
import { GOOGLE_PRICES_MICROS, MODEL_PRICES, PRICE_TABLE_VERSION, TITLE_OVERHEAD_MICROS } from '@/lib/billing/priceTable'

describe('costOfModelUsage', () => {
  it('prices each bucket per million tokens and rounds to integer micros', () => {
    const p = MODEL_PRICES['deepseek-v4-flash']
    const usage = { inputMiss: 1_000_000, inputCacheHit: 2_000_000, output: 500_000, reasoning: 100_000 }
    expect(costOfModelUsage('deepseek-v4-flash', usage)).toBe(
      p.inputMissPerM + 2 * p.inputCacheHitPerM + Math.round(p.outputPerM / 2),
    )
  })
  it('falls back to the default price for unknown models', () => {
    const usage = { inputMiss: 1_000_000, inputCacheHit: 0, output: 0, reasoning: 0 }
    expect(costOfModelUsage('some-unknown-model', usage)).toBe(MODEL_PRICES.default.inputMissPerM)
  })
})

describe('costOfGoogleCalls', () => {
  it('multiplies each category by its unit price', () => {
    expect(costOfGoogleCalls({ placesTextSearch: 2, placesNearby: 1, placeDetails: 3, directions: 4 })).toBe(
      2 * GOOGLE_PRICES_MICROS.placesTextSearch +
        GOOGLE_PRICES_MICROS.placesNearby +
        3 * GOOGLE_PRICES_MICROS.placeDetails +
        4 * GOOGLE_PRICES_MICROS.directions,
    )
    expect(costOfGoogleCalls(EMPTY_GOOGLE_CALLS)).toBe(0)
  })
})

describe('summarizeRunCost', () => {
  it('builds the modelUsage json with totals, per-model usage and version', () => {
    const usageByModel = new Map([['deepseek-v4-flash', { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 }]])
    const summary = summarizeRunCost({
      usageByModel,
      calls: { placesTextSearch: 1, placesNearby: 0, placeDetails: 0, directions: 2 },
      modelCalls: 3,
      usageMissing: false,
      withTitle: true,
    })
    expect(summary.tokens).toEqual({ inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 })
    expect(summary.models).toEqual({ 'deepseek-v4-flash': { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 } })
    expect(summary.calls).toEqual({ placesTextSearch: 1, placesNearby: 0, placeDetails: 0, directions: 2 })
    expect(summary.costMicros.google).toBe(GOOGLE_PRICES_MICROS.placesTextSearch + 2 * GOOGLE_PRICES_MICROS.directions)
    expect(summary.costMicros.model).toBe(
      costOfModelUsage('deepseek-v4-flash', { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 }) + TITLE_OVERHEAD_MICROS,
    )
    expect(summary.costMicros.total).toBe(summary.costMicros.model + summary.costMicros.google)
    expect(summary.modelCalls).toBe(3)
    expect(summary.usageMissing).toBe(false)
    expect(summary.priceTableVersion).toBe(PRICE_TABLE_VERSION)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/billing/cost.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现价格表**

```ts
// lib/billing/priceTable.ts
/**
 * 价格表（设计 §7.3）。单位全部是微美元（1 美元 = 1,000,000）。
 *
 * 抄录日期：2026-09-06。下面的数值是按供应商公开牌价填的**初始值**，
 * 上线扣费前必须对照 DeepSeek 与 Google Maps Platform 当前价格页逐项核对，
 * 改动任何数值都要同时更新 PRICE_TABLE_VERSION（run log 用它标记口径）。
 */
export const PRICE_TABLE_VERSION = '2026-09-06'

/** 每百万 token 的价格（微美元）。$0.28/M = 280_000。 */
export type ModelPrice = { inputMissPerM: number; inputCacheHitPerM: number; outputPerM: number }

export const MODEL_PRICES: Record<string, ModelPrice> & { default: ModelPrice } = {
  default: { inputMissPerM: 280_000, inputCacheHitPerM: 28_000, outputPerM: 420_000 },
  'deepseek-v4-flash': { inputMissPerM: 280_000, inputCacheHitPerM: 28_000, outputPerM: 420_000 },
  'deepseek-chat': { inputMissPerM: 280_000, inputCacheHitPerM: 28_000, outputPerM: 420_000 },
  'deepseek-reasoner': { inputMissPerM: 280_000, inputCacheHitPerM: 28_000, outputPerM: 420_000 },
}

/** Google 每次调用价格（微美元）。$32/1000 次 = 32_000。 */
export const GOOGLE_PRICES_MICROS = {
  placesTextSearch: 32_000,
  placesNearby: 32_000,
  /** Place Details 含随后经镜像拉取的照片（Photos 按次价摊进这里，不单独计） */
  placeDetails: 24_000,
  directions: 5_000,
} as const

/** 标题侧信道（每个带新用户消息的 run 一次，几百 token）按固定值摊入模型成本 */
export const TITLE_OVERHEAD_MICROS = 500
```

- [ ] **Step 4: 实现成本计算**

```ts
// lib/billing/cost.ts
import type { LlmUsage } from '@/lib/llm/usage'
import { addUsage, EMPTY_USAGE } from '@/lib/llm/usage'
import { GOOGLE_PRICES_MICROS, MODEL_PRICES, PRICE_TABLE_VERSION, TITLE_OVERHEAD_MICROS } from './priceTable'

export type GoogleCallCounts = {
  placesTextSearch: number
  placesNearby: number
  placeDetails: number
  directions: number
}
export type GoogleCallCategory = keyof GoogleCallCounts

export const EMPTY_GOOGLE_CALLS: GoogleCallCounts = { placesTextSearch: 0, placesNearby: 0, placeDetails: 0, directions: 0 }

export function costOfModelUsage(model: string, usage: LlmUsage): number {
  const price = MODEL_PRICES[model] ?? MODEL_PRICES.default
  return Math.round(
    (usage.inputMiss * price.inputMissPerM + usage.inputCacheHit * price.inputCacheHitPerM + usage.output * price.outputPerM) /
      1_000_000,
  )
}

export function costOfGoogleCalls(calls: GoogleCallCounts): number {
  return (
    calls.placesTextSearch * GOOGLE_PRICES_MICROS.placesTextSearch +
    calls.placesNearby * GOOGLE_PRICES_MICROS.placesNearby +
    calls.placeDetails * GOOGLE_PRICES_MICROS.placeDetails +
    calls.directions * GOOGLE_PRICES_MICROS.directions
  )
}

/** TripPlanRunLog.modelUsage 里由 loop 写入的部分（供应商字段由 api.ts 合并） */
export type RunCostSummary = {
  tokens: LlmUsage
  models: Record<string, LlmUsage>
  calls: GoogleCallCounts
  costMicros: { model: number; google: number; total: number }
  modelCalls: number
  usageMissing: boolean
  priceTableVersion: string
}

export function summarizeRunCost(input: {
  usageByModel: Map<string, LlmUsage>
  calls: GoogleCallCounts
  modelCalls: number
  usageMissing: boolean
  /** 本 run 有新用户消息 → 标题侧信道跑过一次 */
  withTitle: boolean
}): RunCostSummary {
  let tokens = EMPTY_USAGE
  let model = input.withTitle ? TITLE_OVERHEAD_MICROS : 0
  const models: Record<string, LlmUsage> = {}
  for (const [name, usage] of input.usageByModel) {
    tokens = addUsage(tokens, usage)
    models[name] = usage
    model += costOfModelUsage(name, usage)
  }
  const google = costOfGoogleCalls(input.calls)
  return {
    tokens,
    models,
    calls: { ...input.calls },
    costMicros: { model, google, total: model + google },
    modelCalls: input.modelCalls,
    usageMissing: input.usageMissing,
    priceTableVersion: PRICE_TABLE_VERSION,
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/billing/cost.test.ts`
Expected: PASS。

---

### Task A6: `EnrichBudget.calls` 分类计数与助手，替换 7 处外呼计数

**Files:**
- Modify: `lib/planAgent/enrich/types.ts`
- Modify: `lib/planAgent/tools.ts:328-330`、`lib/planAgent/tools.ts:379-381`
- Modify: `lib/planAgent/placeBackstop.ts:86-89`
- Modify: `lib/planAgent/enrich/imageDedupeEnricher.ts:135-137`
- Modify: `lib/planAgent/enrich/restaurantEnricher.ts:172-174`
- Modify: `lib/planAgent/enrich/transportEnricher.ts:86-88`
- Modify: `lib/planAgent/travelHelpers.ts:278-280`
- Test: `tests/planAgent/enrich/budgetCalls.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/planAgent/enrich/budgetCalls.test.ts
import { describe, expect, it } from 'vitest'
import { countGoogleCall, createEnrichBudget, meterGoogleCall } from '@/lib/planAgent/enrich/types'

describe('EnrichBudget call meter', () => {
  it('countGoogleCall bumps the window bucket and the per-run category', () => {
    const budget = createEnrichBudget()
    countGoogleCall(budget, 'placesTextSearch')
    countGoogleCall(budget, 'placesNearby')
    countGoogleCall(budget, 'placeDetails')
    countGoogleCall(budget, 'directions')
    expect(budget.places.used).toBe(3)
    expect(budget.directions.used).toBe(1)
    expect(budget.calls).toEqual({ placesTextSearch: 1, placesNearby: 1, placeDetails: 1, directions: 1 })
  })

  it('meterGoogleCall only bumps the per-run category (budget already pre-deducted)', () => {
    const budget = createEnrichBudget()
    meterGoogleCall(budget, 'placesNearby')
    expect(budget.places.used).toBe(0)
    expect(budget.calls.placesNearby).toBe(1)
  })

  it('tolerates budgets constructed without calls (legacy literals in tests)', () => {
    const budget = { directions: { used: 0, max: 40 }, places: { used: 0, max: 40 }, windowStartedAt: Date.now() }
    countGoogleCall(budget, 'directions')
    expect(budget.directions.used).toBe(1)
    expect((budget as { calls?: unknown }).calls).toEqual({ placesTextSearch: 0, placesNearby: 0, placeDetails: 0, directions: 1 })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/planAgent/enrich/budgetCalls.test.ts`
Expected: FAIL，`countGoogleCall` 不存在。

- [ ] **Step 3: 实现助手**

在 `lib/planAgent/enrich/types.ts`：

1. import 追加：`import { EMPTY_GOOGLE_CALLS, type GoogleCallCategory, type GoogleCallCounts } from '@/lib/billing/cost'`
2. `EnrichBudget` 类型加字段（可选，兼容测试里的字面量）：

```ts
  /** 本 run 累计真实外呼次数（不随时间窗归零；设计 §7.2 计量层） */
  calls?: GoogleCallCounts
```

3. `createEnrichBudget` 返回对象加 `calls: { ...EMPTY_GOOGLE_CALLS },`
4. 文件末尾追加：

```ts
/** 只累加本 run 计量（预算桶已由调用方预扣时用） */
export function meterGoogleCall(budget: EnrichBudget, category: GoogleCallCategory): void {
  if (!budget.calls) budget.calls = { ...EMPTY_GOOGLE_CALLS }
  budget.calls[category] += 1
}

/** 真实外呼一次：预算桶 used+1（places 三类共用 places 桶）并累加本 run 计量 */
export function countGoogleCall(budget: EnrichBudget, category: GoogleCallCategory): void {
  if (category === 'directions') budget.directions.used += 1
  else budget.places.used += 1
  meterGoogleCall(budget, category)
}
```

- [ ] **Step 4: 替换 7 处计数点**

每处只改 onGoogleCall 回调体，其余不动。需要的文件在顶部补 import（`countGoogleCall` / `meterGoogleCall` 从 `'./enrich/types'` 或 `'./types'` 或 `'@/lib/planAgent/enrich/types'`，按文件位置选相对路径）。

`lib/planAgent/tools.ts` resolve_place（约 328 行）：
```ts
          onGoogleCall: () => countGoogleCall(budget, 'placesTextSearch'),
```
`lib/planAgent/tools.ts` find_restaurants（约 379 行）：
```ts
          onGoogleCall: () => countGoogleCall(budget, 'placesNearby'),
```
`lib/planAgent/placeBackstop.ts`（约 86 行）：
```ts
  const countGoogleCallLocal = () => {
    if (input.budget) countGoogleCall(input.budget, 'placesTextSearch')
    else googleCallsUsed += 1
  }
```
并把该文件里原 `countGoogleCall` 的引用改名为 `countGoogleCallLocal`（约 122 行 `onGoogleCall: countGoogleCall,`）。

`lib/planAgent/enrich/imageDedupeEnricher.ts`（约 135 行）：
```ts
          onGoogleCall: () => {
            if (ctx.budget) countGoogleCall(ctx.budget, 'placeDetails')
          },
```
`lib/planAgent/enrich/restaurantEnricher.ts`（约 172 行；此处预算在派发阶段已 `used += 1` 预扣，不要重复扣）：
```ts
          onGoogleCall: () => {
            group.actualCalls += 1
            if (ctx.budget) meterGoogleCall(ctx.budget, 'placesNearby')
          },
```
`lib/planAgent/enrich/transportEnricher.ts`（约 86 行）：
```ts
          onGoogleCall: () => {
            if (ctx.budget) countGoogleCall(ctx.budget, 'directions')
          },
```
`lib/planAgent/travelHelpers.ts`（约 278 行）：
```ts
      onGoogleCall: () => countGoogleCall(budget, 'directions'),
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/planAgent`
Expected: 全部 PASS（现有 enrich 与 tools 测试对 `used` 的断言不变）。

---

### Task A7: loop 累加 usage 并写入运行日志

**Files:**
- Modify: `lib/planAgent/loop.ts`
- Test: `tests/planAgent/loop.usage.test.ts`

- [ ] **Step 1: 写失败测试**（参照 `tests/planAgent/loop.test.ts` 已有的 createMessage mock 与 in-memory repo 的用法）

```ts
// tests/planAgent/loop.usage.test.ts
import { describe, expect, it, vi } from 'vitest'
import { runPlanAgent, type PlanAgentChatMessage } from '@/lib/planAgent/loop'
import { attachLlmUsage } from '@/lib/llm/usage'
import { GOOGLE_PRICES_MICROS, PRICE_TABLE_VERSION } from '@/lib/billing/priceTable'
import { createEnrichBudget, countGoogleCall } from '@/lib/planAgent/enrich/types'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { PointFinder } from '@/lib/planAgent/points'

const finder: PointFinder = {
  async searchBangumi() {
    return []
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return []
  },
  async getPointsByIds() {
    return []
  },
}

describe('loop usage accounting', () => {
  it('sums usage across model calls and writes tokens/calls/cost into modelUsage', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const budget = createEnrichBudget()
    let call = 0
    const createMessage = vi.fn(async (): Promise<PlanAgentChatMessage> => {
      call += 1
      const message: PlanAgentChatMessage =
        call === 1
          ? {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_plan', arguments: '{}' } }],
            }
          : { role: 'assistant', content: '好的', refusal: null }
      // 第一次调用顺带模拟一次 Directions 外呼被计量
      if (call === 1) countGoogleCall(budget, 'directions')
      return attachLlmUsage(message, { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 })
    })
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder, enrichBudget: budget }, maxIterations: 5 },
      '你好',
      () => {},
    )
    const logs = await repo.listRunLogs(plan.id)
    expect(logs).toHaveLength(1)
    const usage = logs[0].modelUsage as Record<string, any>
    expect(usage.tokens).toEqual({ inputMiss: 200, inputCacheHit: 1800, output: 100, reasoning: 20 })
    expect(usage.calls).toEqual({ placesTextSearch: 0, placesNearby: 0, placeDetails: 0, directions: 1 })
    expect(usage.modelCalls).toBe(2)
    expect(usage.usageMissing).toBe(false)
    expect(usage.costMicros.google).toBe(GOOGLE_PRICES_MICROS.directions)
    expect(usage.costMicros.total).toBe(usage.costMicros.model + usage.costMicros.google)
    expect(usage.priceTableVersion).toBe(PRICE_TABLE_VERSION)
  })

  it('marks usageMissing when a provider returned no usage', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async (): Promise<PlanAgentChatMessage> => ({ role: 'assistant', content: '好的', refusal: null }))
    await runPlanAgent({ createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 }, '你好', () => {})
    const [log] = await repo.listRunLogs(plan.id)
    expect((log.modelUsage as Record<string, any>).usageMissing).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/planAgent/loop.usage.test.ts`
Expected: FAIL，`modelUsage` 为 null。

- [ ] **Step 3: 实现**

在 `lib/planAgent/loop.ts`：

1. import 追加：

```ts
import { llmUsageOf, type LlmUsage, addUsage } from '@/lib/llm/usage'
import { EMPTY_GOOGLE_CALLS, summarizeRunCost } from '@/lib/billing/cost'
```

2. `const toolCallSummaries` 声明（约 298 行）后加：

```ts
  // 计量层（设计 §7）：按模型累加 usage；缺 usage 的调用记 usageMissing
  const usageByModel = new Map<string, LlmUsage>()
  let modelCalls = 0
  let usageMissing = false
```

3. `const toolDeps: PlanAgentToolDeps = {` 之前，把预算提出来成变量（后面读 calls 用）：

```ts
  const enrichBudget = deps.toolDeps.enrichBudget ?? createEnrichBudget()
```
并把 toolDeps 里那行改为 `enrichBudget,`。

4. 模型调用返回后、`if (!modelInfoEmitted)` 之前（约 437 行）加：

```ts
      modelCalls += 1
      const callUsage = llmUsageOf(response)
      if (callUsage) {
        const modelName = describePlanAgentModel(response).model
        usageByModel.set(modelName, addUsage(usageByModel.get(modelName) ?? { inputMiss: 0, inputCacheHit: 0, output: 0, reasoning: 0 }, callUsage))
      } else {
        usageMissing = true
      }
```

5. `appendRunLog` 调用里 `modelUsage: null,` 改为：

```ts
            modelUsage: summarizeRunCost({
              usageByModel,
              calls: enrichBudget.calls ?? { ...EMPTY_GOOGLE_CALLS },
              modelCalls,
              usageMissing: usageMissing || modelCalls === 0,
              withTitle: Boolean(userMessage),
            }) as unknown as Prisma.JsonValue,
```

（`userMessage` 是 `runPlanAgent` 的第二个参数名，若实际参数名不同按实际替换。）

6. run summary 的 `console.log('[agent] run summary', {...})` 对象加 `modelCalls,`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/planAgent/loop.usage.test.ts tests/planAgent/loop.test.ts`
Expected: PASS。

- [ ] **Step 5: 全量校验**

Run: `npm run typecheck && npx vitest run tests/llm tests/planAgent tests/billing`
Expected: typecheck 无错误，测试全绿。

---

## 自查清单（执行者完成后）

- `TripPlanRunLog.modelUsage` 有 `tokens / models / calls / costMicros / modelCalls / usageMissing / priceTableVersion`，接管供应商时还带 `providerId / providerName / model / protocol`。
- `TripPlanMessage.content` 里没有 `llm_usage` 字段（不可枚举属性不会被 JSON 序列化）。
- 免费 DeepSeek 流里如果没有 usage 帧，`usageMissing = true`，run 不受影响。
- 未改动 `prisma/`、`app/(authed)/plan/**`、`components/**`。
