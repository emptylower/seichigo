# Phase 2-B：启动前奏读合并 + 观察流首帧加速 + 派发段埋点

worktree：`/Users/mac/Desktop/seichigo-wt-post` ／ 分支：`perf/prelude-consolidate`（已从 main 7c4cd15f 切出）

> 背景：生产 do-local 路径 6 次实测（2026-09-11 13:54–14:01）：浏览器首字中位 6.1–6.3s。服务端分段：
> `queueDispatchMs` 977–1528（POST 派发 → 消费者入口）、`loopStartMs` 292–426、`toModelRequestMs` 1180–1593、
> `realModelTtftMs` 978–1375。`toModelRequestMs − loopStartMs ≈ 0.9–1.2s` 是 loop 启动到发出模型请求之间的
> **串行 DB 往返**（pool=1、单次往返 0.164s）：`isAgentRunStopped` 1 + `listMessages` 1 + `getStageInputs` 1 +
> 首轮 `renewLease` 1，外加启动段 status 的强制 flush 排队。本批做三件互不相关的事，都不改架构：
> 1. 前奏三读合成**一条 SQL**（省 2 往返 ≈ 0.33s）
> 2. 观察流在 run 刚忙起来、还没推出第一帧 reasoning 之前用 200ms 轮询（省平均 ≈ 0.15–0.25s）
> 3. 派发段黑盒埋点（零行为）：把 `queueDispatchMs` 拆成 POST→DO 接纳、接纳→alarm 触发、alarm→handler 入口，
>    并记录 DO isolate 年龄——6/6 次 `consumerSeq=1` 疑似每次 alarm 都在全新 isolate 上跑（模块求值 ≈ 0.7s），
>    需要数据证实，作为下一刀（预分配 token 预热 DO）的依据。

## 效率要求
- **只读下面列出的文件**，不要读前端、不要读 `lib/billing/**`、不要 grep 全仓。
- **不要调用任何技能**，直接干活。
- `lib/planAgent/loop.ts` 是 750/750 行，**一行都不能加**；本批不需要改它。`line-budget.allowlist.json` 不许改。

### 必读文件
1. `lib/planAgent/loopPrelude.ts`（全文，~115 行）
2. `lib/tripPlan/repo.ts` 的 `TripPlanStageInputs`（:75）、`getStageInputs`/`listMessages`/`isAgentRunStopped`/`getRunSnapshotMeta` 声明
3. `lib/tripPlan/repoPrisma.ts` 的 `getStageInputs`（:178）、`listMessages`（:263）、`isAgentRunStopped`（:415）
4. `lib/tripPlan/repoMemory.ts` 对应三个方法
5. `prisma/schema.prisma` 的 `TripPlan` / `TripPlanMessage` / `TripPlanDay` / `TripPlanDayItem` 模型（只为写原生 SQL 时核对表名列名与 `@@map`）
6. `app/api/me/plans/[id]/agent/stream/route.ts`（全文）
7. `worker/planRunDispatcher.ts`（全文）、`lib/planAgent/runTimings.ts`（全文）、`app/api/internal/plan-agent/run/route.ts` 的 :80-110（consumer 头解析处）
8. 测试：`tests/planAgent/startupStatus.test.ts`、`tests/planAgent/streamRoute.test.ts`、`tests/api/plan-agent-stream.test.ts`、`tests/planAgent/runTimings.test.ts`（若存在）、`tests/worker/**`（若存在 planRunDispatcher 测试）

## 边界
允许改：上面 1–7 列出的源码文件 + 相关测试。
**绝不要改**：`lib/planAgent/loop.ts` / `execute.ts` / `dispatch.ts` / `resume.ts` / `runLive.ts`、`app/api/me/plans/[id]/agent/route.ts`、`app/(authed)/**`、`lib/billing/**`、`prisma/**`、`wrangler.jsonc`、`package.json`、`line-budget.allowlist.json`、`worker/entry.ts`。
不要 `git commit` / `push`；不要跑 `dev` / `build` / `cf:*` / `wrangler` / playwright / `prisma migrate`。

## 一、前奏三读合一（loopPrelude）

