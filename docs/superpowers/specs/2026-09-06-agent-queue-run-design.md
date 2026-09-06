# 规划 run 队列化 + 文章路线表格移动端适配 设计（2026-09-06）

## 背景

用户反馈两件事（2026-09-05 手机端，大陆网络）：

1. **规划任务没有执行完。** 库与 Cloudflare 日志对上的记录：计划 `cmto4mxbw…`（镰仓灌篮高手 2 日）第 3 回合 08:39Z 开始，`POST /api/me/plans/:id/agent` 的 Worker 结果为 `canceled`（客户端断开），wall 143 s；08:41Z 客户端再发一次，55 s 后又 `canceled`。两次都没有运行日志，说明隔离体被硬杀。根因是平台规则：HTTP 请求本身没有时长上限，但**客户端一断开，`waitUntil` 最多再撑 30 秒**；规划一轮要 2–9 分钟，手机端 SSE 长连接被重置或页面切后台，服务端 run 就随之死掉。现有"上次被打断 → 续跑"只是兜底，每次断流都丢掉进行中的那次模型调用。
2. **文章内路线卡片的表格在手机上不可读。** `lib/route/render.ts` 固定输出六列（顺序/地点/最近站/机位建议/时间戳/导航），窄屏每列只剩两三个字宽；这篇文章三列全空仍占位。地图预览（Google 静态图直链）大陆打不开的问题用户明确**保持现状不处理**。

用户决定：问题 1 用 **Cloudflare Queue 消费者跑 run**；问题 2 做**窄屏逐条卡片 + 整列为空不渲染**，地图不动。

## 目标

- 规划 run 与浏览器连接彻底解耦：断流、切后台、刷新都不再杀 run；客户端回来后靠轮询看到进度与结果。
- 本地 `next dev`（无队列绑定）与测试不受影响，仍走现有 SSE 内联路径。
- 停止、续跑、配额、栅栏（接管）语义全部保留。
- 文章路线表格在窄屏成为可读的逐条卡片，桌面维持表格；整列为空的列不渲染。

## 非目标

- 不改规划循环 `lib/planAgent/loop.ts` 的业务逻辑（只加一个软截止时间）。
- 不做 Workflows、Durable Object。
- 不改地图预览的来源与加载失败表现。
- 不改思维链的视觉样式；轮询模式下丢失 `model_info`（"该模型不公开思考过程"提示）可接受。

## §0 契约

### 0.1 消费者入口与自引用

- 新文件 `worker/entry.ts`（wrangler `main` 改指向它）：

```ts
// @ts-expect-error 由 cf:build 生成
import handler from '../.open-next/worker.js'
// @ts-expect-error 同上
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from '../.open-next/worker.js'
import { consumePlanAgentBatch } from './planAgentConsumer'

export default {
  fetch: handler.fetch,
  queue: consumePlanAgentBatch,
} satisfies ExportedHandler<PlanAgentWorkerEnv>
```

- `worker/planAgentConsumer.ts` **不引入任何 `@/` 应用代码**（避免把 Prisma/Next 再打包一遍）。它对每条消息通过自引用服务绑定回调应用内部路由，并等待其结束：

```ts
import type { PlanAgentQueueMessage } from '@/lib/planAgent/queueMessage' // 类型文件，无运行时依赖（见 0.2）
export type PlanAgentWorkerEnv = {
  WORKER_SELF_REFERENCE: Fetcher
  PLAN_AGENT_INTERNAL_SECRET: string
  PLAN_AGENT_QUEUE: Queue<PlanAgentQueueMessage>
}
export async function consumePlanAgentBatch(batch: MessageBatch<PlanAgentQueueMessage>, env: PlanAgentWorkerEnv): Promise<void>
```

  对每条消息：`env.WORKER_SELF_REFERENCE.fetch('https://seichigo.com/api/internal/plan-agent/run', { method: 'POST', headers: { 'content-type': 'application/json', 'x-plan-agent-secret': env.PLAN_AGENT_INTERNAL_SECRET }, body: JSON.stringify(message.body) })`，把响应体读到底（内部路由用心跳流保持连接），无论结果如何 `message.ack()`。**不重试**（`max_retries: 0`）：硬杀后的续跑交给现有"悬空 run → 续跑"路径，避免同一回合跑两遍。

- `wrangler.jsonc`：

