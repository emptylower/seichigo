# 计划页第十一轮：可中断推理、404gemini 适配、思考内容口径、迷你地图点位卡（2026-09-04）

工作方式同前：先补失败测试再实现；**不要 git commit**；**不跑迁移**（本轮无 schema 改动）；`node scripts/check-line-budget.mjs` 必须通过（单文件 ≤ 750；`lib/planAgent/tools.ts` 749、`app/(authed)/plan/[id]/ui.tsx` 748、`DayCards.tsx` 644、`RoutePreviewMap.tsx` 675，新逻辑放新文件）。
- A（后端，glm-5.3）只碰 `lib/planAgent/**`、`lib/llm/**`、`lib/tripPlan/**`、`app/api/me/plans/[id]/agent/route.ts`、`tests/planAgent/**`、`tests/llm/**`、`tests/tripPlan/**`。
- B（前端，Claude Opus）只碰 `app/(authed)/plan/[id]/**`、`components/route/**`、`tests/plan/**`、`tests/route/**`。
两边并行、文件不相交。

## 取证（主会话，2026-09-04）

1. **404gemini 接管 Agent 报错**：用真实 `PLAN_AGENT_TOOLS` 直连 `https://api.codelife.eu.cc/v1/chat/completions`（模型 `gemini-3.8-flash-high`）复现 HTTP 400：
   ```
   tools[0].function_declarations[10]...properties[payload].properties[transport].properties[legs].items: missing field.
   ...properties[transport].properties[polyline].items: missing field.
   ```
   即 `save_plan_days` 的 schema 里 `legs`、`polyline` 是 `type:'array'` 但没有 `items`。Gemini 严格校验，DeepSeek/freecode 不校验所以其它供应商正常。去掉工具或只传前 3 个工具都 200。当时的运行日志：回合 1 只跑了 3 秒、没有 assistant 消息、`modelUsage` 为空，与 400 直接抛错一致。
2. **freecode 不显示思考内容**：对 freecode（`gpt-5.6-sol`）与 404gemini 分别用 `reasoning_effort`、`reasoning:{effort,summary}`、`include_reasoning`、`thinking:{enabled}`、`google.thinking_config` 五种参数探测，流式 delta 只有 `role/content/tool_calls`，**没有任何思考字段**。代码里 openai 协议只读 `delta.reasoning_content`（`lib/llm/openaiClient.ts:12-15`），DeepSeek 接管时能显示、切到 freecode 后消失，是供应商不输出而非解析回归。但解析确实有缺口：不认 `delta.reasoning`（OpenRouter/部分中转）、`reasoning_details`、`<think>` 标签。
3. **无法中断**：`ui.tsx` 没有停止按钮、`fetch` 不传 signal、服务端没有取消端点；若只是断开连接，服务端会按 `client_disconnected` 记 `interrupted`，页面回来后第八轮的自动续跑会把它续起来。所以"停止"必须是服务端可识别的一等语义。

## §0 契约（两边都按此实现）