### 新仓储方法（repo.ts 声明 + Prisma + Memory 三处）
```ts
export type TripPlanStartupRead = {
  /** 计划当前 agentRunToken（null = 无 run） */
  agentRunToken: string | null
  stageInputs: TripPlanStageInputs
  /** 全量消息，createdAt 升序（与 listMessages 同口径、同类型） */
  messages: TripPlanMessage[]
}
/** loop 启动前奏一次性读取：busy 位归属 + 阶段推断输入 + 全量历史。计划不存在返回 null。必须是 **1 条 SQL / 1 次往返**。 */
getStartupRead(planId: string): Promise<TripPlanStartupRead | null>
```
- Prisma 实现**必须**是单条语句：用 `prisma.$queryRaw` 写一条原生 SQL（`TripPlan` 主行 + `EXISTS(...)` 子查询算 `hasPointItem`（条件与现 `getStageInputs` 完全一致：`pointId IS NOT NULL AND pointId <> ''`）+ `COALESCE((SELECT json_agg(json_build_object(...) ORDER BY "createdAt", id) ...), '[]'::json)` 聚合消息）。表名/列名以 `schema.prisma` 的 `@@map`/`@map` 为准，没有 map 就是模型名/字段名原样（带引号）。
  - `json_agg` 里 `createdAt` 回来是字符串 → `new Date(...)`；`content` 是 JSON 原样；`kind` 断言为 `TripPlanMessageKind`。`bangumiIds` 是 `Int[]`，$queryRaw 回来是 number[]。
  - **不要**用 Prisma 嵌套 `include`/`select` 关系（当前 relation load strategy 是分多条查询，`getPlan(PLAN_INCLUDE)` 就是 5 条）。
  - 排序必须与 `listMessages` 完全一致（`createdAt asc`）；同毫秒消息用 `id` 次排序稳定即可。
- 现有 `getStageInputs` / `listMessages` / `isAgentRunStopped` **保留不动**（别处在用）。

### loopPrelude.ts 改法
```ts
// 旧：isAgentRunStopped（可吞错）→ listMessages → getStageInputs 三次往返
// 新：一次 getStartupRead
const read = await deps.repo.getStartupRead(deps.planId)
const holdsRun = deps.runToken ? read !== null && read.agentRunToken === deps.runToken : true
const history = read?.messages ?? []
const stageInputs = read?.stageInputs ?? null
```
- 语义差异只允许一处：旧代码 `isAgentRunStopped` 读失败时吞错、`holdsRun=true`；新代码单读失败直接抛（与旧 `listMessages` 抛错一致——它本来就是致命的）。在注释里写明。
- `read === null`（计划被删）→ 与旧行为对齐：旧 `listMessages` 返回 `[]`、`getStageInputs` 返回 null、`holdsRun=false`（token 不匹配）。保持。
- `emitStartup('readHistory')` / `emitStartup('checkProgress')` 两条 status 的**发出顺序与时点**保持：`readHistory` 在读之前、`checkProgress` 在读之后推断之前（现在两条之间没有 IO 了，这是预期的）。
- 后面 `appendMessage`（`userMessagePersisted` 为 false 时）、`derivePlanStage`、`buildStageContext`、`pendingStageWrite` 逐字不变。

## 二、观察流首帧加速（stream/route.ts）
现状：`runSeenBusy` 之后每轮 `getRunSnapshotMeta` + `sleep(POLL_INTERVAL_MS=500)`。改成：
- 新常量 `LIVE_WARMUP_POLL_MS = 200`、`LIVE_WARMUP_MAX_MS = 15_000`。
- 在**本连接**已 `runSeenBusy`、且尚未推出过任何 `reasoning` 非空的 `live` 帧、且距 `runSeenBusy` 置位不足 `LIVE_WARMUP_MAX_MS` 时，`sleep(LIVE_WARMUP_POLL_MS)`；否则 `sleep(POLL_INTERVAL_MS)`。
- 「推出过 reasoning 非空的 live 帧」以 `send({type:'live', ...})` 时 `reasoning` 长度 > 0 为准（含 freshOpen 首帧）。
- await 宽限段（`AWAIT_POLL_MS`）不动；心跳、rotate、done 逻辑不动。
- 注释里写清：warmup 上限 15s 是为了工具型长 run 不会永远 200ms 轮询。

