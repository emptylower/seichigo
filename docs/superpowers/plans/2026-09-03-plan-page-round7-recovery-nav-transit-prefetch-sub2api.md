# 计划页第七轮：刷新恢复、导航、标题栏、图片预热、交通详情抽屉、sub2api 适配（2026-09-03）

工作方式同前：先通读现状；每条先补失败测试再实现；**不要 git commit**；**不跑数据库迁移**（迁移文件只写不跑，`npx prisma generate` 可以跑）；`node scripts/check-line-budget.mjs` 必须通过（新逻辑放新文件；`ui.tsx`、`DayCards.tsx` 如接近 750 行就拆组件）。

- A（后端，glm-5.3）只碰 `lib/planAgent/**`、`lib/tripPlan/**`、`lib/llm/**`、`app/api/**`、`prisma/**`、`tests/planAgent/**`、`tests/tripPlan/**`、`tests/llm/**`。
- B（前端，kimi k3）只碰 `app/(authed)/plan/**`、`app/(authed)/admin/llm/**`、`components/map/**`、`tests/plan/**`、`tests/admin/llm-*.test.tsx`、`tests/map/**`。
- A/B 并行，契约见 §0。

## 用户回归反馈（预览 79dd53f6）
1. 规划进行中刷新网页：只剩"正在规划/规划师思考中"，思考内容不显示；规划结束后 daymap 等组件也没有出现。
2. 聊天式改造后没有导航栏，回不到网站其它页面。
3. 对话上方标题栏是透明毛玻璃，改成白底。
4. 图片修复效果明显，但点开某一天才开始加载；agent 确定 daymap 时就应该后台预热到浏览器。
5. 交通信息只显示时间，浪费了拿到的完整方案：要做抽屉——摘要"乘车 xx 分钟 / 步行 xx 分钟 / 先乘车再步行"，展开是逐步导航指引；拿不到方案的兜底并告诉用户去哪查。
6. 导入的 sub2api 网关供应商不知道完整 URL 后缀，没测通；要适配 sub2api：填 URL 与 key 一键拉取可用模型并填好。

## 现状（探索结论，行号见探索报告）
- 刷新恢复：`ui.tsx` 挂载时若 `agentBusy` 进入 `enterRunRecovery('in-progress')`，每 3 s `GET /api/me/plans/:id`，`setPlan` 并只追加 `body.chat` 中序号 ≥ `serverEntryCountRef` 的条目；思考内容（`reasoning` 事件）在 `lib/planAgent/loop.ts` 明确"仅 SSE，不落库"，因此刷新后无从恢复；`ThinkingChain` 只在 `busy && active` 时显示空壳。
- 导航：`ui.tsx` 设了 `data-layout-immersive`，`styles/globals.css` 据此隐藏站点 Header/Footer；`PlanSidebar` 顶部只有"新建对话"。站点导航在 `components/layout/HeaderPublic.tsx`（/plan、/map、/、/city、社区、语言、账户）。
- 标题栏：`ui.tsx` L373 `sticky top-0 z-10 bg-transparent backdrop-blur-sm`。
- 图片：`DayCards` 只挂载 `active` 那一天的图；`ResilientMapImage` 固定用 `interaction-critical` 通道；调度器已有 `warmup` 低优先级通道；`mapImageLoadedCache.rememberLoadedMapImage` 可标记已加载。
- 交通：`payload.transport.legs[]` 已含 `{mode, durationMin, distanceKm, instruction, line, fromStop, toStop, numStops, departureTime, arrivalTime}`（`travelQuery.ts summarizeLegForModel`；`googleClient` 还有 `headsign` 但被丢弃），`sanitizeTransportPayload` 保留这些；前端 `getTransport` 丢掉 `departureTime/arrivalTime/note`，`TransitConnectorRow` 只渲染一行摘要 + 地图链接。估算载荷 `provider:'estimate'`、`legs:[]`、`mapsUrl`、`note`。
- LLM 面板：`endpointUrl` 必须是完整请求 URL，服务端原样 POST；没有 `/v1/models` 拉取。sub2api（https://github.com/Wei-Shaw/sub2api）：基地址 `https://<host>/v1`，OpenAI 兼容 `/v1/chat/completions`、`/v1/models`、`/v1/responses`；Anthropic 兼容 `/v1/messages`；鉴权 `Authorization: Bearer <key>`。