- **停止请求**：`POST /api/me/plans/:id/agent` body `{ stop: true }` → 校验归属；若当前无 run（`agentBusy=false`）返回 `{ ok: true, stopped: false }`；否则调用 `repo.stopAgentRun(planId)`（清 `agentRunToken`/`agentBusyUntil`，并记录 `agentStopRequestedAt`（**不改 schema**：用现有 `TripPlanRunLive` 行写一个 `statusText: '__stop_requested__'`，或内存 Map+DB 行任选，但必须跨隔离体可见，所以用 `TripPlanRunLive` 行）返回 `{ ok: true, stopped: true }`。
- **服务端行为**：正在跑的 loop 在下一次 `renewLease`（每次模型/工具调用前）失败时结束（现有 `RunFencedError` 语义）；**模型流式期间**由租约看守每 2 秒检查一次，发现被停止就 `abort` 模型请求。结束路径：SSE 发 `{ type: 'stopped' }` 再发 `{ type: 'done' }`；运行日志 `stage: 'stopped'`；实况行清空。
- **停止后不自动续跑**：`inferInterrupted` / `canResume` 规则补充：最后一条运行日志 `stage === 'stopped'` 且其 `createdAt` 晚于最后一条 human 消息 → `interrupted = null`（即使尾部 assistant 带 tool_calls）。用户手动 `{ resume: true }` 仍允许（`canResume` 对 `stopped` 返回可续）。
- **模型信息事件**：每回合第一次模型调用结束后 SSE 发 `{ type: 'model_info', providerName, model, reasoning: boolean }`（`reasoning` = 该次调用是否收到过任何思考增量）。不落库。前端据此在思维链头部提示"当前模型不公开思考过程，仅显示工具进度"。
- **思考字段口径**（A2）：openai 协议把以下都视为思考增量：`delta.reasoning_content`、`delta.reasoning`（字符串）、`delta.reasoning_details[].text`；`delta.content` 中的 `<think>…</think>` 段剥离后作为思考增量（跨 chunk 状态机），其余作为正文。
- **点位卡数据**：`DayRoutePoint` 增加 `itemId`，DayMap 接收 `items: TripPlanDayView['items']`，前端自行按 `itemId` 找到条目取图/时间/说明；不新增接口。

## A. 后端（glm-5.3）

### A1 工具 schema 补 `items`（`lib/planAgent/tools.ts` → 新文件 `lib/planAgent/toolSchemas.ts`）
- 把 `PLAN_AGENT_TOOLS` 里 `save_plan_days` 的 `parameters` 对象整体搬到新文件 `toolSchemas.ts`（导出 `SAVE_PLAN_DAYS_PARAMETERS`），tools.ts 只 import（行数下降）。
- `transport.legs`：`items: { type: 'object', properties: { mode, durationMin, distanceKm, instruction, line, fromStop, toStop, numStops, headsign, departureTime, arrivalTime }, additionalProperties: true }`（按 `itemPayload.ts` 现有 leg 字段，类型宽松）；`transport.polyline`：`items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }`。
- 通用守卫 `assertToolSchemasGeminiSafe(tools)`（同文件）：递归检查每个 `type:'array'` 都有 `items`；测试 `tests/planAgent/toolSchemas.test.ts` 对 `PLAN_AGENT_TOOLS` 全量断言，并断言不含 `$schema`/`const`/`anyOf`（Gemini 不支持的关键字；若现有 schema 用到了，改成等价写法）。
- 验收由主会话用真实 404gemini 端点复测。

### A2 思考字段口径（`lib/llm/openaiClient.ts`，新文件 `lib/llm/reasoningExtract.ts`）
- `createReasoningExtractor()` 返回 `{ consume(delta): { reasoning?: string; content?: string } }`：实现 §0 口径（含 `<think>` 跨 chunk 状态机）。openaiClient 与 `lib/planAgent/api.ts` 的 env 路径都改用它。
- 测试 `tests/llm/reasoningExtract.test.ts`：`reasoning_content`、`reasoning`、`reasoning_details`、`<think>` 跨两个 chunk 切开、`</think>` 后正文照常、无 think 标签时 content 原样。