## 三、派发段埋点（零行为）
### worker/planRunDispatcher.ts
- 模块级 `const MODULE_EVAL_AT = Date.now()`（模块求值时刻；workerd 在纯 CPU 段冻结 Date.now，这个值在 I/O 后可用）。
- `fetch` 接纳时把 `acceptedAt`（已有，在 state 里）保留；alarm 里已有 `alarmStartedAt`。
- 两条派发分支（local / self-ref）都加头：
  - `x-plan-agent-do-accepted-at: <state.acceptedAt>`
  - `x-plan-agent-alarm-at: <alarmStartedAt>`
  - `x-plan-agent-isolate-age-ms: <alarmStartedAt - MODULE_EVAL_AT>`
  - `x-plan-agent-alarm-attempt: <state.attempts>`
- 其余行为逐字不变（接纳协议、重试、drain、awaitLocalBackgroundTasks）。

### app/api/internal/plan-agent/run/route.ts（:80-110 头解析处）+ lib/planAgent/runTimings.ts
- 解析上述四个头（缺失/非法则忽略，不报错，与现有 `x-plan-agent-consumer-at` 同样宽容）。
- `RunTimings` 新增可选字段：
  - `dispatchAcceptMs`：`doAcceptedAt − dispatchedAt`（POST 派发 → DO 接纳落盘）
  - `alarmLatencyMs`：`alarmAt − doAcceptedAt`（接纳 → alarm 触发）
  - `alarmToEntryMs`：`consumerEnteredMs − alarmAt`（alarm → 内部路由入口；do-local 就是 handler.fetch 的路由开销）
  - `isolateAgeMs`、`alarmAttempt`
- 三段之和应 ≈ 现有 `queueDispatchMs`；`queueDispatchMs` 本身不动。seed/collector 的传法照 `consumerBatchAt` → `selfRefHopMs` 的既有样式。

## 测试
- `getStartupRead`：Memory 实现单测（存在/不存在、消息顺序与 listMessages 一致、hasPointItem 三种情形：无 day / day 有 item 但 pointId 为 ''/null / 有真 pointId）。
- `loopPrelude`：`startupStatus.test.ts` 等凡 spy `isAgentRunStopped`/`listMessages`/`getStageInputs` 的用例改为 spy `getStartupRead`；新增：读抛错 → 传播；`read=null` → holdsRun=false 且 history=[]、stageInputs=null；token 不匹配 → holdsRun=false（不发 status、不落库，与旧用例同）。
- stream：新增用例——busy 后无 reasoning 时 sleep 200；推出 reasoning 非空 live 帧后 sleep 500；超过 15s 未出 reasoning 回到 500。可用 fake timers 或注入 sleep。
- runTimings：三段新字段的计算与缺头时不出现。
- planRunDispatcher：若已有测试，断言新头存在且数值关系正确；没有则不必新建 DO 测试基建。
- 既有全部测试仍绿。

## 验收
```
npm run typecheck
npm test
```
另外：**用 dev 库实际验证 `getStartupRead` 是 1 条 SQL** —— 写一个 `scratch/verify-startup-read.mjs`（照 `scratch/read-timings.mjs` 的 PrismaClient + PrismaPg 构造，连接串用 `process.env.DATABASE_URL`，它由 `.env` 提供，**不要**读 `.env.local`），任选一个有消息的计划 id，开 `log: [{ emit:'event', level:'query' }]` 计数，打印 SQL 条数与返回摘要。把输出贴进报告。

## 报告
简短中文汇报：`getStartupRead` 的 SQL 原文；loopPrelude 现在的往返数；stream 轮询状态机；四个新头与三段字段；验收两条命令 + 单 SQL 验证脚本的**实际输出**。不要 `git commit`。

