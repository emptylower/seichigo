# 计划页第八轮：断线/刷新后自动续跑（2026-09-03）

工作方式同前：先通读现状；每条先补失败测试再实现；**不要 git commit**；**不跑迁移**（本轮无 schema 改动）；line-budget 必须通过。
- A（后端，glm-5.3）只碰 `lib/planAgent/**`、`lib/tripPlan/**`、`app/api/me/plans/[id]/agent/route.ts`、`tests/planAgent/**`、`tests/tripPlan/**`。
- B（前端，kimi k3）只碰 `app/(authed)/plan/[id]/**`、`tests/plan/**`。

## 根因（第七轮验收实证）
- `app/api/me/plans/[id]/agent/route.ts` 把 `req.signal` 的 abort 与流的 `cancel()` 都接到同一个 `AbortController`，`lib/planAgent/loop.ts` 在每轮迭代检查 `deps.signal?.aborted` 即退出。**用户刷新页面或断网 = 客户端断开 = run 被立即中止**。验收中一次真实断网：run 只落了第一段 assistant 文本就结束，之后没有任何工具调用和 daymap——这正是用户看到的"刷新后只剩规划中提示，结束后什么都没有"。
- Cloudflare 限制：HTTP 触发的 Worker 在客户端断开后，`waitUntil` 最多再延长 30 秒（官方文档 workers/platform/limits），所以**不可能**让 run 脱离连接长期存活；把 run 搬进 Durable Object / Workflows 是根治方案，但改造量大，本轮不做。
- 第七轮已落地的实况表（`TripPlanRunLive`）在 run 存活期间工作正常（验收：思考文本 2 → 5,353 字符逐步增长，状态与工具进度可见，结束后清空、chat 含 daymap）。

## 方案：中断可感知 + 自动续跑
run 被客户端断开中止时，服务端记下"被打断"；前端重新打开页面若发现上一次 run 被打断且对话没有收尾，自动发起一次"继续"回合（不新增用户消息），模型基于已落库的消息接着做。用户看到的是"上次规划被打断，正在自动继续…"，而不是空白。

## §0 契约
- `GET /api/me/plans/:id` 增加 `interrupted: { at: string; turnIndex: number } | null`：最后一条运行日志 `stage === 'interrupted'` 且其后没有新的 run（`agentBusy === false` 且没有更晚的运行日志）时返回。
- `POST /api/me/plans/:id/agent` 接受 `{ resume: true }`（不带 `message`）：不追加 human 消息，直接以当前落库消息历史起一个 run；服务端会在系统状态里注明"上一回合被打断，请从已保存的进度继续，不要重复已完成的工具调用"。若最后一条消息已是不带 tool_calls 的 assistant 文本且没有待回答的 ask，则返回 `{ ok: false, reason: 'nothing_to_resume' }`（HTTP 200）而不起 run。

## A. 后端
### A1 中断标记（`route.ts`、`loop.ts`）
- route：区分"客户端断开"与"服务端主动结束"。断开时 `abort.abort(new DOMException('client_disconnected', 'AbortError'))`；loop 在 `deps.signal?.aborted` 退出时若 `signal.reason?.message === 'client_disconnected'` 且尚未 `emit({type:'done'})`，finally 写运行日志 `stage: 'interrupted'`（其余字段照常），并 `finish({ flush: false, clear: true })` 清实况行。
- 断开后不要再给 SSE 写事件（已关闭），但落库照常。
- 测试：`tests/planAgent/loop.test.ts` 补「signal 以 client_disconnected 中止 → run log stage=interrupted、live 被清、无 done」；正常完成不写 interrupted。

### A2 `interrupted` 字段（`lib/tripPlan/handlers/planById.ts`）
- 按 §0 计算；`chatRevision` 不变。测试补两条（有/无）。

### A3 `resume` 回合（`route.ts`、`lib/planAgent/loop.ts` 或新文件 `lib/planAgent/resume.ts`）
- route 解析 `resume: true`：校验计划归属与非 busy；调用 `canResume(messages)`（新文件）：最后一条是 human，或 assistant 带 tool_calls，或最后一条是 ask 且未回答 → 可续；否则 `nothing_to_resume`。
- 起 run 时 `humanMessage` 为空，但给 loop 传 `resumeNote: '上一回合因连接中断被打断，请基于已保存的消息与行程继续，不要重复已经完成的工具调用；如果行程已保存完整，直接给出总结。'`，注入到本回合的 `[系统状态]` 前缀（现有 stage context 机制，不落库）。
- 测试：`tests/planAgent/api.test.ts` 或 route 测试补「resume 不追加 human 消息」「nothing_to_resume」。

## B. 前端（`ui.tsx`，如需拆 `hooks/useAutoResume.ts`）
### B1 自动续跑
- 挂载时（以及轮询到 `idle` 后）读取 `interrupted`；若非空且本页尚未自动续跑过（sessionStorage 记 `planId:turnIndex`，避免死循环）：显示琥珀色横幅「上次规划被打断（页面刷新或网络中断），正在自动继续…」，POST `{ resume: true }` 并按正常流式处理；`nothing_to_resume` 时只显示「上次对话已完成」并淡出。
- 同一 `turnIndex` 只自动续跑一次；再次被打断由用户手动点"继续"按钮（横幅上提供）。
- 测试 `tests/plan/plan-timeline.test.tsx`：`interrupted` 非空 → 自动 POST resume 且横幅出现；`nothing_to_resume` → 不再重试；sessionStorage 已记录 → 不重复 POST。

### B2 断线期间的实况
- 已有：轮询显示 `live.reasoning`。补一条：run 被打断后 `live` 为空且 `interrupted` 非空时，ThinkingChain 显示「已中断」而不是「思考中」。

完成标准：A `npx vitest run tests/planAgent tests/tripPlan` 全绿；B `npx vitest run tests/plan` 全绿；两边 `npx tsc --noEmit` 无错、`typecheck:tests` 无新增、line-budget 通过；简短中文汇报。
