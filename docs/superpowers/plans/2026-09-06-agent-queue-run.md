# 规划 run 队列化 + 观察流 + 路线表格移动端 实施计划（2026-09-06）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 规划 run 在 Cloudflare Queue 消费者里跑、与浏览器连接解耦；浏览器通过只读 SSE 观察流看进度；文章路线表格窄屏可读。

**Architecture:** POST `/agent` 投递队列并 202；自定义 Worker 入口的 `queue` 处理器经自引用服务绑定调内部路由，在 Next 路由里复用抽出来的执行器跑循环；GET `/agent/stream` 每 0.5 s 读轻量快照推 SSE；客户端新 hook 消费观察流，断线退避重连，轮询兜底。

**Tech Stack:** Next.js 15 App Router on OpenNext/Cloudflare、Cloudflare Queues、Prisma、vitest。

设计稿：`docs/superpowers/specs/2026-09-06-agent-queue-run-design.md`（所有取舍以它为准，§0 是两条 lane 的接口契约）。

## 工作方式（两条 lane 都遵守）

- 工作目录 `/Users/mac/Desktop/seichigo-worktrees/agent-queue`（分支 `feat/agent-queue-run`）。**不要 `git commit`、不要 `git stash`**，不跑 Prisma 迁移，不改 `prisma/schema.prisma`，不要 `wrangler queues create` / `wrangler secret put`（主会话做）。
- 先补失败测试再改代码；每个源文件 ≤ 750 行（`npm run check:line-budget`）。
- 文件不相交；需要对方接口时按 §0 签名假设，A 先落地类型。
- 完成后中文简短汇报：改动文件、测试、命令与结果、偏离计划处。

---

## Lane A：后端 / 基建（opencode glm-5.3 max）

只碰：`lib/planAgent/{execute,queueMessage,loop,runLive}.ts`、`lib/tripPlan/{repo,repoMemory,repoPrisma}.ts`、`lib/tripPlan/handlers/planById.ts`、`lib/anitabi/cf/bindings.ts`、`app/api/me/plans/[id]/agent/route.ts`、`app/api/me/plans/[id]/agent/stream/route.ts`、`app/api/internal/plan-agent/run/route.ts`、`worker/{entry,planAgentConsumer}.ts`、`wrangler.jsonc`、`tsconfig.json`（仅在 `worker/**` 需要纳入或排除时）、`tests/planAgent/**`、`tests/api/**`、`tests/tripPlan/**`、`tests/worker/**`。

### Task A1：执行器抽取（纯搬运）

**Files:** Create `lib/planAgent/execute.ts`、`tests/planAgent/execute.test.ts`；Modify `app/api/me/plans/[id]/agent/route.ts`。

- [ ] 先跑 `npx vitest run tests/api tests/planAgent/routeStop.test.ts` 记录基线。
- [ ] 按设计稿 0.4 把 route 里 `renewLease`、`runPlanAgent` 的 deps 组装、`maybeSetGeneratedTitle` 侧信道、`finally { endAgentRun }` 搬进 `executePlanAgentRun`；route 的 SSE `start()` 改为调用它并把 `send` 作为 `onEvent`。`AGENT_BUSY_TTL_MS`（90 s）移到 `execute.ts` 导出，route import。
- [ ] 测试：memory repo + `vi.mock('@/lib/planAgent/api')`（`createChatCompletion` 返回一条纯文本回复）→ 跑通一轮，`onEvent` 收到 `text` 与 `done`，结束后 `isAgentBusy` 为 false；`createMessage` 抛错时 `onEvent` 收到 `error`、busy 仍被释放。
- [ ] 基线用例全绿；`npx tsc --noEmit`。

### Task A2：软截止 + 实况节奏

**Files:** Modify `lib/planAgent/loop.ts`、`lib/planAgent/runLive.ts`、`tests/planAgent/loop.interrupt.test.ts`（补用例）、`tests/planAgent/runLive*.test.ts`（常量断言若有）。

- [ ] `PlanAgentDeps.deadlineAt?: number`：迭代开头 `Date.now() >= deadlineAt` → `interrupted = true; break`（与客户端断开同一收尾：`stage=interrupted` 日志、实况行 clear、不发 done、不派发续跑）。测试：`deadlineAt = Date.now() - 1` 时不调用模型、运行日志 `stage='interrupted'`、无 `done` 事件。
- [ ] `DEFAULT_FLUSH_INTERVAL_MS = 500`、`DEFAULT_FLUSH_CHARS = 200`；相关测试同步。
- [ ] `npx vitest run tests/planAgent` 全绿。