## 四、埋点补充（Astra 评审后追加，2026-09-11 14:30；仍是零行为）
Astra 指出三处口径问题，按下面修正第三部分：
1. **接纳完成戳要打在 `setAlarm` 成功之后**：现在 `state.acceptedAt` 写在 `setAlarm` 之前，不能当"接纳完成"。在 `fetch` 里 `setAlarm` 返回后再取一次 `Date.now()` 作 `acceptedDoneAt`，写进 state（新字段，旧 state 缺它时头部省略）。头 `x-plan-agent-do-accepted-at` 改传 `acceptedDoneAt`；另加 `x-plan-agent-do-entered-at`（DO `fetch` 第一条语句的时刻）。
2. **模块 / 对象身份分开**：模块级 `const MODULE_INSTANCE_ID = crypto.randomUUID().slice(0,8)`（求值一次）；DO 构造函数里 `this.instanceId = crypto.randomUUID().slice(0,8)`。头 `x-plan-agent-module-id` / `x-plan-agent-do-instance-id`。这样能区分"对象重建但模块没重建"与"模块全新"——`consumerSeq=1` 分不出来。
3. **alarm 前奏单列**：`x-plan-agent-alarm-prelude-ms` = handler 调用前那一刻 − `alarmStartedAt`（含 get payload / get state / put state 三次存储 IO）。
4. runTimings 对应新增：`doIngressMs`（`doEnteredAt − dispatchedAt`）、`doAcceptMs`（`acceptedDoneAt − doEnteredAt`）、`acceptToAlarmMs`（`alarmAt − acceptedDoneAt`）、`alarmPreludeMs`、`alarmToEntryMs`（`consumerEnteredMs − (alarmAt + alarmPreludeMs)`）、`moduleId`、`doInstanceId`、`isolateAgeMs`、`alarmAttempt`。原第三部分里的 `dispatchAcceptMs`/`alarmLatencyMs` 用这些替代（不要两套并存）。
5. 注意 `dispatchedAt`（POST 里取，软截止用）与消息体 `enqueuedAt` 不是同一个戳；`doIngressMs` 以 `dispatchedAt` 为起点，并在 RunTimings 注释里写明。

## 五、评审修正（2026-09-11 14:52，code-review 结论）
1. **[HIGH] `createdAt` 时区**：`repoPrismaStartupRead.ts` 里 `json_build_object(... 'createdAt', m."createdAt")` 对 `timestamp(3)`（无时区）列输出的是不带偏移的字符串（如 `2026-09-10T06:45:40.014`），`new Date()` 会按**本地时区**解析——dev 库实测比 `listMessages` 差 8 小时（生产 workerd 是 UTC 所以碰巧对）。改成 `'createdAt', to_char(m."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`（或 `m."createdAt" AT TIME ZONE 'UTC'`），保证字符串带 `Z`。并把 `scratch/verify-startup-read.mjs` 加一项：同一计划 `getStartupRead().messages[i].createdAt.getTime()` 与 `listMessages()[i].createdAt.getTime()` 逐条相等，打印 `createdAtEqual: true`。
2. **[HIGH] Prisma 路径无测试**：`tests/tripPlan/repoStartupRead.test.ts` 只测了 Memory。新增一个用例 mock `prisma.$queryRaw`（照仓库里已有的 prisma mock 方式；若没有先例，用 `vi.mock('@/lib/db/prisma')` 之类）返回一条真实形状的行（`createdAt` 为带 `Z` 的字符串、`content` 为 JSON、`bangumiIds` 为 number[]、`hasPointItem` 为 boolean），断言映射后 `createdAt.getTime()` 等于预期瞬时、类型正确。
3. **[MEDIUM] `readHistory` 状态帧被合并掉**：`loopPrelude.ts` 现在读在 `emitStartup('readHistory')` 之前/之间无 IO，runLive writer 把 `readHistory` 与 `checkProgress` 合成一次落库，刷新恢复的客户端看不到「正在读取对话历史」。改法：**先发 `emitStartup('readHistory')`，再 `const readPromise = deps.repo.getStartupRead(...)`，`await` 它，然后 `emitStartup('checkProgress')`**——即 status 发出与 IO 之间保持原顺序（发 → 读 → 发）。把 `startupStatus.test.ts` 里被改成 2 次 upsert 的断言改回 3 次（若合并语义使其仍是 2 次，说明顺序没改对）。
4. **[LOW] 重连重复进入 warmup**：`stream/route.ts` 在 `after>0` 重连、基线 live 行已有 reasoning 时，不会再推 live 帧，于是白白 200ms 轮询 15s。在建立基线处（约 :195）若 `snap.live?.reasoning` 非空就把「已推出 reasoning 帧」标记置 true。补一个测试。
5. **[LOW] `tests/planAgent/loop.runLive.test.ts:76-80`** 的「某个补丁包含 reasoning」断言太松：改为断言按顺序拼接的 reasoningReplace/Append 序列包含该 reasoning，且它出现在最后一次带 reasoning 的补丁里。
验收同前：`npm run typecheck && npm test` + `node --env-file=.env scratch/verify-startup-read.mjs`（贴输出，要看到 `sqlCount=1` 与 `createdAtEqual: true`）。
