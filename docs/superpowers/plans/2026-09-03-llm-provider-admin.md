# 模型接入自定义化：管理员面板自定义 LLM 供应商 + 接管范围（2026-09-03）

工作方式同前：先通读现状；每条先补失败测试再实现；**不要 git commit**；**不对任何数据库执行迁移**（迁移文件只写不跑，`npx prisma generate` 可以跑）；`node scripts/check-line-budget.mjs` 必须通过（新逻辑放新文件，单文件 ≤ 750 行）。

- A（后端，glm-5.3）只碰 `lib/llm/**`（新建）、`lib/planAgent/api.ts`、`lib/translation/gemini.ts`、`lib/anitabi/cf/bindings.ts`、`prisma/**`、`app/api/admin/llm/**`（新建）、`tests/llm/**`（新建）、`tests/planAgent/api.test.ts`、`tests/translation/**`。
- B（前端，kimi k3）只碰 `app/(authed)/admin/llm/**`（新建）、`components/admin/Sidebar.tsx`、`tests/admin/llm-*.test.tsx`（新建）、`tests/admin/sidebar.test.tsx`。
- A/B 并行；接口契约见 §0，两边都按契约实现。另有一个并行的 opencode 在改 `lib/googlePlaces/**`、`lib/planAgent/enrich/**`、`components/map/**`、`app/(authed)/plan/**`，不要碰。

## 需求（用户原话整理）
1. 管理员面板提供自定义供应商接口（兼容 OpenAI / Anthropic 协议）：填写供应商名称、请求完整 URL、API key、选择协议、填写模型名称与上下文长度（可多个）、连接测试（已保存的模型名旁按钮，测试连通性与延迟）。
2. 配置自定义供应商接管范围：勾选后该供应商接管 agent、翻译服务或均接管。
3. 当前项目已保存的 LLM API 服务内化为面板中的供应商；允许多个供应商并存；一个 API key 对应一个供应商。

