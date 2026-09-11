# Phase 1-A：per-run Durable Object alarm 派发器（默认关，白名单 canary）

worktree：`/Users/mac/Desktop/seichigo-wt-dispatch` ／ 分支：`feat/dispatch-phase1`（从 Phase 0 合入 main 后的 main 切出）

> 背景：`docs/superpowers/plans/2026-09-11-dispatch-joint-plan-v1.md` §1 Phase 1、§3 接纳协议与开关。
> Phase 0（claim / 同步预扣 / 撤销 / 恢复 / `dispatchedAt` / `PLAN_AGENT_STARTS_PAUSED`）已上线，**不要重做**。
> 这一批的目标：把队列派发的 2.8–7.3s 换成 DO alarm；**执行体一行不改**——alarm 里做的事和今天 `worker/planAgentConsumer.ts` 做的一模一样。

## 效率要求
- **只读下面列出的文件**，不要读前端、不要读 `lib/planAgent/loop.ts`、不要读 `lib/billing/**`、不要 grep 全仓。
- **不要调用任何技能**，直接干活。

### 必读文件
1. `worker/planAgentConsumer.ts`（106 行，alarm 要复刻它）
2. `worker/entry.ts`（20 行）
3. `wrangler.jsonc` 的 `queues` / `vars` / `durable_objects` / `migrations` / `services` 段
4. `lib/anitabi/cf/bindings.ts` `:50-95`（`CfBindingsEnv` 结构子集的写法）
5. `lib/planAgent/queueMessage.ts`
6. `app/api/me/plans/[id]/agent/route.ts` 的 `queue.send` 段（搜 `PLAN_AGENT_QUEUE_ENABLED`）到 202 返回
7. `app/api/internal/plan-agent/run/route.ts` 的请求头解析段（搜 `x-plan-agent-consumer-at`）与 `timing:` 注入
8. `lib/planAgent/runTimings.ts`（`RunTimingSeed` / `parseConsumerBatchStamp`）
9. `tests/api/plan-agent-queue.test.ts`、`tests/worker/`（既有消费者测试）

## 边界
允许改：上述 1–8 + 新建 `worker/planRunDispatcher.ts`、`lib/planAgent/dispatch.ts` + 相关测试 + `wrangler.jsonc`（只加 DO binding、migration v2、两个 vars）。
**绝不要改**：执行体（`lib/planAgent/loop.ts` / `execute.ts` / `runAdmission.ts` / `resume.ts`）、`lib/tripPlan/**`、`lib/billing/**`、`app/(authed)/**`、`prisma/**`、`package.json`、`line-budget.allowlist.json`。
`worker/` 目录**不得 import 任何 `@/` 应用代码**（只允许 `../lib/planAgent/queueMessage`、`cloudflare:workers`），否则把 Prisma/Next 打包进 worker 入口。
不要 `git commit` / `push`；不要跑 `dev` / `build` / `cf:*` / `wrangler` / playwright / prisma。

## 改什么

### 1. `worker/planRunDispatcher.ts`（新）

```ts
import { DurableObject } from 'cloudflare:workers'
import { isPlanAgentQueueMessage, type PlanAgentQueueMessage } from '../lib/planAgent/queueMessage'
```
- `export class PlanRunDispatcher extends DurableObject<PlanRunDispatcherEnv>`，env 结构子集与 `PlanAgentWorkerEnv` 一致（`WORKER_SELF_REFERENCE`、`PLAN_AGENT_INTERNAL_SECRET`）。
- **`fetch(req)`**（只经 binding 调用，仍逐字段校验）：
  - body 非法 → `Response.json({ accepted:false, reason:'invalid' }, { status:400 })`。
  - `storage.get('payload')` 已存在 → `Response.json({ accepted:true, duplicate:true })`（**不覆盖、不重置 alarm**）。
  - 否则 `storage.put('payload', msg)`；`storage.put('state', { acceptedAt: Date.now(), attempts: 0 })`；`storage.setAlarm(Date.now())`；返回 `{ accepted:true }`。
  - put 之后任何一步抛错 → **先 `storage.delete('payload')` 再**返回 `{ accepted:false, reason:'storage' }`（保证"rejected ⇒ 未持久接纳"这个协议承诺）。