### Task A3：队列消息类型 + POST 投递 + 内部路由

**Files:** Create `lib/planAgent/queueMessage.ts`、`app/api/internal/plan-agent/run/route.ts`、`tests/api/plan-agent-queue.test.ts`、`tests/api/plan-agent-internal-run.test.ts`；Modify `lib/anitabi/cf/bindings.ts`（`CfBindingsEnv.PLAN_AGENT_QUEUE?`）、`app/api/me/plans/[id]/agent/route.ts`。

- [ ] `queueMessage.ts`：`PlanAgentQueueMessage` 类型（设计稿 0.2）+ `isPlanAgentQueueMessage(value: unknown): value is PlanAgentQueueMessage`（逐字段校验，`locale` 只接受 zh/en/ja）。**不 import 任何其它模块**（`SupportedLocale` 用本地字面量联合重复声明并加注释）。
- [ ] POST：按 0.3——拿到 `runToken`、human 消息落库、`answerMetaPatch` 直写之后，`const queue = getCfBindings()?.env?.PLAN_AGENT_QUEUE`；有则 `await queue.send(msg)` → `NextResponse.json({ queued: true, runToken }, { status: 202 })`；抛错 → `console.warn('[planAgent/queue] send failed, falling back to inline SSE', err)` 走原路径。注意：`answerMetaPatch` 直写与 `plan_updated` 事件现在在 SSE `start()` 里，投递前要先做直写（不发事件，观察流会推 `plan_updated`）。
- [ ] 内部路由：按 0.2。密钥比较用 `crypto.timingSafeEqual`；心跳流 `text/plain`，每 15 s 一行 `heartbeat\n`，结束 `done\n`；`skipped` 情况直接 JSON。`deadlineAt = Date.now() + 13 * 60_000`。`onEvent` no-op；`signal` 用 `req.signal`（消费者断开即中止）。
- [ ] 测试：POST 有队列绑定 → 202、`send` 收到完整消息体、human 消息已落库、busy 为 true；`send` 抛错 → `text/event-stream`；无绑定 → SSE（现有）。内部路由：无密钥 503、错密钥 401、token 不符 `{ skipped: 'stale_token' }`、正常路径 `executePlanAgentRun` 被调用（mock）且响应体含 `done`。
- [ ] `npx vitest run tests/api` 全绿。

### Task A4：轻量快照 + 观察流路由

**Files:** Modify `lib/tripPlan/repo.ts`、`lib/tripPlan/repoMemory.ts`、`lib/tripPlan/repoPrisma.ts`、`lib/tripPlan/handlers/planById.ts`；Create `app/api/me/plans/[id]/agent/stream/route.ts`、`tests/tripPlan/runSnapshotMeta.test.ts`、`tests/api/plan-agent-stream.test.ts`。

- [ ] `getRunSnapshotMeta` 按 0.6.1；memory 实现从现有 Map 组装；prisma 实现一次 `findUnique`（`select: { updatedAt, agentBusyUntil, agentRunToken, runLive: {...}, _count: { select: { messages: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } }`），`agentBusy` 的判定与 `isAgentBusy` 同一规则（复用其判定函数）。
- [ ] `planById.ts`：把 GET 里 `agentBusy`/`live`/`interrupted` 的判定抽成导出函数 `readPlanRunState(deps, planId)`（纯搬运，GET 现有测试不变）。
- [ ] 观察流路由：鉴权同 GET（未登录 401、非本人 404）；`ReadableStream` 内循环：`ready(seq 0)` → 每 500 ms `getRunSnapshotMeta`；对比上次 `live.updatedAt`、`chatRevision`、`planUpdatedAt` 推 `live`/`chat`/`plan_updated`；`agentBusy` 变 false → 最终 `chat`（若 revision 变了）+ `done{ interrupted }`（`readPlanRunState` 的 `interrupted`）并 `close`；`req.signal` abort → 停循环；连接满 15 min → `done{ interrupted: null }` 关闭。事件全部带递增 `seq`。响应头 `Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache`。
- [ ] 测试：用 memory repo + 假计时器（`vi.useFakeTimers`）驱动：无变化不推；写实况行 → `live`；追加消息 → `chat` 且 `chat.length` 正确；`endAgentRun` → `chat` + `done`；abort 后不再读；`seq` 单调。
- [ ] `npx vitest run tests/tripPlan tests/api` 全绿。