```jsonc
"main": "worker/entry.ts",
"queues": {
  "producers": [{ "binding": "PLAN_AGENT_QUEUE", "queue": "seichigo-plan-agent" }],
  "consumers": [{ "queue": "seichigo-plan-agent", "max_batch_size": 1, "max_batch_timeout": 0, "max_retries": 0, "max_concurrency": 10 }]
}
```

  队列需先创建：`npx wrangler queues create seichigo-plan-agent`；密钥：`npx wrangler secret put PLAN_AGENT_INTERNAL_SECRET`（本地 `.env.local` 同名变量供 `next dev` 内部路由校验）。这两步在主会话部署前由主会话执行。

### 0.2 内部执行路由

新文件 `app/api/internal/plan-agent/run/route.ts`（`runtime = 'nodejs'`）：

- 校验 `x-plan-agent-secret` 与 `process.env.PLAN_AGENT_INTERNAL_SECRET` 常量时间相等，否则 401；缺省未配置密钥时一律 503。
- 读取 `PlanAgentQueueMessage`；从库里取计划；`repo.renewAgentRun(planId, runToken, AGENT_BUSY_TTL_MS)` 为 false（已被接管/已结束/token 不符）→ 返回 `{ skipped: 'stale_token' }`，不跑。
- 消息类型放 `lib/planAgent/queueMessage.ts`（纯类型 + `isPlanAgentQueueMessage` 校验函数，无其它 import，`worker/**` 可安全引用）。本回合输入直接取队列消息里的 `message`（普通轮/答复轮的用户原文，human 消息已在 POST 里落库，`userMessagePersisted: true` 语义不变；续跑轮 `message` 为 null、`resume: true`）。消息体：

```ts
export type PlanAgentQueueMessage = {
  v: 1
  planId: string
  runToken: string
  locale: SupportedLocale
  /** 普通轮/答复轮的用户原文（循环输入 + 标题侧信道）；续跑轮为 null */
  message: string | null
  resume: boolean
  enqueuedAt: string
}
```

- 响应为 `text/plain` 流：每 15 s 写一行 `heartbeat`，run 结束写 `done` 并关闭。这样自引用子请求在 run 期间始终"有响应在流"，不会被当作空闲。
- 执行 `executePlanAgentRun`（0.4），`onEvent` 为 no-op（进度全靠循环已有的实况行与消息落库）。

### 0.3 POST `/api/me/plans/:id/agent` 的改动

保留全部前置逻辑（鉴权、配额、`beginAgentRun`、`stop`、`resume` 判定、`answerMetaPatch` 直写）。在拿到 `runToken` 并落好 human 消息之后：

- 若 `getCfBindings()?.env?.PLAN_AGENT_QUEUE` 存在：`await queue.send(message)`；成功 → 返回 `202 { queued: true, runToken }`。发送抛错 → 记 `console.warn` 并**回落到现有 SSE 内联路径**（不额外 endAgentRun，SSE 路径的 finally 会释放）。
- 无绑定（`next dev`、vitest）→ 现有 SSE 路径原样。
- 投递还需 `process.env.PLAN_AGENT_QUEUE_ENABLED === '1'`（wrangler.jsonc `vars`，预览版本用 `--var` 覆盖为 0——队列消费者与自引用绑定只对已部署版本生效，预览跑不了消费者，未开时回落 SSE）。

`CfBindingsEnv` 增加 `PLAN_AGENT_QUEUE?: { send(body: unknown): Promise<void> }`。

### 0.4 执行器抽取

新文件 `lib/planAgent/execute.ts`：

```ts
export type ExecutePlanAgentRunInput = {
  repo: TripPlanRepo
  planId: string
  runToken: string
  locale: SupportedLocale
  message: string        // 续跑轮传 ''
  resume: boolean
  signal: AbortSignal
  onEvent: (event: PlanAgentEvent) => void
  busyTtlMs: number
  deadlineAt?: number    // 0.5，epoch ms
}
export async function executePlanAgentRun(input: ExecutePlanAgentRunInput): Promise<void>
```

把 route 里 `renewLease`、`runPlanAgent(...)` 的 deps 组装（`createChatCompletion`、`withModelUsageInRunLog`、`PrismaPointFinder`、`searchBgmSubjects`、`getPlanAgentServerDeps`、`isStopped`、`resumeNote`）、标题侧信道 `maybeSetGeneratedTitle`、以及 `finally { endAgentRun }` 原样搬进来；route 与内部路由都调用它。**纯搬运**，SSE 路径行为不变（现有 `tests/api`、`tests/planAgent/routeStop` 必须原样通过）。