### A3 停止（`route.ts`、`lib/planAgent/loop.ts`、新文件 `lib/planAgent/stop.ts`、`lib/tripPlan/repo*.ts`）
- repo：`stopAgentRun(planId)`（条件更新：busy 置空、token 置空）+ `isAgentRunStopped(planId, token)`（token 已不匹配即视为停止）。
- `stop.ts`：`createLeaseWatcher({ check, intervalMs: 2000, onStopped })` → 返回 `{ start(signalController), stop() }`；loop 在每次模型调用前 start、调用后 stop；`check` 用 `isAgentRunStopped`；触发时 `abort(new DOMException('user_stopped','AbortError'))`。
- `lib/planAgent/api.ts` / `LlmChatInput.signal`：把 loop 传入的 signal 真正传到 `streamChat`（目前未传）。
- loop：捕获 `user_stopped` abort 或 `RunFencedError` 且停止标记存在 → `emit({type:'stopped'})`、`emit({type:'done'})`、运行日志 `stage:'stopped'`、实况行 `finish({flush:false, clear:true})`；不写 `interrupted`。
- route：解析 `{ stop: true }` 分支（§0）；`model_info` 事件由 loop 在第一次模型调用结束后 emit（`reasoningSeen` 由 onDelta 统计）。
- `lib/planAgent/resume.ts` + `lib/tripPlan/handlers/planById.ts`：§0 的"停止后不自动续跑"规则。
- 测试：`tests/planAgent/stop.test.ts`（看守 2 秒内触发 abort；stop() 后不再触发）；`tests/planAgent/loop.test.ts` 补「模型流式中被停止 → 事件序列 …, stopped, done，日志 stage=stopped」「停止后 canResume 仍为 true」；`tests/tripPlan/planById.live.test.ts` 补「最后日志 stopped 且尾部 assistant 带 tool_calls → interrupted=null」；route 测试补 `{stop:true}` 两种返回。

完成标准：`npx vitest run tests/planAgent tests/llm tests/tripPlan` 全绿；`npx tsc --noEmit` 无错；line-budget 通过；简短中文汇报。

## B. 前端（Claude Opus）

### B1 停止按钮（`ui.tsx` 已 748 行 → 新 hook `hooks/useAgentStop.ts`）
- busy 时发送按钮位置换成「停止」（方形停止图标）；点击 → `POST {stop:true}`，本地置 `stopRequested`；流里收到 `stopped` → 思维链状态置「已停止」，横幅「已停止本轮规划」+「继续」按钮（复用 `resumeBanner:'manual'` 的样式与 `{resume:true}` 逻辑）；同时把 `sessionStorage['planAutoResume:'+planId]` 记为已消费，保证不自动续跑。5 秒内没收到 `stopped` 则本地 abort fetch 并按上述处理（服务端最终也会停）。
- 测试 `tests/plan/agent-stop.test.tsx`：busy 时出现停止按钮；点击发出 `{stop:true}`；收到 `stopped` 后横幅出现且不触发 `{resume:true}`。

### B2 思考内容口径提示（`ThinkingChain.tsx`、`ui.tsx`）
- 处理 `model_info` 事件：`reasoning === false` 时思维链头部显示一行灰字「当前模型（{providerName} · {model}）不公开思考过程，这里只显示工具进度」；`true` 时不显示。刷新恢复路径（`live`）没有该信息则不显示。
- 测试补一条。

### B3 迷你地图点位卡（新文件 `components/DayPointCard.tsx`；`DayMap.tsx`、`dayRouteGeometry.ts`、`DayMapExpanded.tsx`）
- `DayRoutePoint` 加 `itemId`；`DayMap` 新增 prop `items`，`renderPopup(id)` 改为把一个容器交给 React（`createRoot` 到 popup 容器，关闭时 `unmount`；或在 DayMap 内用 `createPortal` 渲染到 popup 的 DOM 节点——二选一，注意 StrictMode 双挂载与卸载时序）。
- 卡片内容（移动端小卡风格，宽 240–280px）：16:10 封面图（阶梯与 DayCards 一致：`media.displayUrl` → `item.point.image` → `/api/google/point-photo?pointId=`，经 `ResilientMapImage kind="point-thumbnail"`，`loading="eager"`）、标题、时间 chip（`schedule.start–end`）、一句说明（`reason ?? note`，两行截断）、三个动作：「查看条目」（现有 `onRequestShowItem`）、「导航」（`buildPointNavigationUrl`）、「实景」（Google 街景外链 `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=<lat>,<lng>`；若 `features/map/anitabi/media.ts` 的 `resolvePanoramaEmbed` 可无依赖复用，则改为页内全景浮层，优先外链保证本轮可交付）。右上关闭。
- 展开态（`DayMapExpanded`）同样使用该卡片。
- 地图 Popup 的 `maxWidth` 设为 `'300px'`，`offset` 适配 marker 半径；卡片打开时对应列表条目仍高亮（现有 `activePointId`）。
- 测试 `tests/plan/dayPointCard.test.tsx`：给定条目渲染图片候选、标题、时间、三个动作 href/回调；`tests/plan/dayCards.test.tsx` 补：mock 的 RoutePreviewMap 触发 `renderPopup(id)` 返回的容器里包含点位标题与「查看条目」。