### Task A5：Worker 入口与消费者

**Files:** Create `worker/entry.ts`、`worker/planAgentConsumer.ts`、`tests/worker/planAgentConsumer.test.ts`；Modify `wrangler.jsonc`（`main`、`queues`）、`tsconfig.json`（若 `worker/**` 未被 `include` 覆盖则加入；`.open-next` 的导入用 `@ts-expect-error`）。

- [ ] `planAgentConsumer.ts`：按 0.1；对每条消息校验 `isPlanAgentQueueMessage`（不合法 → `console.error` + ack）；`fetch` 目标 `https://seichigo.com/api/internal/plan-agent/run`；读响应体到底（`for await` reader）；任何异常 `console.error` 后仍 `ack()`。
- [ ] `entry.ts` 按 0.1（`fetch: handler.fetch`，导出三个 DO 类，`queue: consumePlanAgentBatch`）。
- [ ] `wrangler.jsonc`：`"main": "worker/entry.ts"`；`queues.producers/consumers` 按 0.1。
- [ ] 测试：fake `env.WORKER_SELF_REFERENCE.fetch` 记录 URL、头（含密钥）、body；两条消息各 ack 一次；fetch 抛错也 ack；非法消息不 fetch 但 ack。
- [ ] `npx vitest run tests/worker` 全绿；`npx tsc --noEmit` 无错（`worker/**` 若不在 tsconfig include 内，说明原因）。

**Lane A 完成标准：** `npx vitest run tests/api tests/planAgent tests/tripPlan tests/worker` 全绿；`npx tsc --noEmit`；`npm run typecheck:tests` 不新增（基线 3 条 `tests/lib/prisma-client-lifecycle.test.ts`）；`npm run check:line-budget` 通过。**不要跑 `npm run cf:build`**（主会话做）。

---

## Lane B：前端 / 样式（Claude Opus）

只碰：`app/(authed)/plan/[id]/{ui.tsx,components/ChatPane.tsx,hooks/usePlanRunSync.ts,hooks/useAgentWatchStream.ts,lib/chatState.ts}`、`lib/sseFrames.ts`、`lib/route/render.ts`、`styles/globals.css`、`lib/i18n/locales/*.json`（仅当需要新文案键）、`tests/plan/**`、`tests/lib/sseFrames.test.ts`、`tests/route/route-render.test.ts`、`tests/i18n/planKeys.test.ts`（仅键表变化时）。

### Task B1：SSE 帧解析抽取

**Files:** Create `lib/sseFrames.ts`、`tests/lib/sseFrames.test.ts`；Modify `ui.tsx`。

- [ ] `createSseFrameReader(body: ReadableStream<Uint8Array>): AsyncIterable<unknown>`：复用 `ui.tsx` 现有的 `\n\n` 分帧 + `data:` 解析 + JSON 容错逻辑，纯搬运。测试：跨 chunk 拼帧、非 `data:` 行忽略、坏 JSON 跳过。
- [ ] `ui.tsx` 的 POST 流改用它，行为不变；`npx vitest run tests/plan` 全绿。

### Task B2：观察流 hook

**Files:** Create `hooks/useAgentWatchStream.ts`、`tests/plan/agent-watch-stream.test.tsx`；Modify `lib/chatState.ts`（事件类型 `AgentWatchEvent`）、`hooks/usePlanRunSync.ts`（暴露 `refreshPlan`、`bumpChatEpoch`、`enterRunRecovery` 给 hook 复用）。

- [ ] 事件类型按设计稿 0.6：`ready | live | chat | plan_updated | done`，均带 `seq`。
- [ ] `useAgentWatchStream(params)` 返回 `{ open(): void; close(): void; isOpen(): boolean }`：
  - `open()`：`fetch('/api/me/plans/<id>/agent/stream?after=<lastSeq>')`，`text/event-stream` 才进入读循环，否则按错误处理。
  - 事件处理：`live` → `setActiveThinking(prev => liveToThinkingTurn(live, prev))`；`chat` → `setChat(prev => mergeServerChat(prev, chat))` + `bumpChatEpoch()`；`plan_updated` → `refreshPlan()` + `window.dispatchEvent(new Event(PLANS_CHANGED_EVENT))`；`done` → `setBusy(false)`、`setActiveThinking(null)`、`setSyncBanner(null)`、`interrupted` 非空时 `setInterrupted(info)`（现有自动续跑逻辑接管）。
  - 断线：读流异常或非 200 且仍 busy → 退避 500/1000/2000/5000 ms 重连（带 `after`）；连续第 5 次失败 → `enterRunRecovery('reconnecting')` 交给轮询并 `close()`。`document.visibilitychange` 回到 `visible` 且 busy 且当前未连接 → 立即重连。组件卸载 `close()`。