### 0.5 软截止时间

`PlanAgentDeps.deadlineAt?: number`（epoch ms）。循环每次迭代开头检查 `Date.now() >= deadlineAt` → 视同客户端断开收尾（`interrupted = true`，写 `stage=interrupted` 日志，不派发补齐续跑，不发 done）。内部路由传 `deadlineAt = start + 13 min`（消费者单次上限 15 min，留 2 min 给收尾与心跳）。SSE 路径不传。

### 0.6 观察流（保持流式体验）

用户决定：run 在队列里跑，浏览器另开一条**只读观察流**看进度；断了只断观察，run 不受影响。事件协议一开始就带序号与重连参数，将来换 Durable Object 逐 token 推送时只换数据源。

新路由 GET `/api/me/plans/:id/agent/stream?after=<seq>`（`runtime = 'nodejs'`，鉴权同 GET 计划）：

- 服务端每 **500 ms** 读一次轻量快照（0.6.1），有变化才推事件；客户端断开（`req.signal`）即停；单连接最长 15 min，到时发 `done` 关闭，客户端若仍 busy 自动重连。
- SSE 事件（每条带 `seq`，从 1 递增；`after` 目前仅保留语义，服务端总是从当前快照开始推，快照事件幂等）：
  - `{ type: 'live', seq, reasoning, statusText, toolCalls, updatedAt }`：实况行变化（按 `updatedAt` 判断）。客户端用现有 `liveToThinkingTurn` 重建进行中的思维链。
  - `{ type: 'chat', seq, chatRevision, chat: ChatEntryView[] }`：`chatRevision` 变化后先 `listMessages` → `toChatView`，与上次推送的可见视图比较（长度 + 末条 key：daymap 认 `revisionId`、ask 认 `askId`、纯文本认文本+索引），可见对话真正变化才推全量视图（与 GET 同一份 `toChatView`），客户端用现有 `mergeServerChat` 合并（按 revision 幂等）。tool 消息不进可见视图，不触发 chat；busy 落幕前的最终 chat 同规则（无变化不重复推，done 照发）。
  - `{ type: 'plan_updated', seq }`：计划修订号（0.6.1 `planRevision`，与运行租约无关）变化，客户端 `refreshPlan()`（现有）。续租心跳（renewAgentRun 写 `agentBusyUntil` 会顺带刷 `updatedAt`）不触发。
  - `{ type: 'done', seq, reason: 'finished' | 'rotate', stopped: boolean, interrupted: InterruptedInfo | null }`：`agentBusy` 变为 false 时先补发一次 `chat`，再发 `done`（`reason='finished'`）并关闭；`interrupted` 与 GET 的字段同源，客户端据此走现有自动续跑。`stopped`：finished 时若该计划最新一条运行日志 `stage==='stopped'`（`repo.listRunLogs` 取最后一条，无日志为 false）则 true（上一次 run 是用户主动停止），否则 false。`reason='rotate'`：连接达到 15 min 上限、run 仍在跑——`interrupted=null`、`stopped=false`，客户端立即重连。
  - `{ type: 'ready', seq: 0 }`：连接建立即发（与现有 POST 流一致）。

0.6.1 轻量快照：`TripPlanRepo` 新增

```ts
getRunSnapshotMeta(planId: string): Promise<{
  agentBusy: boolean
  planRevision: string
  messageCount: number
  lastMessageAt: Date | null
  live: { runToken: string; reasoning: string; statusText: string | null; toolCalls: Prisma.JsonValue | null; updatedAt: Date } | null
} | null>
```

Prisma 实现用一次 `tripPlan.findUnique` 带 `_count.messages`、`_count.days`、`runLive` 关联与 `messages` 的 `orderBy createdAt desc take 1 select createdAt`（一次往返）；memory 实现同语义。`planRevision` 由与运行租约无关的展示字段拼成——title/status/dayCount/startDate/bangumiIds/stage 加 days 数量（TripPlanDay 无 updatedAt 列），`renewAgentRun` 只写 `agentBusyUntil`（Prisma 顺带刷 `updatedAt`）不会动它，观察流据此判 `plan_updated` 不被续租心跳误报。`chatRevision` 沿用 GET 的公式（`messageCount × 1e14 + lastMessageAt`），只在变化时才 `listMessages` 取全量并比对可见视图（0.6 chat 事件规则）。GET 处理器的 `agentBusy`/`interrupted` 判定抽成 `readPlanRunState(deps, planId)` 供 GET 与观察流共用（纯搬运）。