- **`alarm(info)`**：
  - `payload` 不存在 → return（已清理）。
  - `state.attempts++` 并写回。
  - 与消费者一字不差：`env.WORKER_SELF_REFERENCE.fetch('https://seichigo.com/api/internal/plan-agent/run', { method:'POST', headers: { 'content-type':'application/json', 'x-plan-agent-secret': env.PLAN_AGENT_INTERNAL_SECRET, 'x-plan-agent-transport':'do', 'x-plan-agent-consumer-at': String(Date.now()), 'x-plan-agent-consumer-seq': String(++INVOCATION_SEQ) }, body: JSON.stringify(payload) })` → `drainBody`（把 `planAgentConsumer.ts` 的 `drainBody` 抽成两处共用的小函数，放在 `worker/` 内）。
  - 分类：`401`/`503`/`400` → `console.error` 永久故障，`storage.delete('payload')`，return。`200` → drain 到底后 `storage.delete('payload')`，return（`skipped`/`done` 都算这次派发结束；业务结局看日志，**不判成功**）。fetch/drain **抛错或 5xx** → `attempts < 3` 时 **rethrow**（让平台按官方 2s 起指数退避重试，claim 保证重试只会 winner 或 skipped）；`attempts >= 3` → `console.error` + `storage.delete('payload')`。
  - ⚠️ **payload 绝不在 fetch 之前删除。**
- 模块级 `let INVOCATION_SEQ = 0`（与消费者同义，供内部路由切冷热）。

### 2. `worker/entry.ts`
`export { PlanRunDispatcher } from './planRunDispatcher'`。

### 3. `wrangler.jsonc`
- `durable_objects.bindings` 加 `{ "name": "PLAN_RUN_DISPATCHER", "class_name": "PlanRunDispatcher" }`
- `migrations` 追加 `{ "tag": "v2", "new_sqlite_classes": ["PlanRunDispatcher"] }`（`v1` 原样保留）
- `vars` 加 `"PLAN_AGENT_DISPATCH": "queue"`、`"PLAN_AGENT_DO_CANARY_USER_IDS": ""`

### 4. `lib/anitabi/cf/bindings.ts`
`CfBindingsEnv` 加结构子集：
```ts
PLAN_RUN_DISPATCHER?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> } }
```

### 5. `lib/planAgent/dispatch.ts`（新）
```ts
export type DispatchOutcome =
  | { transport: 'do'; state: 'accepted' | 'unknown' }
  | { transport: 'queue'; state: 'accepted' }
  | { transport: 'none' }          // 没有任何可用 transport → 调用方走内联 SSE
export async function dispatchRun(input: { env: CfBindingsEnv | undefined; message: PlanAgentQueueMessage; userId: string }): Promise<DispatchOutcome>
```
- 选择 DO 的条件：`process.env.PLAN_AGENT_DISPATCH === 'do'` **且** `env.PLAN_RUN_DISPATCHER` 存在 **且** `userId` 在 `PLAN_AGENT_DO_CANARY_USER_IDS`（逗号分隔）里。**白名单为空 = 没有人走 DO**。
- DO 调用：`stub = env.PLAN_RUN_DISPATCHER.get(env.PLAN_RUN_DISPATCHER.idFromName(message.runToken))`；`stub.fetch('https://plan-run-dispatcher/dispatch', { method:'POST', body: JSON.stringify(message), headers:{'content-type':'application/json'}, signal })`，**5 秒**超时（`AbortController` + `setTimeout`）。
- 三分类（联合方案 §3.3，**严格**）：
  - 响应 JSON `accepted === true` → `accepted`。
  - 响应 JSON `accepted === false` 且有 `reason` → **rejected** → 继续尝试队列（下一条）。
  - 超时 / 抛错 / 非 JSON / 其它状态码 → **unknown** → 返回 `{ transport:'do', state:'unknown' }`，**不**再投队列、**不**走内联（调用方仍返回 202）。`console.warn` 带 runToken。
