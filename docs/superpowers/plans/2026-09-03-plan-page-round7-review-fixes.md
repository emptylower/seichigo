# 第七轮后端审查修复（2026-09-03）

背景：第七轮 A1–A5 已实现并全绿，审查发现以下问题。工作方式同前：每条先补失败测试再改；**不要 git commit**；**不跑迁移**；只碰 `lib/planAgent/runLive.ts`、`lib/planAgent/loop.ts`、`lib/tripPlan/handlers/planById.ts`、`lib/tripPlan/{repo,repoPrisma,repoMemory}.ts`、`lib/llm/handlers/{validate,adminProviders,discoverModels}.ts`、`lib/llm/discover.ts`、`lib/llm/seed.ts`、`tests/planAgent/**`、`tests/tripPlan/**`、`tests/llm/**`。前端（`app/(authed)/**`、`components/**`、`tests/plan/**`、`tests/admin/**`）有人并行在改，不要碰。

## 中
### M1 finish 不能拖住 SSE 收尾（`loop.ts`、`runLive.ts`）
`finally` 里 `await writer.finish()` 无超时，库慢时会拖住 `done` 事件。改为 `await Promise.race([writer.finish(...), sleep(2000)])`；超时后 finish 继续在后台完成（浮动 promise，失败只 warn）。测试：注入 5 秒才 resolve 的 repo，run 在 2.5 秒内收到 `done`。

### M2 被接管（fenced）的 run 不要再 flush（`runLive.ts`、`loop.ts`）
`finish({ flush: false, clear: false })`：fenced 时只取消定时器、丢弃未刷新的增量，不写库（否则旧 run 会用自己的 token 覆盖新 run 的实况行）。改掉 `tests/planAgent/runLive.test.ts` 里断言"旧 run 覆盖"的用例为"fenced 不写"。

### M3 chatRevision 必须单调（`planById.ts`）
同毫秒多条消息不会推进。改为 `chatRevision = messages.length * 1e14 + lastCreatedAtMs`（或同时返回 `chatCount`；契约里 `chatRevision` 保留）。测试：两条同毫秒消息 → 第二次 revision 大于第一次。

### M4 URL 归一：非空路径只追加后缀（`validate.ts`、`seed.ts`）
规则改为：路径为空或 `/` → `/v1/chat/completions`（anthropic `/v1/messages`）；路径以 `/chat/completions`（anthropic `/messages`）结尾 → 原样；否则**只追加** `/chat/completions`（anthropic `/messages`），不再插入 `/v1`。这样 `https://generativelanguage.googleapis.com/v1beta/openai` → `…/v1beta/openai/chat/completions`，`https://x/v1` → `…/v1/chat/completions`，`https://relay/api` → `…/api/chat/completions`。比较用小写；去掉尾部 `/`；保留端口与 query。seed 的 DeepSeek `baseUrl` 写 `PLAN_AGENT_BASE_URL || 'https://api.deepseek.com'`，归一后为 `…/chat/completions`（与现网一致，不再变成 `/v1/chat/completions`）；Gemini 写 `https://generativelanguage.googleapis.com/v1beta/openai`。测试补：上述五种输入 + 大写 `/V1` + 带端口 + 已完整的 anthropic URL。模型发现的 models URL 同样由归一后的 endpoint 替换最后一段得到（`…/v1beta/openai/models`）。

## 低
### L5 不回传 `live.runToken`（`planById.ts` + 契约）：服务端已做匹配，字段删掉；前端不依赖它。
### L6 `baseUrl` 入库前清洗（`adminProviders.ts`）：`new URL(baseUrl)` 后去掉 username/password，存 `origin + pathname + search`。
### L7 `normalizeEndpointUrl` 内部调用 https/私网守卫（`validate.ts`），避免被绕过。
### L8 `planById` 见 `agentBusy === false` 且实况行存在时顺手 `clearRunLive`（失败只 warn）。
### L9 `discover.ts` 响应体限长（2 MB，超出按失败处理）。

## 测试补充
- `tests/tripPlan/runLive.prisma.test.ts`：用 Prisma client mock 断言 `toolCalls` 缺省写 `DbNull`、同 run 用 upsert、不同 run 重置。
- `normalizeEndpointUrl` 新用例见 M4。

完成标准：`npx vitest run tests/planAgent tests/tripPlan tests/llm tests/admin` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报。