- [ ] 测试（fake fetch 返回可控 `ReadableStream`）：各事件对应状态变化；`done` 带 `interrupted` 时写入；读流异常后按退避重连且 URL 带 `after`；第 5 次失败转轮询；`visibilitychange` 触发重连。

### Task B3：接入 202 与刷新后接流

**Files:** Modify `ui.tsx`、`components/ChatPane.tsx`、`hooks/usePlanRunSync.ts`；Test `tests/plan/auto-resume.test.tsx`、`tests/plan/agent-stop.test.tsx`、新增 `tests/plan/agent-queued.test.tsx`。

- [ ] `streamAgentRequest`：`res.status === 202` 且 JSON `queued === true` → `runSync.clearInterrupted()`、`watch.open()`、`return`（`finally` 里不得清 busy：以 `watch.isOpen()` 或轮询中为判据）。
- [ ] 刷新后发现服务端仍在跑（`pollAgentRunOnce` 返回 busy 的首次分支）→ 改为 `watch.open()`，横幅保留 `in-progress`；本地发起的回合不显示横幅。
- [ ] 停止：POST `{stop:true}` 不变；`done` 到达后收尾。
- [ ] 测试：202 → 打开观察流、无横幅、busy 为 true；`done` 后 busy false；停止按钮在观察流模式下可点且 POST body 为 `{stop:true}`。
- [ ] `npx vitest run tests/plan` 全绿；`npm run check:line-budget`（`ui.tsx` 现 448 行，观察流逻辑必须在 hook 里，不得让它回到 500 行以上）。

### Task B4：路线表格

**Files:** Modify `lib/route/render.ts`、`styles/globals.css`；Test `tests/route/route-render.test.ts`。

- [ ] 测试先红：三列全空的 spots → 输出不含 `最近站`/`机位建议`/`时间戳` 表头、每行只有 3 个 `<td>`；有 `photoTip` 的 spots → 含该列；无 URL → 无导航列；每个 `<td>` 含 `data-col` 与 `data-label`。
- [ ] `renderRouteTable` 按设计稿 0.7 实现（列描述数组 `{ key, label, cell(spot) }`，过滤后统一渲染）。
- [ ] CSS `@media (max-width: 639px)` 按 0.7；桌面样式不动。用 `npx vitest run tests/route/route-render.test.ts` 与一次手动 `node -e` 打印 HTML 目视检查。

**Lane B 完成标准：** `npx vitest run tests/plan tests/lib tests/route tests/i18n` 全绿；`npx tsc --noEmit`（A 未落地导致的类型错误说明即可）；`npm run typecheck:tests` 不新增；`npm run check:line-budget` 通过。不要在 worktree 里跑 `next dev` / `next build`。

---

## 主会话验收

1. 两条 lane 汇报后：全量 `npx vitest run`、`npx tsc --noEmit`、`npm run typecheck:tests`、`npm run check:line-budget`。
2. 基建（先告知用户再执行）：`npx wrangler queues create seichigo-plan-agent`；`npx wrangler secret put PLAN_AGENT_INTERNAL_SECRET`；`.env.local` 加同名变量。
3. `npm run cf:build && npx opennextjs-cloudflare upload -- --message=agent-queue` 出预览，确认 Worker 上传日志里队列消费者已绑定、三个 DO 导出仍在。
4. Playwright：桌面正常回合（202 → 观察流 → 思维链逐段出现 → 结果卡）；手机模拟发起后 30 s 关闭页面，2 分钟后重新打开，确认 run 已跑完、消息与行程完整；停止按钮生效；`next dev` 本地仍走 SSE（跑一次本地 dev 用 3457 端口验证，验证完按 pid 停）。
5. 文章页窄屏截图确认表格为卡片、空列不出现。
6. 通过后 housekeeping → merge main → predeploy → deploy → deploy-ledger。