- 队列：`process.env.PLAN_AGENT_QUEUE_ENABLED === '1'` 且 `env.PLAN_AGENT_QUEUE` 存在 → `queue.send({ ...message, transport:'queue' })` → `{ transport:'queue', state:'accepted' }`；send 抛错 → `{ transport:'none' }`（今天的内联回退语义不变）。
- ⚠️ `PLAN_AGENT_QUEUE_ENABLED !== '1'` 时**不得**因此选 DO（DO 只由 `PLAN_AGENT_DISPATCH` 决定）。

### 6. POST 路由
`queue.send` 那一段整体换成 `dispatchRun`：
- `accepted`（do 或 queue）→ `NextResponse.json({ queued:true, runToken, dispatchState:'accepted', transport }, { status:202 })`
- `do/unknown` → `NextResponse.json({ queued:true, runToken, dispatchState:'unknown', transport:'do' }, { status:202 })`
- `none` → 现有内联 SSE 路径（不动）。
`answerMetaPatch` 直写必须仍在派发之前；`dispatchedAt` 已由 Phase 0 设置。

### 7. 消息与埋点
- `queueMessage.ts`：`transport?: 'queue' | 'do'`（可选，不校验，与 `tier` 同策略）。
- 内部路由：读 `x-plan-agent-transport`，写进 timings seed 的 `transport`（`runTimings.ts` 加 `transport?: 'queue'|'do'|'inline'`，进 `[planAgent/timing]` 日志行与 `modelUsage.timings`）。内联路径 `transport:'inline'`。`consumerBatchAt`/`consumerSeq` 沿用现有头解析（DO 发的是同名头）。

## 测试
- `tests/worker/planRunDispatcher.test.ts`：用假 `ctx.storage`（Map + `setAlarm` spy）与假 env：
  - 首次 fetch → put payload、setAlarm(≈now)、`{accepted:true}`；重复 fetch → `{accepted:true, duplicate:true}` 且 setAlarm **不**再调；非法 body → 400 `{accepted:false, reason:'invalid'}`；`setAlarm` 抛错 → payload 被删、`{accepted:false, reason:'storage'}`。
  - alarm：payload 缺失 → 不 fetch；正常 200 → drain 后删 payload；401 → 删 payload 不重试；fetch 抛错且 attempts<3 → rethrow 且 payload **仍在**；attempts≥3 → 删 payload 不抛。
  - `x-plan-agent-transport: do` 与 `x-plan-agent-secret` 头存在。
- `tests/planAgent/dispatch.test.ts`：白名单空 → 不调 DO 直接队列；`PLAN_AGENT_DISPATCH=queue` → 不调 DO；DO `accepted:false` → 队列；DO 超时（假 stub 永不 resolve，用假定时器）→ `unknown` 且队列 **未**被调用；DO 抛错 → `unknown`；队列 send 抛错 → `none`。
- `tests/api/plan-agent-queue.test.ts`：既有精确断言补 `transport:'queue'`；`dispatchState` 字段出现在 202 响应。
- 内部路由：`x-plan-agent-transport: do` → timings.transport === 'do'；缺省 → 'queue'（队列消费者未改头时的兼容值，报告里说明）。
- `worker/` 文件仍不 import `@/`（用 grep 断言或注释说明）。

## 验收
```
npm run typecheck
npm test
```

## 报告
简短中文汇报：DO 类的 fetch/alarm 分类逻辑、`dispatchRun` 的三分类落点、wrangler 改了哪几行、两条验收命令的**实际输出**。不要 `git commit`。