0.6.2 实况行节奏：`lib/planAgent/runLive.ts` 的 `DEFAULT_FLUSH_INTERVAL_MS` 1500 → **500**，`DEFAULT_FLUSH_CHARS` 400 → **200**。写库频率上限 2 次/秒/run。

0.6.3 客户端（`app/(authed)/plan/[id]/{ui.tsx,hooks/usePlanRunSync.ts}` + 新 `hooks/useAgentWatchStream.ts`）：

- `streamAgentRequest` 收到 `202 { queued: true }` → `runSync.clearInterrupted()` → `watch.open()`。`busy` 保持 true，收尾由观察流的 `done` 事件负责（清活动思维链、`setBusy(false)`、处理 `interrupted`）。
- `useAgentWatchStream`：用 `fetch` + `ReadableStream` 读 SSE（与现有 POST 流同一套帧解析，抽成 `lib/sseFrames.ts` 共用）；事件分发：`live` → `setActiveThinking(liveToThinkingTurn(...))`；`chat` → `setChat(prev => mergeServerChat(prev, chat))` 并 `bumpChatEpoch`；`plan_updated` → `refreshPlan()` + `PLANS_CHANGED_EVENT`；`done` → 收尾。
- 断线重连：读流异常且仍 busy → 退避 500 ms / 1 s / 2 s / 5 s 重连（带 `after=<最后 seq>`）；连续失败 4 次 → 退回现有 3 s 轮询（`enterRunRecovery('reconnecting')`）。`visibilitychange` 回到前台且仍 busy → 立即重连一次。
- 刷新后发现服务端仍在跑（现有 `in-progress` 分支）也改为打开观察流，轮询只作兜底。横幅：本地发起的回合不显示"规划仍在进行中…"；刷新后接上的仍显示。
- 停止按钮流程不变（POST `{stop:true}`）；观察流会在 run 结束后推 `done`。
- 现有 POST SSE 分支保留（本地开发与队列回落路径）。

### 0.7 文章路线表格（`lib/route/render.ts` + `styles/globals.css`）

- `renderRouteTable`：先算可见列。`order`、`location` 恒显示；`nearestStation`（`nearestStation_zh`）、`photoTip`、`timestamp`（`animeScene`）任一 spot 非空才显示；`navigation` 任一 spot 有合法 URL 才显示。`<th>` 与 `<td>` 只输出可见列，每个 `<td>` 带 `data-col="<key>"` 与 `data-label="<表头文案>"`。
- CSS（`@media (max-width: 639px)`）：`thead` 隐藏；`tr` 变卡片（块级、圆角、白底、内边距、间距）；`td` 变行：`td[data-col=order]` 为粉色小圆徽标、`td[data-col=location]` 同行加粗占满剩余宽度；其它列换行，`::before { content: attr(data-label) }` 灰色小字标签；`td:empty` 不显示。桌面样式不变。
- 空列在桌面同样不渲染（这篇文章桌面上也不该有三列空白）。

## 数据流（生产）

```
浏览器 POST /agent ──► route：鉴权/配额/beginAgentRun/落 human 消息 ──► queue.send ──► 202 {queued}
                                                                                    │
浏览器 GET /agent/stream（SSE 观察流，服务端每 0.5 s 读快照）◄── 循环写消息/实况行 ◄── 内部路由 executePlanAgentRun ◄── 消费者自引用 fetch ◄── Queue
（观察流断开只影响观察，重连即续；连续失败退回 3 s 轮询）
```

## 错误处理

- 队列发送失败 → 回落 SSE，日志 warn，用户无感。
- 消费者拿到过期 token（用户已停止/已被新回合接管/租约到期被 GET 回收）→ 内部路由返回 `skipped`，ack。
- 内部路由密钥不匹配 → 401，ack，`console.error`（配置错误必须可见）。
- 消费者被平台硬杀（15 min 上限、运行时升级）→ 无运行日志，现有"悬空 run"检测在租约过期后给出续跑入口，与今天一致。
- 软截止触发 → `stage=interrupted` 日志 → 客户端自动续跑一次（现有逻辑）。

## 测试

