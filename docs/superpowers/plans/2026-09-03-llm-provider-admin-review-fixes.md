# 模型接入后端审查修复（2026-09-03）

背景：`docs/superpowers/plans/2026-09-03-llm-provider-admin.md` 的 A1–A8 已实现并全绿，安全审查发现以下问题。工作方式同前：每条先补失败测试再改；**不要 git commit**；**不跑迁移**；只碰 `lib/llm/**`、`lib/planAgent/api.ts`、`lib/translation/gemini.ts`、`tests/llm/**`、`tests/planAgent/api.test.ts`、`tests/translation/llm-takeover.test.ts`；line-budget 必须通过。另有并行 opencode 在改 `lib/anitabi/**`、`lib/planAgent/pointImagePrewarm.ts`、`components/**`、`app/(authed)/plan/**`，不要碰。

## 高
### L1 SSRF 守卫漏掉十六进制 IPv6（`lib/llm/handlers/validate.ts`）
`new URL('https://[::ffff:169.254.169.254]').hostname` 会被规范成 `[::ffff:a9fe:a9fe]`，`[::ffff:7f00:1]` 是回环，现有的点分四段匹配都放过了。改为：把 IPv6 展开成 8 组 16 位数值后判断：`::1`、`fc00::/7`、`fe80::/10`、`::ffff:0:0/96`（取低 32 位按 IPv4 规则判私网/回环/链路本地/CGNAT 100.64/10/`0.0.0.0`）、`::`。新建 `tests/llm/validate.test.ts` 覆盖 `[::1]`、`[fc00::1]`、`[fe80::1]`、`[::ffff:a9fe:a9fe]`、`[::ffff:7f00:1]`、`localhost`、`foo.internal`、`100.64.0.1`、`0.0.0.0`、`127.1`（URL 规范化后仍要拒）、以及合法 `https://api.openai.com` 通过；PUT 路径带坏 URL 也要 400。

### L2 出站请求禁止跟随重定向（`lib/llm/http.ts`）
`postJson` 加 `redirect: 'manual'`，3xx 一律抛 `LlmHttpError`（status 保留，body 写「上游返回重定向，已拒绝」）。测试：fetch 假件返回 302 → 抛错且不再发第二次请求。

## 中
### L3 密钥脱敏改为按明文替换（`lib/llm/handlers/adminProviders.ts` test 分支）
错误文案先 `message.split(apiKey).join('[redacted]')`（明文在作用域内），再走现有前缀正则；`lastTest.message` 同样脱敏后再落库。测试：fetch 假件返回 401 且 body 回显了 key（如 `AIzaXXXX…`）→ `result.message` 与落库的 `lastTest` 都不含该串。

### L4 `lastProviderUsage` 模块级全局改为按调用返回（`lib/planAgent/api.ts`、`app/api/me/plans/[id]/agent/route.ts` 只许改那一行的读法）
`createChatCompletion` 的返回消息上附 `provider?: { providerId, providerName, model, protocol }`（`PlanAgentChatMessage` 已是宽松类型，loop 落库时本就剥离非协议字段——确认 `loop.ts` 的剥离逻辑会去掉 `provider`，若不会则在 api.ts 返回前用 `Object.defineProperty` 设为不可枚举）；route 侧的 `withModelUsageInRunLog` 从最近一次返回值读取而不是模块变量。测试：两个并发调用注入不同供应商，各自的 usage 不串。

### L5 面板"当前接管"与运行时口径一致（`adminProviders.ts` 的 `effectiveOf`）
`effectiveOf` 增加 `&& row.apiKeyCiphertext` 条件；测试补一条：无 key 的接管供应商，`effective.agent` 为 null。

### L6 供应商路径的 429/5xx 重试与 env 路径对齐（`lib/planAgent/api.ts`）
`LlmHttpError` 且 status 为 429/408/5xx 视为可重试（与 `EmptyStreamError`/瞬时网络错误同列，仍受 `STREAM_MAX_ATTEMPTS`）；4xx 其他状态立即抛。测试：第一次 503 第二次 200 → 成功且 fetch 调用 2 次；400 → 只调用 1 次。

### L7 Anthropic 空文本块（`lib/llm/anthropicClient.ts`）
跳过空字符串的 text block；转换后 content 为空数组的消息整条丢弃（assistant 无文本无 tool_use、user 空文本）。测试：`{ role:'assistant', content: null }` 不产生消息；`{ role:'user', content:'' }` 不产生消息。

### L8 takeover 互斥清除放在写成功之后（`adminProviders.ts` PUT）
先 `repo.update`，返回 null → 404 且不清除其他供应商；成功后再 `clearTakeover(scope, id)`。测试：update 返回 null 时其他供应商 takeover 不变。

### L9 内化并发安全（`lib/llm/seed.ts`）
`create` 捕获 Prisma `P2002` 静默跳过；删掉无用的 `existingEnvKeys`。测试：repo 假件第二次 create 抛 `{ code:'P2002' }` → 不抛出。

## 低
### L10 密钥派生用 HKDF（`lib/llm/secretBox.ts`）
`sha256(secret)` 改为 Web Crypto `HKDF`（salt 固定字符串 `seichigo-llm-provider`，info `aes-256-gcm-v1`）；信封版本升为 `v2.`，解密时 `v1.` 仍按旧派生解（兼容已入库密文），加密只产 `v2.`。测试：v1 密文仍可解；v2 往返。

### L11 registry 缓存按 repo 实例隔离（`lib/llm/registry.ts`）
缓存 key 改为 `WeakMap<repo, Map<scope, entry>>`（缺省 repo 用单例）。测试补一条。

### L12 `callGemini` 里死掉的 `Rate limit` 短路（`lib/translation/gemini.ts`）
把 429 判定改成同时匹配 `Gemini API error (429)` 与 `LlmHttpError.status === 429`，保持"429 不再无限重试"的原意；`json` 降级重试只允许 1 次且不与外层重试相乘（openaiClient 内部在 400 且含 response_format 时只重发一次，外层看到的是最终结果）。

### L13 Anthropic `pause_turn`/`refusal` 映射（`anthropicClient.ts`）
`pause_turn` → `finish_reason: 'length'`（让循环层按预算耗尽处理继续），`refusal` → `'stop'` 且 content 至少为空串而不是 null。测试补两条。

### L14 SSE 分片测试（`tests/llm/openaiClient.test.ts`、`anthropicClient.test.ts`）
补「`data: {"cho` / `ices":…}\n\n` 跨 chunk 拆分」用例；补「缺 `LLM_PROVIDER_SECRET`/`NEXTAUTH_SECRET` 时 POST 返回 500 且 body 不含任何 secret 文本」。

完成标准：`npx vitest run tests/llm tests/planAgent tests/translation tests/admin` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报。
