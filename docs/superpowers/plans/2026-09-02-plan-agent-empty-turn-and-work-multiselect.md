# plan agent · 空回合静默结束 + 作品选择卡多选（修复简报，2026-09-02）

工作方式：先 `git status` / `git diff` 通读现状（工作树里已有一组未提交的地点库改动，不要动它们）；每条先补失败测试再改实现。不要 git commit。A、B 两部分由不同代理并行执行，文件互不重叠：A 只碰 `lib/planAgent/**` 与 `tests/planAgent/**`；B 只碰 `app/(authed)/plan/[id]/**` 与 `tests/plan/**`。

## 背景（已用真实数据复现）

- 规划模型 `deepseek-v4-flash` 是推理模型，`reasoning_content` 计入 completion 预算。对一条真实卡住的计划回放最后一轮请求：`max_tokens=8192` 时 `finish_reason=length`，8192 个 completion token 全是 reasoning，正文 0 字、工具调用 0 个；`max_tokens=16384`（`lib/planAgent/api.ts` 当前默认值，生产未设置 `PLAN_AGENT_MAX_TOKENS`）时 reasoning 10850、成功产出 19 个工具调用。即这一轮的 reasoning 在预算边界附近浮动，部分运行会把预算吃光、什么都不产出。
- 此时 `lib/planAgent/loop.ts` 里 `if (!toolCalls.length) break` 把"空回合"当作正常结束：落一条空 assistant 消息、不发任何 text 事件、循环退出。用户界面上没有任何输出；重试再撞边界仍然为空。
- `lib/planAgent/api.ts` 的 `attemptStreamOnce` 只累积 content / tool_calls / reasoning，没有捕获 `finish_reason`，循环无从判断"是模型主动结束还是被截断"。
- 作品选择卡：`app/(authed)/plan/[id]/components/AskCard.tsx` 里 `ChoiceAsk` 的 `multiple` 只看 `payload.kind === 'multi_choice'`；模型发 `single_choice` 时点一下卡片 180ms 后自动提交，没有底部提交按钮。用户要求作品选择始终可多选、底部有提交按钮。
- 重试按钮：`app/(authed)/plan/[id]/ui.tsx` 第 109/178 行对"结构化答复轮"（带 answerTo）把 `retryMessage` 置为 undefined，出错后没有重试入口；且任何路径都不能向 `/api/me/plans/[id]/agent` 发送空 message（服务端会 400 "消息不能为空"）。

---

## A. 后端（glm-5.3）

### A1 `lib/planAgent/api.ts`：预算与 finish_reason

1. `MAX_OUTPUT_TOKENS` 默认值 16384 → 32768（保留 `PLAN_AGENT_MAX_TOKENS` 环境变量覆盖）。先用 `.env.local` 里的 `PLAN_AGENT_API_KEY`/`PLAN_AGENT_BASE_URL`/`PLAN_AGENT_MODEL` 写一个一次性脚本（放 scratch/，不入库）发一条极短请求验证 `max_tokens: 32768` 被 DeepSeek 接受（非 400）；若被拒绝，改用被接受的最大值并在汇报里写明。脚本不得打印 key。
2. `attemptStreamOnce` 里记录每个 chunk 的 `choice.finish_reason`（最后一个非空值），随返回的 message 一起带出：返回类型扩为 `ChatCompletionMessage & { reasoning_content?: string; finish_reason?: string | null }`。`CreateMessageFn` 的返回类型同步放宽（存量 mock 仍可赋值）。
3. 测试 `tests/planAgent/api*.test.ts`（若无则新建，参考现有对 `createChatCompletion` 的 mock 方式）：流末尾 `finish_reason: 'length'` 时返回值带 `finish_reason === 'length'`。

### A2 `lib/planAgent/loop.ts`：空回合不再静默结束

定义空回合：`toolCalls.length === 0` 且正文为空（`typeof content !== 'string' || !content.trim()`）。处理顺序放在现有 ask_user 协议守卫之后、落库之前：