- `tests/planAgent/execute.test.ts`：`executePlanAgentRun` 组装的 deps（memory repo + mock createMessage）跑通一轮；finally 释放 busy；`deadlineAt` 已过时循环立即以 interrupted 收尾（`stage=interrupted` 运行日志）。
- `tests/api/plan-agent-queue.test.ts`：mock `getCfBindings` 返回带 `send` 的队列 → POST 返回 202 且 `send` 收到 `{v:1, planId, runToken, locale, message, resume:false}`；`send` 抛错 → 回落为 `text/event-stream`；无绑定 → SSE（现有断言）。
- `tests/api/plan-agent-internal-run.test.ts`：密钥缺失 503、密钥错误 401、token 过期 `skipped`、正常路径调用 `executePlanAgentRun` 且响应含 `done`。
- `tests/worker/planAgentConsumer.test.ts`：fake `WORKER_SELF_REFERENCE.fetch` 记录请求头与 body，每条消息都 `ack`，fetch 抛错也 ack。
- `tests/tripPlan/**`：`getRunSnapshotMeta` memory 与 prisma（mock）实现；`readPlanRunState` 与 GET 现有断言一致。
- `tests/api/plan-agent-stream.test.ts`：未登录 401；快照无变化不推事件；实况行变化推 `live`；消息数变化推 `chat`（全量）；busy 变 false 推最终 `chat` + `done`（含 `interrupted`）；客户端 abort 后循环停止；`seq` 单调递增。
- `tests/planAgent/runLive*.test.ts`：节奏常量改为 500 ms / 200 字。
- `tests/plan/**`：202 分支打开观察流且无横幅；`live`/`chat`/`plan_updated`/`done` 各自的状态变化；读流异常退避重连并带 `after`；连续 4 次失败退回轮询；`visibilitychange` 立即重连；`lib/sseFrames.ts` 帧解析单测。
- `tests/route/route-render.test.ts` 补：空列不渲染、`data-label`/`data-col` 存在、导航列无 URL 时不渲染。
- 主会话验收：预览环境（`upload` 版本同样绑定队列与密钥）手机模拟发起规划后**中途断开请求**（Playwright `route.abort` / 关闭页面再打开），确认 run 继续跑到底、页面回来后进度与结果完整；桌面正常回合；停止按钮生效；`next dev` 本地仍走 SSE。

## 分批与分工

- **A 后端 / 基建（opencode glm-5.3 max）**：`lib/planAgent/execute.ts`、`lib/planAgent/loop.ts`（仅 deadline）、`lib/planAgent/runLive.ts`（常量）、`lib/planAgent/queueMessage.ts`、`lib/tripPlan/{repo,repoMemory,repoPrisma}.ts`（`getRunSnapshotMeta`）、`lib/tripPlan/handlers/planById.ts`（抽 `readPlanRunState`）、`app/api/me/plans/[id]/agent/stream/route.ts`、`app/api/me/plans/[id]/agent/route.ts`、`app/api/internal/plan-agent/run/route.ts`、`lib/anitabi/cf/bindings.ts`（类型）、`worker/{entry,planAgentConsumer}.ts`、`wrangler.jsonc`、`tsconfig` 若需把 `worker/**` 纳入、`tests/planAgent/execute.test.ts`、`tests/api/**`、`tests/worker/**`。
- **B 前端 / 样式（Claude Opus）**：`app/(authed)/plan/[id]/{ui.tsx,components/ChatPane.tsx,hooks/usePlanRunSync.ts,hooks/useAgentWatchStream.ts,lib/chatState.ts}`、`lib/sseFrames.ts`、`tests/plan/**`、`tests/lib/sseFrames.test.ts`；`lib/route/render.ts`、`styles/globals.css`、`tests/route/route-render.test.ts`。
- **C 主会话**：创建队列与密钥、合并、全量验证、预览部署、断流验收、上线。

## 风险与取舍

- 桌面端从逐 token 流式变为约 0.5 s 一段的观察流（实况行 0.5 s 落库 + 服务端 0.5 s 读快照），肉眼差别很小；换来的是任何网络环境下 run 都不会因断流而死。将来要逐 token，只需把观察流的数据源换成 Durable Object，协议与客户端不变。
- 观察流每个连接每 0.5 s 一次轻量库读（单次往返），当前量级可忽略；连接上限 15 min 自动轮换。
- 自引用子请求在 Worker 内是一次新的调用，CPU 上限 300 s 按调用计算，与今天 SSE 路径一致。
- 队列消费者每次调用 15 min 硬上限：现有最长回合 9.3 min，软截止 13 min 兜底。
- `wrangler main` 改为自定义入口后，`cf:build`/`upload`/`deploy` 流程不变，但需回归一次预览部署确认 OpenNext 的三个 Durable Object 导出仍在。