完成标准：`npx vitest run tests/plan tests/route` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报（改动文件、行数、新增测试）。

## 主会话验收
- 用真实 404gemini 端点 + `PLAN_AGENT_TOOLS` 直连 200（A1）。
- 预览上把 404gemini 设为接管，跑一轮短对话不再报错；切回 freecode。
- freecode 接管时思维链头部出现"不公开思考过程"提示；DeepSeek 接管时不出现且有思考文本。
- 规划进行中点「停止」：3 秒内思维链变「已停止」，页面刷新后不会自动续跑，横幅有「继续」且可续。
- 快照地图点 marker 弹出带图片的点位卡，三个动作可用，「查看条目」跳回列表高亮。

## A2 补充：Gemini 官方 OpenAI 兼容端点的思考回显（主会话实测 2026-09-04）

实测（用库里 Google 官方 Gemini 密钥直连 `generativelanguage.googleapis.com/v1beta/openai/chat/completions`）：
- 请求带 `extra_body: { google: { thinking_config: { include_thoughts: true, thinking_level: 'high' } } }` 时，2.5-flash 与 3.8-flash 都会回传思考摘要：摘要作为**普通 `delta.content` 增量**，同一 chunk 带 `delta.extra_content.google.thought === true`，文本包在 `<thought>…</thought>` 里（`</thought>` 可能出现在正文第一个 chunk 的开头），先思考后正文。3.8 在简单问题上可能不给摘要，只给 `extra_content.google.thought_signature`。
- `reasoning_effort` 与 `thinking_config` 同时传 → 400；`thinking_summaries` 不是兼容层字段。
- 404gemini 中转（`api.codelife.eu.cc`）把 `extra_content` 整个剥掉，思考回显做不到；freecode 同样无思考字段。

实现（`lib/llm/openaiClient.ts`、`lib/llm/reasoningExtract.ts`，新文件 `lib/llm/geminiCompat.ts`）：
1. `isGoogleGeminiOpenAiEndpoint(endpointUrl)`：host 为 `generativelanguage.googleapis.com` 时返回 true。此时 `streamChat` 请求体追加 `extra_body: { google: { thinking_config: { include_thoughts: true } } }`（不带 `thinking_level`，沿用模型默认；**不**带 `reasoning_effort`）。其它 host 不加任何额外字段。
2. `createReasoningExtractor().consume(delta)` 增加两条规则：`delta.extra_content?.google?.thought === true` 时该 `content` 归入思考；`content` 中的 `<thought>…</thought>` 与 `<think>…</think>` 同样做跨 chunk 剥离（剥离后的正文不含标签）。
3. 累积回来的 assistant 消息（`streamChat` 返回值）里 `content` 不含思考文本，`reasoning_content` 含思考文本（现有字段语义）。
4. 测试 `tests/llm/geminiCompat.test.ts`：host 判定；请求体只对 Google host 追加 `extra_body`；`tests/llm/reasoningExtract.test.ts` 补：`thought:true` 标记、`<thought>` 跨 chunk、`</thought>` 位于正文 chunk 开头。