---

## §0 A/B 契约

1. **运行实况**：`GET /api/me/plans/:id` 在 `agentBusy === true` 时额外返回
   ```ts
   live?: { runToken: string; reasoning: string; statusText: string | null; toolCalls: Array<{ name: string; status: 'running' | 'done' | 'error'; summary?: string }>; updatedAt: string }
   ```
   run 结束后为 `null`/缺省。`reasoning` 上限 20,000 字符（超出保留末尾）。
2. **交通载荷补充字段**（均可选）：`legs[i].headsign?: string`；`transport.note?: string`；`transport.source?: 'google' | 'heuristic' | 'japan-fallback'`。前端 `getTransport` 必须透传 `departureTime`、`arrivalTime`、`headsign`、`note`、`source`、`walkMin`、`transfers`。
3. **供应商 URL**：`LlmProviderView` 增加 `baseUrl: string`（用户输入，可为基地址）与 `endpointUrl: string`（服务端归一后的完整请求 URL，只读展示）。POST/PUT 接受 `baseUrl`（`endpointUrl` 兼容旧客户端，二者取其一）。归一规则见 A5。
4. **模型发现**：`POST /api/admin/llm/providers/discover-models` body `{ baseUrl: string; protocol: 'openai' | 'anthropic'; apiKey?: string; providerId?: string }`（`apiKey` 省略时用 `providerId` 已存的 key）→ `{ ok: true, models: Array<{ name: string; contextLength: number | null; ownedBy?: string }>, endpointUrl: string }`；失败 HTTP 200 `{ ok: false, message }`。
5. **图片预热**：B 在客户端做，A 不参与；用 `getMapDisplayImageCandidates(url, { kind: 'point-thumbnail' })[0]` 与 Google 图的相对 URL。

---

## A. 后端（glm-5.3）

### A1 运行实况落库（新表 `TripPlanRunLive`；`lib/tripPlan/{repo,repoPrisma,repoMemory}.ts`；`lib/planAgent/loop.ts`；新文件 `lib/planAgent/runLive.ts`；`lib/tripPlan/handlers/planById.ts`）
- schema：
  ```prisma
  model TripPlanRunLive {
    planId     String   @id
    runToken   String
    reasoning  String   @db.Text
    statusText String?
    toolCalls  Json?
    updatedAt  DateTime @updatedAt
    plan       TripPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  }
  ```
  迁移 `prisma/migrations/20260903010000_add_trip_plan_run_live/migration.sql`（只写不跑；`TripPlan` 补反向关系字段）。
- repo：`upsertRunLive(planId, patch: { runToken; reasoningAppend?: string; reasoningReplace?: string; statusText?; toolCalls? })`、`getRunLive(planId)`、`clearRunLive(planId)`；内存实现同语义；`reasoning` 超 20,000 字符截头保尾。
- `runLive.ts`：`createRunLiveWriter({ repo, planId, runToken, flushIntervalMs = 1500, flushChars = 400 })`：`onEvent` 收 `reasoning`（累积）、`status`（statusText）、`tool_call`（toolCalls 列表状态）事件，按时间/字数阈值节流 `upsertRunLive`；`finish()` 强制 flush 后 `clearRunLive`。写库失败只 warn。
- `loop.ts`：run 开始创建 writer，`onEvent` 旁路调用（不改变 SSE 行为），finally 里 `await writer.finish()`（在写 run log 之前）；被 fenced 的 run 也要 `finish()`（不 clear——由接管的新 run 覆盖）。
- `planById.ts`：`agentBusy` 为 true 时附带 `live`（`getRunLive`，`runToken` 匹配 `plan.agentRunToken` 才返回，否则 null）。
- 测试：`tests/planAgent/runLive.test.ts`（节流：连续 10 个 reasoning 事件 1 次 upsert；finish 强制 flush 并 clear；截尾）；`tests/planAgent/loop.test.ts` 补「run 期间 upsertRunLive 被调用、结束后 clearRunLive」；`tests/tripPlan/**` 补 repo 用例；`tests/tripPlan/planById*.test.ts` 补 busy 时返回 live、token 不匹配返回 null。