## 现状（探索结论）
- 计划 agent 唯一模型客户端在 `lib/planAgent/api.ts`：OpenAI SDK，`PLAN_AGENT_MODEL`（默认 deepseek-v4-flash）、`PLAN_AGENT_BASE_URL`（默认 https://api.deepseek.com）、`PLAN_AGENT_API_KEY`、`PLAN_AGENT_MAX_TOKENS`（默认 32768）；模块级 `cachedClient` 单例；流式 + tool_calls 累积；DeepSeek 的 `reasoning_content` 只在 `extractReasoningDelta` 一处断言；`generatePlanTitle` 是第二个入口。调用方：`app/api/me/plans/[id]/agent/route.ts`（`createMessage: createChatCompletion`、`createTitle`）。
- 翻译服务在 `lib/translation/gemini.ts`：原生 fetch 调 Gemini `generateContent`（URL 里写死 gemini-2.5-flash），`GEMINI_API_KEY`；导出 `callGemini / translateText / translateTextBatch`；所有翻译调用方（service.ts、mapTaskExecutor.ts、anitabi/searchCache.ts、seo/spokeFactory/*）最终都走 `callGemini`。
- 管理端：页面级鉴权 `getServerAuthSession()` + `session.user.isAdmin`（来自 `ADMIN_EMAILS`）；API 端 `isAdminSession`；侧栏在 `components/admin/Sidebar.tsx` 的 navItems；DB 配置先例只有 `MapImageDiagControl`；没有任何加密/脱敏工具。
- Cloudflare 上 env 通过 `process.env` 注入，`getCfBindings()` 只用于 R2/EMAIL 绑定。

---

## §0 A/B 契约

### 数据形状（API 返回给前端，绝不含明文 key）
```ts
export type LlmProtocol = 'openai' | 'anthropic'
export type LlmModelConfig = { name: string; contextLength: number; maxOutputTokens?: number | null }
export type LlmProviderView = {
  id: string
  name: string
  protocol: LlmProtocol
  endpointUrl: string          // 完整请求 URL，如 https://api.deepseek.com/chat/completions 或 https://api.anthropic.com/v1/messages
  apiKeyHint: string | null    // 形如 "sk-…a1b2"（前 3 + 后 4），未设置为 null
  hasApiKey: boolean
  models: LlmModelConfig[]
  takeover: { agent: boolean; translation: boolean }
  agentModel: string | null      // takeover.agent 时使用的模型名（必须在 models 里）
  translationModel: string | null
  source: 'env' | 'custom'       // env = 由环境变量内化的内置供应商（可编辑；删除后需要重新内化）
  enabled: boolean
  lastTest: { model: string; ok: boolean; latencyMs: number | null; message: string | null; testedAt: string } | null
  createdAt: string
  updatedAt: string
}
```

### 管理 API（全部要求管理员会话；未登录/非管理员 401；输入错误 400 + `{ error }`）
- `GET /api/admin/llm/providers` → `{ ok: true, providers: LlmProviderView[], effective: { agent: { providerId, model } | null, translation: { providerId, model } | null } }`。首次调用若表为空，先从环境变量内化内置供应商（见 A3）再返回。
- `POST /api/admin/llm/providers` body `{ name, protocol, endpointUrl, apiKey, models, enabled? }` → `{ ok: true, provider }`。
- `PUT /api/admin/llm/providers/:id` body 同上，字段可选；`apiKey` 省略或空串表示不改；`takeover: { agent?, translation? }`、`agentModel`、`translationModel` 可选。把某供应商的 `takeover.agent` 设为 true 时服务端自动把其他供应商的 `takeover.agent` 清成 false（translation 同理）；`takeover.agent=true` 时 `agentModel` 必填且必须在 `models` 里。
- `DELETE /api/admin/llm/providers/:id` → `{ ok: true }`；被删除的供应商若正在接管某范围，该范围回退到环境变量。
- `POST /api/admin/llm/providers/:id/test` body `{ model }` → `{ ok: true, result: { ok, latencyMs, message, sample } }`（HTTP 200 即使连通失败，失败信息在 `result.message`）。服务端用保存的 key 发一条最小请求（"回复 OK"），`max_tokens: 8`，超时 20 秒。

### 校验规则
- `name` 1–60 字；`endpointUrl` 必须 `https://`，host 不得是 localhost / 127.0.0.0/8 / 10.0.0.0/8 / 172.16.0.0/12 / 192.168.0.0/16 / 169.254.0.0/16 / IPv6 loopback、link-local（SSRF 守卫），长度 ≤ 500；`models` 1–20 个，`name` 1–100 字且去重，`contextLength` 1000–10,000,000 的整数，`maxOutputTokens` 可选 256–1,000,000。
- 一个供应商一个 key；同一 endpointUrl + name 可重复存在（用户可能用不同 key 建两个）。

---

## A. 后端（glm-5.3）

### A1 迁移与模型（`prisma/schema.prisma`、`prisma/migrations/20260903000000_add_llm_provider/migration.sql`）
```prisma
model LlmProvider {
  id                 String   @id @default(cuid())
  name               String
  protocol           String                     // openai | anthropic
  endpointUrl        String
  apiKeyCiphertext   String?                    // AES-256-GCM: base64(iv).base64(tag).base64(data)
  apiKeyHint         String?
  models             Json                       // LlmModelConfig[]
  takeoverAgent      Boolean  @default(false)
  takeoverTranslation Boolean @default(false)
  agentModel         String?
  translationModel   String?
  source             String   @default("custom") // env | custom
  envKey             String?                    // 内化来源：plan_agent | gemini（防重复内化）
  enabled            Boolean  @default(true)
  lastTest           Json?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([envKey])
}
```
SQL 按 Prisma 惯例手写（`CREATE TABLE "LlmProvider" ...`，`envKey` 唯一索引）。跑 `npx prisma generate`。

### A2 密钥加密（新文件 `lib/llm/secretBox.ts`）
- `encryptSecret(plain: string): string` / `decryptSecret(box: string): string`，Node `crypto` AES-256-GCM；密钥 = `sha256(process.env.LLM_PROVIDER_SECRET || process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET)`，都缺失时抛 `LLM_PROVIDER_SECRET 未配置`。格式 `v1.<iv b64>.<tag b64>.<data b64>`。
- `apiKeyHintOf(plain)`：长度 ≥ 8 时 `前3 + "…" + 后4`，否则 `"…" + 后2`。
- 在 Workers 上用 `globalThis.crypto.subtle`（Web Crypto）实现而不是 `node:crypto`（OpenNext 的 nodejs runtime 两者都可用，但 Web Crypto 更稳）：`crypto.subtle.importKey('raw', sha256(secret), 'AES-GCM')`。
- 测试 `tests/llm/secretBox.test.ts`：往返一致、不同 iv、篡改后解密抛错、缺 secret 抛错、hint 形状。

### A3 仓储与内化（新文件 `lib/llm/repo.ts`、`lib/llm/repoPrisma.ts`、`lib/llm/repoMemory.ts`、`lib/llm/seed.ts`）
- `LlmProviderRepo`：`list()`、`get(id)`、`create(input)`、`update(id, patch)`、`delete(id)`、`clearTakeover(scope, exceptId)`、`setLastTest(id, result)`；行类型 `LlmProviderRow`（含 `apiKeyCiphertext`）。内存实现供测试。
- `seedProvidersFromEnv(repo)`（幂等，按 `envKey` 判重）：
  - `PLAN_AGENT_API_KEY` 存在 → 供应商 `name: 'DeepSeek（环境变量）'`，`protocol: 'openai'`，`endpointUrl: (PLAN_AGENT_BASE_URL || 'https://api.deepseek.com') + '/chat/completions'`，`models: [{ name: PLAN_AGENT_MODEL || 'deepseek-v4-flash', contextLength: 128000, maxOutputTokens: PLAN_AGENT_MAX_TOKENS || 32768 }]`，`takeoverAgent: true`，`agentModel` 同，`source: 'env'`，`envKey: 'plan_agent'`。
  - `GEMINI_API_KEY` 存在 → `name: 'Gemini（环境变量）'`，`protocol: 'openai'`，`endpointUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'`（Gemini 的 OpenAI 兼容端点），`models: [{ name: 'gemini-2.5-flash', contextLength: 1000000, maxOutputTokens: 8192 }]`，`takeoverTranslation: true`，`translationModel: 'gemini-2.5-flash'`，`source: 'env'`，`envKey: 'gemini'`。
  - 只在表为空时（`list().length === 0`）执行；env 缺失时对应供应商不内化。
- `toProviderView(row)`：剥掉密文，补 `hasApiKey/apiKeyHint`。

### A4 协议客户端（新文件 `lib/llm/types.ts`、`lib/llm/openaiClient.ts`、`lib/llm/anthropicClient.ts`、`lib/llm/client.ts`）
统一接口（OpenAI 消息形状为内部标准，与现有 loop.ts 的 `ChatMessageParam`/`PlanAgentChatMessage` 完全兼容）：
```ts
export type LlmChatInput = {
  model: string
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[]
  maxTokens: number
  signal?: AbortSignal
}
export type LlmStreamDelta = { reasoning?: string; content?: string }
export interface LlmClient {
  /** 流式；返回累积重建的 assistant 消息（含 tool_calls / reasoning_content / finish_reason） */
  streamChat(input: LlmChatInput, onDelta?: (d: LlmStreamDelta) => void): Promise<PlanAgentChatMessage>
  /** 非流式纯文本（翻译/标题用）；json=true 时尽量要求 JSON 输出 */
  completeText(input: { model: string; system?: string; prompt: string; maxTokens: number; json?: boolean; temperature?: number; signal?: AbortSignal }): Promise<string>
}
export function createLlmClient(config: { protocol: LlmProtocol; endpointUrl: string; apiKey: string; fetchImpl?: typeof fetch }): LlmClient
```
- `openaiClient.ts`：把现有 `attemptStreamOnce` 的累积逻辑原样搬过来，但用 `fetch(endpointUrl, { method:'POST', headers:{ Authorization: Bearer, 'Content-Type':'application/json' }, body })` + 自己解析 SSE（`data: ` 行、`[DONE]`），不再依赖 OpenAI SDK 的 baseURL 推导（用户填的是完整 URL）。`reasoning_content` 增量照旧透传。`completeText`：`stream:false`，`json` 时加 `response_format: { type: 'json_object' }`（供应商不支持时忽略 400 并重发一次不带 response_format）。
- `anthropicClient.ts`：Messages API（`anthropic-version: 2023-06-01`，`x-api-key`）。转换：system 消息 → `system`；user/assistant 文本 → content blocks；assistant 的 `tool_calls` → `tool_use` blocks（`input` = JSON.parse(arguments)，解析失败用 `{}`）；`role:'tool'` 消息 → 紧随的 user 消息里的 `tool_result` blocks（连续多条 tool 合并进同一条 user 消息）；tools → `{ name, description, input_schema }`。流式 SSE：`content_block_start(tool_use)` / `content_block_delta(text_delta | input_json_delta | thinking_delta)` / `message_delta.stop_reason` → 累积成 OpenAI 形状（`tool_calls[i].function.arguments` 为拼接的 JSON 字符串；`thinking_delta` 透传为 reasoning；`stop_reason` `max_tokens` → `finish_reason:'length'`，`tool_use`/`end_turn` → `'stop'`）。`completeText`：非流式，取首个 text block。
- `client.ts`：`createLlmClient` 按协议分发；`LlmHttpError`（status、body 前 300 字）供上层区分 4xx/5xx。
- 测试 `tests/llm/openaiClient.test.ts`、`tests/llm/anthropicClient.test.ts`：用注入的 `fetchImpl` 返回手工拼的 SSE 文本流，断言重建的 message（content、两个 tool_calls 的 arguments 拼接、finish_reason）、reasoning 透传、请求体转换（anthropic 的 tool_result 合并、system 抽取）。

### A5 运行时解析（新文件 `lib/llm/registry.ts`）
- `resolveLlmForScope(scope: 'agent' | 'translation', deps?: { repo?, now? }): Promise<{ client: LlmClient; model: string; maxOutputTokens: number; providerId: string; providerName: string } | null>`：查 takeover 该 scope 且 enabled 且有 key 的供应商 → 解密 → `createLlmClient`；`maxOutputTokens` = 该模型的 `maxOutputTokens ?? min(contextLength/4, 32768)`。
- 进程内缓存 30 秒（按 scope），`invalidateLlmRegistry()` 在管理 API 每次写入后调用（同一隔离体内立即生效，其他隔离体 30 秒内生效）。
- 库不可用/表不存在（P2021）→ 返回 null 并 `console.warn` 一次（回退环境变量）。
- 测试 `tests/llm/registry.test.ts`：命中/未命中/禁用/无 key/缓存与失效。

### A6 接入 agent（`lib/planAgent/api.ts`）
- `createChatCompletion` 与 `generatePlanTitle` 改为：先 `resolveLlmForScope('agent')`；命中则用其 `client.streamChat` / `completeText`，模型与 `maxTokens` 来自供应商；未命中回退到现有 OpenAI SDK + `PLAN_AGENT_*`（行为不变，现有测试不改）。`reasoning_content` 处理与重试策略（`STREAM_MAX_ATTEMPTS`、`EmptyStreamError`、`isTransientNetworkError`）对两条路径都生效。
- `TripPlanRunLog.modelUsage` 写入 `{ providerId, providerName, model, protocol }`（loop.ts 已有 `modelUsage` 列；若写入点不在 api.ts，则通过 `createChatCompletion` 返回值附带 `provider` 字段由调用方记录——只允许改 `lib/planAgent/api.ts` 与 `app/api/me/plans/[id]/agent/route.ts` 里的一行）。
- 测试：`tests/planAgent/api.test.ts` 补「注入内存 repo 里有 anthropic 接管供应商时，createChatCompletion 走 anthropic 客户端（fetchImpl 收到 x-api-key 头）」；「无接管时仍走 OpenAI SDK mock」。

### A7 接入翻译（`lib/translation/gemini.ts`）
- `callGemini(prompt, retryCount, options)` 开头：`resolveLlmForScope('translation')` 命中 → `client.completeText({ model, prompt, maxTokens: 8192, json: options.responseMimeType === 'application/json', temperature: 0.1 })`，重试/退避沿用现有逻辑（把 fetch 那段抽成 `callGeminiNative`，`callGemini` 只做分发 + 重试包装）；未命中 → 原生 Gemini 路径不变。
- `lib/translation/retryableProviderError.ts` 的正则补上 `LlmHttpError` 的 429/5xx/timeout 文案。
- 测试：`tests/translation/gemini-batch.test.ts` 不改；新增 `tests/translation/llm-takeover.test.ts`：接管命中时不请求 generativelanguage.googleapis.com，而是请求供应商 URL 且 body 含 `response_format`。

### A8 管理 API（新文件 `lib/llm/handlers/adminProviders.ts`、`lib/llm/api.ts`、`app/api/admin/llm/providers/route.ts`、`app/api/admin/llm/providers/[id]/route.ts`、`app/api/admin/llm/providers/[id]/test/route.ts`）
- 依赖注入 `getLlmAdminApiDeps(): { getSession, repo, fetchImpl?, now? }`（Prisma repo 单例）；handlers 用 `isAdminSession` 同款判断（复制到 `lib/llm/handlers/common.ts`，不要跨域引用 translation 的）。
- 校验按 §0；`apiKey` 加密后入库并生成 hint；响应永不含密文/明文；`PUT` 处理 takeover 互斥；写操作后 `invalidateLlmRegistry()`。
- `test`：`createLlmClient` → `completeText({ model, prompt: '回复 OK', maxTokens: 8 })`，计时；成功 `{ ok: true, latencyMs, message: null, sample: 前 40 字 }`；失败 `{ ok: false, latencyMs, message: 错误文案（HTTP 状态 + body 前 200 字，剔除任何形如 key 的字符串）}`；结果写 `lastTest`。
- 路由薄壳同 `app/api/admin/ops/map-image-diagnostics/config/route.ts`（P2021/P2022 → 503「数据库结构未更新」）。
- 测试 `tests/llm/adminProviders.test.ts`：401、400（http URL / 私网 host / 空 models / contextLength 越界）、创建返回 hint 不返回 key、PUT 互斥清除、DELETE 后 effective 回退 null、test 成功与失败（注入 fetchImpl）、首次 GET 内化 env 供应商且第二次不重复。

### A 完成标准
`npx vitest run tests/llm tests/planAgent tests/translation tests/admin` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增错误；line-budget 通过；简短中文汇报（含新增 env 变量 `LLM_PROVIDER_SECRET` 的说明，并把它加进 `.env.example` 注释）。

---

## B. 前端（kimi k3）

### B1 页面 `app/(authed)/admin/llm/page.tsx` + `ui.tsx`（+ 需要时拆 `components/*.tsx`，每文件 ≤ 750 行）
- 鉴权同 `app/(authed)/admin/settings/page.tsx`（`getServerAuthSession` → 未登录 redirect、非管理员「无权限访问。」）。
- 数据全部经 §0 的 API 在客户端拉取（`fetch('/api/admin/llm/providers')`），不做 SSR 取数。
- 布局：顶部标题「模型接入」+「新建供应商」按钮；上方"当前接管"摘要条（Agent：供应商/模型 或「环境变量」；翻译：同）；下方供应商卡片列表。
- 供应商卡片：名称、协议徽标（OpenAI 兼容 / Anthropic）、`source==='env'` 时加「内置」徽标、endpoint、key 提示（`apiKeyHint` 或「未设置」）、模型表（每行：模型名、上下文长度、最大输出、「测试」按钮 → 该行内显示 结果：延迟 ms / 失败文案，测试中按钮禁用并显示「测试中…」）、接管区（两个复选框「接管 Agent」「接管翻译」，勾选后出现该范围的模型下拉，默认第一个模型）、「编辑」「删除」（删除二次确认，内置供应商删除也需确认并提示「删除后需要重新内化」）。
- 新建/编辑表单（抽屉或对话框）：供应商名称、协议单选、请求完整 URL（placeholder 给出两种协议的示例）、API key（password 输入；编辑时留空表示不改，旁边显示当前 hint）、模型列表（可增删行：模型名、上下文长度、最大输出可选）。前端做与 §0 一致的即时校验，服务端 400 文案原样展示。
- 所有请求失败用页面内联错误条显示，不用 alert。

### B2 侧栏（`components/admin/Sidebar.tsx`）
- 「运营与维护」组末尾加「模型接入」`/admin/llm`，图标用 lucide 的 `Cpu`。

### B3 测试（`tests/admin/llm-page.test.tsx`、`tests/admin/sidebar.test.tsx` 补一条）
- mock `fetch`：列表渲染两张卡片；点击「测试」发 POST `/api/admin/llm/providers/<id>/test` 且 body `{ model }`，返回后显示「123 ms」；勾选「接管 Agent」发 PUT 且 body 含 `takeover.agent=true` 与 `agentModel`；新建表单 http URL 被前端拦下并显示错误；编辑时 key 留空不发送 `apiKey` 字段。

### B 完成标准
`npx vitest run tests/admin` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增错误；line-budget 通过；简短中文汇报。