- 第一次遇到空回合（`emptyTurnRetried === false`）：不落库这条空 assistant、不发 text 事件；向内存 `messages` 追加一条 `{ role: 'user', content: EMPTY_TURN_RETRY_INSTRUCTION }` 并 `continue`。文案（导出常量，放 `lib/planAgent/protocolGuard.ts` 或新建 `lib/planAgent/emptyTurn.ts`）：
  `你上一轮没有输出任何文字或工具调用（输出预算已被思考耗尽）。请大幅缩短思考，直接给出下一步：要么发起工具调用（本轮不超过 5 个），要么用一两句话回复用户。`
  同时发一条已有类型的遥测事件告知前端正在重试（查看 `PlanAgentEvent` 里现有的 `status` 事件形状，用它；不要新增事件类型）。
- 第二次仍为空：发 `{ type: 'error', message: EMPTY_TURN_ERROR_MESSAGE }` 并 `break`，不落库空 assistant。文案：
  `模型这一轮的思考超出了输出预算，没有产出内容。请再发一条消息继续；如果行程很大，可以先让我只排前几天。`
- `finish_reason === 'length'` 但带有工具调用的情况（参数可能被截断）保持现状：由工具执行器的 JSON 解析报错回传给模型，不在本次范围。
- 测试 `tests/planAgent/loop.test.ts`（沿用文件内的 mock repo / createMessage 写法）：
  1. createMessage 依次返回 [空消息, 空消息] → 事件里有且只有一条 `error`（文案为 EMPTY_TURN_ERROR_MESSAGE），repo 上没有落任何 content 为空且无 tool_calls 的 assistant 行，第二次调用的 messages 末尾是 EMPTY_TURN_RETRY_INSTRUCTION 的 user 消息；
  2. 依次返回 [空消息, 带 tool_calls 的消息] → 正常执行工具，没有 error 事件；
  3. 原有用例全部不回归。

### A3 `lib/planAgent/prompt.ts`：减轻单轮负担

在"要点"区追加一条（不改第 4 步语义）：
`- 每轮工具调用不超过 8 个；外部地点解析分批进行（每轮最多 5 个 resolve_place），先解析地点、再查交通、最后一次性保存。不要试图在一轮思考里把整份行程全部想完。`
若 `tests/planAgent` 里有提示词断言用例，同步更新。

完成标准：`npx vitest run tests/planAgent tests/googlePlaces` 全绿；`npx tsc --noEmit` 无错；汇报里写明 32768 是否被 DeepSeek 接受。

---

## B. 前端（kimi k3）

### B1 `app/(authed)/plan/[id]/components/AskCard.tsx`：作品选择卡始终多选

- `ChoiceAsk`（只服务 taskType=work_selection）无论 `payload.kind` 是 single_choice 还是 multi_choice，都按多选交互：点击卡片切换选中态（不再自动提交），底部常驻栏显示"已选 N 项"与"确认"按钮，未选时按钮禁用。删除 `pickSingle` 的自动提交逻辑（意见卡 `OpinionChoiceAsk` 不改）。
- 提交时保持后端答复形状契约：`payload.kind === 'single_choice'` 且恰好选了 1 项 → `answerValue: { optionId }`；其余情况 → `answerValue: { optionIds }`。`readableText` 为所选 label 用"、"拼接。
- 测试 `tests/plan/ask-card.test.tsx`（沿用文件内写法）：single_choice 的作品卡点一张不触发 onSubmit；点"确认"后 onSubmit 收到 `{ optionId }`；选两张再确认收到 `{ optionIds: [..] }` 且 readableText 含两个 label；意见卡（taskType=opinion，single_choice）仍是点选即提交。

### B2 `app/(authed)/plan/[id]/ui.tsx`：答复轮可重试，且绝不发空 message

- 把 `retryMessage?: string` 改为 `retry?: { message: string; answerTo?: string; answerValue?: unknown }`，第 109/178 行两处对普通轮与答复轮都记录完整请求体；重试按钮 `postAndStream(entry.retry)` 原样重发。
- `postAndStream` 入口加守卫：`message.trim()` 为空时直接返回并在聊天流里追加一条 assistant 提示"消息为空，未发送"，不发请求。
- 测试：在 `tests/plan/plan-timeline.test.tsx`（或该目录里已有模拟 SSE error 的用例文件）补两条：答复轮（带 answerTo）出错后出现"重试"按钮，点击后 fetch body 含同样的 answerTo/answerValue；空 message 不发 fetch。

完成标准：`npx vitest run tests/plan tests/map` 全绿；`npx tsc --noEmit` 无错；不改 `lib/**`。