### A2 刷新后 chat 完整同步的服务端配合（`lib/tripPlan/handlers/planById.ts`）
- 响应增加 `chatRevision: number`（= 消息总数或最后一条消息的 createdAt 毫秒），供前端判断是否需要整体替换列表；无其他改动。前端 B1 使用。

### A3 交通字段补齐（`lib/planAgent/travelQuery.ts`、`lib/planAgent/enrich/heuristicTransit.ts`、`lib/planAgent/travelHelpers.ts`）
- `summarizeLegForModel` 透传 `headsign`；真实路线载荷加 `source: 'google'`；日本兜底加 `source: 'japan-fallback'`；估算加 `source: 'heuristic'`（已有）。`sanitizeTransportPayload` 不动（已保留这些字段）。
- 测试：`tests/planAgent/travelQuery*.test.ts` 补 headsign 与 source。

### A4 供应商 URL 归一 + 模型发现（`lib/llm/handlers/validate.ts`、`lib/llm/handlers/adminProviders.ts`、新文件 `lib/llm/discover.ts`、`lib/llm/handlers/discoverModels.ts`、新路由 `app/api/admin/llm/providers/discover-models/route.ts`、`prisma/schema.prisma` 的 `LlmProvider` 加 `baseUrl String?`（迁移并入 A1 的迁移文件）、`lib/llm/repo*.ts`、`lib/llm/seed.ts`）
- `normalizeEndpointUrl(protocol, baseUrl)`（放 `validate.ts`）：去掉尾部 `/`；openai：路径已以 `/chat/completions` 结尾 → 原样；以 `/v1` 结尾 → 追加 `/chat/completions`；其他 → 追加 `/v1/chat/completions`。anthropic：以 `/messages` 结尾 → 原样；以 `/v1` 结尾 → `/messages`；其他 → `/v1/messages`。保留 query（少见）。仍走 `validateEndpointUrl` 的 https/私网守卫。
- POST/PUT：接受 `baseUrl`（缺省用 `endpointUrl` 当 baseUrl），存 `baseUrl` 与归一后的 `endpointUrl`；`toProviderView` 输出两者；seed 的两条内置供应商 `baseUrl` 写完整 URL（归一后不变）。
- `discover.ts`：`discoverModels({ protocol, baseUrl, apiKey, fetchImpl, timeoutMs = 15_000 })`：models URL = 把归一后的 endpointUrl 的最后一段（`/chat/completions` 或 `/messages`）换成 `/models`（sub2api、OpenAI、DeepSeek、Gemini OpenAI 兼容端点、Anthropic 都是 `…/v1/models`）；openai 用 `Authorization: Bearer`，anthropic 用 `x-api-key` + `anthropic-version: 2023-06-01`；`redirect: 'manual'`；解析 `data[].id`（OpenAI 形）或 `data[].id`/`models[].name`（兼容），`contextLength` 取 `context_length` / `context_window` / `max_context_length` 任一数字字段，否则 null；去重、按名排序、上限 200。
- handler：管理员会话；`providerId` 给出且 `apiKey` 缺省时解密已存 key；URL 守卫同建；错误文案脱敏（复用 test 的 redact）。
- 测试：`tests/llm/validate.test.ts` 补归一用例（`https://x/v1` → `…/v1/chat/completions`；`https://x` → `…/v1/chat/completions`；`https://x/v1/chat/completions` 不变；anthropic 同理）；新建 `tests/llm/discover.test.ts`（sub2api 形 `/v1/models` 响应 → 列表；401 → `ok:false` 且 message 不含 key；anthropic 头正确）；`adminProviders.test.ts` 补 `baseUrl` 入库与视图。

### A5 连通测试可见输出（`lib/llm/handlers/adminProviders.ts`）
- 测试请求 `max_tokens` 8 → 64，`sample` 取前 40 字；推理模型 content 为空时 `sample` 显示 `(仅推理无正文)`。

### A 完成标准
`npx vitest run tests/planAgent tests/tripPlan tests/llm tests/admin` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报（含迁移文件名）。

---

## B. 前端（kimi k3）

### B1 刷新恢复（`app/(authed)/plan/[id]/ui.tsx`、`components/ThinkingChain.tsx`；如需拆出 `hooks/useRunRecovery.ts`）
- 轮询时读取 `body.live`：有则把 `activeThinking` 设为 `{ reasoning: live.reasoning, status: live.statusText, toolCalls: live.toolCalls }`，ThinkingChain 显示实况文本（与流式一致的展示组件，不再是空壳）；`live` 为空且仍 busy 时显示"规划师思考中…"。
- 轮询到 `idle`（或 `chatRevision` 变化）时**整体重拉** `body.chat` 并替换本地列表（以服务端为准；本地尚未落库的流式文本不再存在，因为刷新后没有本地流），daymap 按 `revisionId` 去重；`setPlan(body.plan)`。修掉"只追加序号大于计数的条目"这条脆弱逻辑。
- 测试 `tests/plan/plan-timeline.test.tsx`：挂载时 `agentBusy=true` 且 mock 轮询依次返回「busy + live.reasoning」→ 页面出现该文本；再返回「idle + chat 含 daymap + assistant」→ 出现 daymap 卡与文本，横幅消失。

### B2 导航（`PlanSidebar.tsx`、`ui.tsx`）
- 侧栏顶部加站点区：站点名/Logo 链接 `/`，下面一行紧凑导航：`地图 /map`、`文章 /`、`城市 /city`、`我的 /me`（图标 + 文字，`text-xs`），再是"新建对话"。移动端抽屉同样。
- 标题栏右侧的"更多"按钮改为"回到网站"（`Home` 图标，`href="/"`），`window.alert` 占位删掉。

### B3 标题栏白底（`ui.tsx`）
- `sticky top-0 z-10 bg-white border-b border-gray-100`，去掉 `backdrop-blur-sm`；移动端同样。

### B4 图片预热（新文件 `app/(authed)/plan/[id]/hooks/usePlanImagePrewarm.ts`，`ui.tsx` 接线；`components/map/ResilientMapImage.tsx` 可选加 `lane` prop）
- 触发：`plan.days` 变化（`setPlan` 后）与 `daymap` 事件到达时。
- 收集：所有天的非 transit 条目：`payload.media.displayUrl`（相对路径原样）与站内点位 `point.image` 的 `getMapDisplayImageCandidates(url, { kind: 'point-thumbnail' })[0]`；去重；上限 120 张；已在 `hasLoadedMapImage` 的跳过。
- 执行：通过 `acquireMapImageRequestSlot({ lane: 'warmup' })` 限流，用 `new Image()` 加载，`onload` 调 `rememberLoadedMapImage(url)`；组件卸载或 plan 再次变化时取消未开始的。
- 效果：切换到别的天时 `ResilientMapImage` 命中已加载缓存直接渲染。
- 测试 `tests/plan/usePlanImagePrewarm.test.tsx`：mock `Image` 记录 src；3 天各 2 张 → 6 次；已缓存的跳过；上限截断。

### B5 交通详情抽屉（`DayCards.tsx` 的 `TransitConnectorRow` 拆到新文件 `components/TransitConnector.tsx`；`itemPayload.ts`）
- `getTransport` 透传 §0.2 的字段。
- 摘要行（折叠态）：根据 `legs` 归并连续同类步骤生成中文摘要：全步行 → `步行 12 分钟`；全乘车 → `乘车 25 分钟（换乘 1 次）`；混合 → `先步行 5 分钟，再乘车 18 分钟，最后步行 3 分钟`（最多三段，多段合并为"乘车 xx 分钟，含换乘 n 次"）；`legs` 为空的估算载荷 → `约 20 分钟 · 参考估算`。右侧小箭头，整行可点击展开。
- 展开态：逐步列表，每步一行：图标 + 文案——步行：`步行 5 分钟（400 m）· <instruction>`；乘车：`乘 <line>（往 <headsign>）· <fromStop> → <toStop> · <numStops> 站 · 12 分钟`，有时间则附 `09:12 发 – 09:24 到`；自驾同步行格式。末尾一行 `总计 xx 分钟 · x.x km` + `在 Google 地图打开` 链接（`mapsUrl` 有则用，否则用起终点坐标拼 `https://www.google.com/maps/dir/?api=1&origin=lat,lng&destination=lat,lng&travelmode=transit`——起终点坐标从前后条目取，`DayCards` 传入）。
- 估算/兜底载荷展开态：显示 `note` 文案（如「日本公交线路暂无法查询，以下为参考估算」）+ 同上 Google 地图链接，并提示"到达当地后可用 Google 地图 / Yahoo!乗換案内 查询实时路线"。
- 无障碍：按钮 `aria-expanded`；默认折叠；同一天最多记住展开状态到组件卸载。
- 测试 `tests/plan/transitConnector.test.tsx`：三种载荷（纯步行、混合含 headsign 与时间、估算）折叠摘要文案与展开内容；点击展开/收起。

### B6 sub2api 适配前端（`app/(authed)/admin/llm/ProviderForm.tsx`、`validation.ts`、`types.ts`、`ui.tsx`）
- "请求完整 URL" 改为 "接口地址"：提示 `填基地址即可，如 https://your-sub2api.example.com/v1，系统自动补全 /chat/completions 或 /v1/messages`；表单提交 `baseUrl`；表单下方只读显示服务端归一后的 `endpointUrl`（编辑态从视图读；新建态由前端按 A4 同规则本地预览）。
- 模型区加"拉取模型列表"按钮：POST `/api/admin/llm/providers/discover-models`（新建态带 `apiKey`，编辑态带 `providerId`；两者都无 key 时按钮禁用并提示）；成功后把返回模型合并进行列表（已存在的行保留用户填的上下文长度，新行 `contextLength` 用返回值或 128000），显示"已拉取 N 个模型"；失败显示 message。
- 卡片显示 `baseUrl`，hover/次行显示归一后的 endpoint。
- 测试 `tests/admin/llm-page.test.tsx` 补：点击拉取 → 发 POST 且 body 含 baseUrl/protocol/apiKey；返回 3 个模型后行数为 3；基地址 `https://x/v1` 预览 endpoint 为 `…/v1/chat/completions`。

### B 完成标准
`npx vitest run tests/plan tests/admin tests/map` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报。

---

## C. 主会话验收
1. 迁移应用到开发库与 Neon（经用户确认）；构建预览。
2. 用管理员账号在预览发起一次 agent 对话，10 秒后用另一会话 `GET /api/me/plans/:id` 断言 `live.reasoning` 非空；run 结束后 `live` 为空且 chat 含 daymap。
3. 预览 HTML：标题栏类名含 `bg-white` 不含 `backdrop-blur`；侧栏含 `/map`、`/city` 链接。
4. 用 sub2api 形状的假网关（本地 vitest 已覆盖）+ 真实 DeepSeek 基地址 `https://api.deepseek.com` 调 discover-models，预期返回 `deepseek-v4-flash` 等；用 `https://api.deepseek.com/v1` 也应归一到同一 endpoint。
5. 交通抽屉：读取一份真实计划的 transit 条目，核对摘要与展开文案（jsdom 测试 + 预览页面 HTML 中出现"先乘车"/"步行" 摘要与 `aria-expanded`）。
