# 规划 run 前奏提速任务书（route prelude 2.4s + loop prelude 4.0s）

> **适用仓库**：`/Users/mac/Desktop/seichigo`（Next.js on Cloudflare Workers / OpenNext，Prisma 6.16 + Neon Postgres via Hyperdrive）
> **本任务书自足**：不需要任何对话上下文。所有行号基于当前 `main`（`e5fc3e4e`）。
> **不碰**：队列平台、前端、模型调用本身、POST→202 路径的既有优化。

---

## 0. 背景与基线

生产埋点实测（真实测量）：

| 段 | 耗时 | 本任务 |
|---|---|---|
| POST → 202 | 2.3s 热 / 3.9s 冷 | 不管 |
| 队列派发 | ~4.6s | 不管 |
| 自引用跳 | 3–7ms | 不管 |
| 内部路由 prelude（handler 入口 → `runPlanAgent` 入口） | **~2.4s** | ← 目标 |
| loop 入口 → 首次模型请求发出 | **~4.0s** | ← 主要目标 |
| 真实模型 TTFT | ~1.2s | 不管 |

**成本模型**：`lib/db/prisma.ts:43` `CLOUDFLARE_POOL_MAX = 1` —— 请求作用域 Prisma client 只有一条连接，同一请求内所有查询按 `pool.query()` 调用顺序 FIFO 严格串行，`Promise.all` 不会并行。接 Hyperdrive 后单次往返 **0.164s**。

关键路径上的往返（已逐条用 dev 库 Prisma query 事件核过）：

- **路由**：`getPlan(PLAN_INCLUDE)` 5 条 + `renewAgentRun` 1 条 + `getAccount` 3 条 = **9 条**
- **loop**：`isAgentRunStopped` 1 + `listMessages` 1 + `getPlan` 5 + `updateStage` 1 + `renewLease` 1 + runLive 启动段强制 flush 6（其中约 4 条卡在关键路径中间）= **约 13 条**

本任务砍掉其中 **17 条**。

---

## 1. ⚠️ 动工前必须先做的四件事（P0）

### ⚠️ P0-A：确认 loop 里的 Prisma client 作用域（**这是全案地基，先于任何一行代码**）

`executePlanAgentRun` 跑在 `app/api/internal/plan-agent/run/route.ts:122-135` 的 `new ReadableStream({ async start(controller) })` 里。若 OpenNext 的 AsyncLocalStorage 在这条流路径上还在，`getRequestScopedClientEntry()`（`lib/db/prisma.ts:145-177`）命中 → `max=1`，严格串行；若丢了 ALS，回落 `getGlobalPrismaClient()`（`lib/db/prisma.ts:122-128`，`DEFAULT_POOL_MAX=5`）→ 可并行。

**动作**：在 `lib/planAgent/loop.ts` 入口打一条日志，区分这两个分支走了哪个（也可以在 `lib/db/prisma.ts` 的两个分支各打一条一次性日志）。部署观察一轮。

**为什么必须先做**：CUT-6 与 CUT-7 的收益论证是"省排队"而不是"省往返"。若走的是全局池，**这两刀的收益直接归零**（正确性不受影响，只是白改）。同时"否决 `Promise.all` 并行化"这个结论也要重新评估。

### ⚠️ P0-B：dev 库 query 日志实测两条 SQL 形态，把**发出的 SQL 原文**贴进 PR

1. `prisma.tripPlan.updateManyAndReturn({ where: { id, agentRunToken }, data: { agentBusyUntil }, select: { userId: true } })`
   **要确认的不只是语句条数，而是 WHERE 是否仍携带 `agentRunToken`**。若被拆成 `SELECT ... WHERE id AND agentRunToken` + `UPDATE ... WHERE id IN (...)`，租约续租的原子性被削弱（实际危害有限——被越权写的只有 `agentBusyUntil`，不碰 `agentRunToken`，最坏是旧 run 替新 run 多延一次租——但这是必须知情后决策的事，不是报数问题）。
   *已有一次独立实测结果为单条 `UPDATE "TripPlan" SET "agentBusyUntil"=$1,"updatedAt"=$2 WHERE (id=$3 AND agentRunToken=$4) RETURNING "id","userId"` + COMMIT，且照常 bump `updatedAt`。实施者仍需复跑确认。*

2. `_count: { select: { days: { where: { items: { some: { pointId: { not: null, notIn: [''] } } } } } } }`
   确认**加上 `notIn` 之后**仍编译成 1 条 SQL。
   *已有一次独立实测：裸 `{ not: null }` 与 `{ not: null, notIn: [''] }` 都是 1 条，谓词为 `"t0"."pointId" IS NOT NULL AND "t0"."pointId" NOT IN ($1)`。仍需复跑。*

⚠️ 注意报数口径：实测今天的 `renewAgentRun` 发出的是 **UPDATE + COMMIT 两条协议往返**（`updateManyAndReturn` 同样两条）。路由 prelude 的"9 条 → 1 条"在协议层实际是"10 条 → 2 条"。收益数字不变（CUT-1 仍省满 5 条 `getPlan`），但验收埋点要对得上。

### ⚠️ P0-C：`lib/planAgent/loop.ts` 的行数硬预算

现状 **730 行**；`line-budget.allowlist.json` 的 `lineBudget` 是 **750**，`loop.ts` **不在** allowlist；`npm run test` 第一步就跑 `node scripts/check-line-budget.mjs`，超限即整轮测试失败。

CUT-3 / CUT-6 / CUT-7 全部落在 `loop.ts`，预计净增 12–18 行。

**规则**：
- 改完立刻跑 `node scripts/check-line-budget.mjs`。
- ⚠️ **禁止把 `loop.ts` 加进 allowlist**。
- 若超 750，必须先做一个**独立的、零行为变更的抽取 PR**（把启动段前奏抽进 `lib/planAgent/loopPrelude.ts`，仿照既有的 `lib/planAgent/loopFencing.ts`），不要把抽取挤在性能改动里顺手做——`loop.ts` 是全仓并发语义最密集的文件。

### P0-D：基线埋点读一轮

不需要新埋点：`lib/planAgent/runTimings.ts` 现成的 `markLoopStarted` / `markStatus` / `markModelRequestSent` / `markModelByte` 已经够用。**按 `consumerSeq` 分冷热两组**读满一轮作为 before 基线。

（可选）在 `listMessages` 与 `getStageInputs` 各加一对前后时间戳，把"往返数 × 单次往返"和"载荷/反序列化"分开——否则砍完 17 条可能发现还剩 2s 说不清。

---

## 2. 采纳的六刀

### CUT-1｜内部路由：删掉 `getPlan(PLAN_INCLUDE)`，把存在性 + `userId` 折进 `renewAgentRun`

**省 820 ms（5 条 SQL / 23.2 KB）**

**改哪些文件**
- `/Users/mac/Desktop/seichigo/lib/tripPlan/repo.ts`（接口 + 类型）
- `/Users/mac/Desktop/seichigo/lib/tripPlan/repoPrisma.ts`（`:302-309` 旁新增）
- `/Users/mac/Desktop/seichigo/lib/tripPlan/repoMemory.ts`（对应位置新增）
- `/Users/mac/Desktop/seichigo/app/api/internal/plan-agent/run/route.ts`（`:96-107`）

**改成什么**

```ts
// lib/tripPlan/repo.ts —— 接口新增
/** 续租并返回计划归属用户。token 不符与计划不存在都返回 null（同一语义）。 */
renewAgentRunOwner(planId: string, token: string, ttlMs: number): Promise<{ userId: string } | null>
```

```ts
// lib/tripPlan/repoPrisma.ts
async renewAgentRunOwner(planId: string, token: string, ttlMs: number) {
  const rows = await prisma.tripPlan.updateManyAndReturn({
    where: { id: planId, agentRunToken: token },
    data: { agentBusyUntil: new Date(Date.now() + ttlMs) },
    select: { userId: true },
  })
  return rows[0] ?? null
}
```

`repoMemory.ts` 用与既有 `renewAgentRun` 逐字相同的 where/data 语义实现，命中时返回 `{ userId: plan.userId }`，否则 `null`。

```ts
// app/api/internal/plan-agent/run/route.ts —— 原 :96-107 两段合并
const deps = await getTripPlanApiDeps()
const owner = await deps.repo.renewAgentRunOwner(body.planId, body.runToken, AGENT_BUSY_TTL_MS)
if (!owner) {
  return NextResponse.json({ skipped: 'stale_token' })
}
// 后续 plan.userId 全部改用 owner.userId
```

⚠️ **原 `renewAgentRun` 保留不动**——`lib/planAgent/execute.ts:63` 的 `renewLease` 仍在用它。

**为什么行为等价**

1. **消费点穷举**：本文件对 `getPlan` 结果只有两处消费——`:98` 的 `if (!plan)`、`:112` 的 `plan.userId`（`grep 'plan\.'` 在该文件只此一处）。`plan` 对象**没有**进 `executePlanAgentRun`（`:135-152` 入参列表里没有它）。days/items/point/point.i18n 四层嵌套（4 条 SQL + 绝大部分 23.2 KB）在本文件零消费。
2. **响应逐字节相同**：今天"计划不存在"走 `:99`、"token 不符"走 `:106`，两行是**同一个表达式 `NextResponse.json({ skipped: 'stale_token' })` 与同一个默认 200 状态码**，没有 status 参数差异。改后两种情况都由 `updateMany` 的 WHERE `{id, agentRunToken}` 匹配 0 行统一产生 `null`，响应表达式只剩一个。
3. **写副作用不变**：`data` 与 `where` 与今天的 `renewAgentRun` 完全相同。计划不存在时匹配 0 行、不写任何东西（今天这种情况走不到 `renewAgentRun`，改后走到了但影响 0 行，不可观测；最多多开一个空事务）。
4. **栅栏语义不变**：`renewAgentRun` 本身没动，它仍是"续租 + 持有权判定"的唯一实现点，只是多带回一列。删掉 `getPlan`（纯读）不改变它的语义。
5. **`updatedAt` 不是问题**：观察流的 `plan_updated` 判据是 `composePlanRevision`（`lib/tripPlan/repo.ts:335-353`），文件注释明写它**刻意排除 `updatedAt`**正是为了不被续租心跳误报（`lib/tripPlan/repoPrisma.ts:462-463`）。`updatedAt` 在这条路径上不是判据。
6. **`userId` 是不可变列**，不存在读到旧值的问题。

**⚠️ 硬性约束**
- ⚠️ P0-B 的 SQL 原文必须贴进 PR，**按正确性核对而不是按报数核对**（见 P0-B）。
- ⚠️ 若发现被拆成两条且第二条的 WHERE 丢了 token：降级为 `renewAgentRun()` + `findUnique({ where: { id }, select: { userId: true } })`，仍省 4 条（656 ms），并在 PR 里说明。

---

### CUT-2｜内部路由：`getAccount` 三读 → 队列消息透传 `tier`

**省 492 ms（3 条 SQL）**，对新 POST 投的消息生效。

**改哪些文件**
- `/Users/mac/Desktop/seichigo/lib/planAgent/queueMessage.ts`
- `/Users/mac/Desktop/seichigo/app/api/me/plans/[id]/agent/route.ts`（`:217-229` 的 `queue.send`）
- `/Users/mac/Desktop/seichigo/app/api/internal/plan-agent/run/route.ts`（`:109-119`）
- `/Users/mac/Desktop/seichigo/tests/api/plan-agent-queue.test.ts`（`:116`、`:146` 两处精确断言）

**改成什么**

```ts
// lib/planAgent/queueMessage.ts —— 遵守本文件既有的「零 import」纪律，
// 像 QueueSupportedLocale 一样就地重复字面量联合并加同步注释
type QueueTier = 'free' | 'standard' | 'pro'

export type PlanAgentQueueMessage = {
  v: 1
  // ...既有字段不变
  /**
   * 授权本次 run 的档位快照 —— POST 时刻 getAccount 得到的**有效 tier**
   * （已含 F2 降档），**不是消费时刻的档位**。缺失或无法识别时，消费者
   * 必须回落到 getAccount 三读，绝不能回落 free。
   */
  tier?: QueueTier
}
```

⚠️ **`isPlanAgentQueueMessage` 不得对 `tier` 做任何"不认识就拒"的校验**。允许的最强写法是 `msg.tier === undefined || typeof msg.tier === 'string'`；推荐**完全不校验**（未知字段本来就被忽略）。

```ts
// app/api/me/plans/[id]/agent/route.ts —— queue.send 载荷加一个字段
tier: account.entitlements.tier,   // account 在 :136 已断言非 null；:188 的 billingInput 同源，零成本
```

```ts
// app/api/internal/plan-agent/run/route.ts
const QUEUE_TIERS = new Set(['free', 'standard', 'pro'])
const TIER_PASSTHROUGH_MAX_AGE_MS = 120_000
const enqueuedAge = Date.now() - Date.parse(body.enqueuedAt)

const passthroughTier =
  process.env.PLAN_AGENT_TIER_PASSTHROUGH !== '0' &&
  typeof body.tier === 'string' &&
  QUEUE_TIERS.has(body.tier) &&
  Number.isFinite(enqueuedAge) &&
  enqueuedAge >= 0 &&
  enqueuedAge <= TIER_PASSTHROUGH_MAX_AGE_MS
    ? (body.tier as Tier)
    : null

const billing = passthroughTier
  ? { entitlements: TIER_ENTITLEMENTS[passthroughTier], runCapMicros: runCapMicros(passthroughTier) }
  : /* 今天 :111-119 的 getAccount 三读 + free 兜底，逐字不变，userId 用 owner.userId */
```

**为什么行为等价**

1. **能力表是 `tier` 的纯查表函数**：`lib/billing/service.ts:111` `entitlements: TIER_ENTITLEMENTS[tier]`（`lib/billing/tiers.ts:32` 的 `Record<Tier, Entitlements>`）、`:118` `runCapMicros: runCapMicros(tier)`（`lib/billing/budget.ts:11-13`，两个都是 tier 索引的常量表）。`isAdmin` 不参与（它只影响 `canStartRun`/`reserveRun`）。`hasEntries` + `balance` 那两条 SQL 的唯一产出是 `balanceMicros`/`remainingPercent`/`budgetMicros`，内部路由 `:117-119` 一个都不用。
2. **传的是有效 tier**：`Entitlements` 带 `tier` 字段（`lib/billing/tiers.ts`），且 `TIER_ENTITLEMENTS[t].tier === t` 逐档成立；`account.entitlements.tier` 拿到的是 F2 降档分支（`service.ts:68-82`）**之后**装配的档位。
3. **userId 同一**：POST `:55` 断言了 `plan.userId === session userId`。
4. **写副作用不丢**：`getAccount` 的三个写分支——F2 降档 `service.ts:73`、周期滚动 `:89`、首次 grant `:96-103`——在 POST 侧同一次用户操作里已经执行过（POST `:49` 的 `Promise.all` 无条件先发，早于 stop/emptyMessage/nothing_to_resume 所有提前返回），且各自的条件在执行后都翻假（`periodEnd` 被刷到未来、`hasEntries` 变真）。所以今天内部路由的 `getAccount` 在任何可达路径上都是**纯读**。
5. **不会重放**：`wrangler.jsonc:30-38` `max_retries: 0`，`worker/planAgentConsumer.ts` 无论成败一律 `message.ack()`。
6. **在途兼容**：`worker/planAgentConsumer.ts` 转发的是 `JSON.stringify(message.body)` 原体，新增可选字段在新旧两个方向都能穿过；fetch 与 queue 是同一个 Worker 同一次部署（`wrangler.jsonc` `main=worker/entry.ts`），不存在两 bundle 漂移。
7. **对齐既有语义**：内联 SSE 路径**今天就已经**用 POST 时刻的能力表（`app/api/me/plans/[id]/agent/route.ts:188 billingInput → :275 billing: billingInput`）。本刀不是引入新的陈旧性，是把队列路径拉齐到内联路径。
8. **messages 不变**：`entitlements` 只经 `loop.ts:301` 的 `tierPromptNote` 进 system 消息，tier 相同则该串逐字节相同。

**⚠️ 硬性约束**
- ⚠️ **校验器只容忍不判定**。若 `isPlanAgentQueueMessage` 因不认识的 `tier` 返回 `false` → 内部路由 400 → 消费者 `console.error` 后**无条件 `ack()`**（`max_retries: 0`）→ **消息被彻底销毁**；此时 human 消息已落库、busy 锁占着 90 秒，用户这一轮只能靠 TTL 过期 + `interrupted→resume` 找回，而 POST 已 `reserveRun` 的预扣要等 `STALE_RESERVE_AFTER_MS`（16 分钟）的孤儿清扫才退。将来加第 4 档（如 `'team'`）时，滚动窗口内就会触发这条。
- ⚠️ **缺失/不认识 → 回落 `getAccount`，绝不回落 `TIER_ENTITLEMENTS.free`**（滚动部署窗口内会让付费用户静默失去能力且无报错）。`free` 兜底只保留在今天原本的位置：`getAccount` 抛错或返回 `null`。
- ⚠️ **也绝不"干脆不传 entitlements"**：`loop.ts:153` 的 `entitlements?` 是可选参数，不传等于 `:301`/`:345`/`:357`/`:369` 全部放开（无禁用工具、无 `maxDays` 上限），是反向越权，比降档更糟。
- ⚠️ **陈旧性窗口不是 4.6s**。内部路由对 `body.enqueuedAt` 今天没有任何年龄检查，`SOFT_DEADLINE_MS`（13 分钟）只管执行不管消息年龄；`wrangler.jsonc` 配的是 `max_concurrency=10`、`max_batch_size=1`，超过 10 个计划并发时消息会在队列里排分钟级。真实上界是队列深度。上面的 `TIER_PASSTHROUGH_MAX_AGE_MS` 就是为此加的——**必须实现**，或者在验收记录里明确写下接受无上界。
- ⚠️ `tests/api/plan-agent-queue.test.ts:116` 与 `:146` 是 `toHaveBeenCalledWith({完整对象})` 的精确深比较，加 `tier` **必挂**，同 PR 内改。

---

### CUT-3｜loop 前奏：`getPlan(PLAN_INCLUDE)` → 阶段推断专用轻量投影

**省 656 ms（4 条 SQL），线上少传 ~23 KB**

**改哪些文件**
- `/Users/mac/Desktop/seichigo/lib/tripPlan/repo.ts`（类型 + 接口）
- `/Users/mac/Desktop/seichigo/lib/tripPlan/repoPrisma.ts`
- `/Users/mac/Desktop/seichigo/lib/tripPlan/repoMemory.ts`
- `/Users/mac/Desktop/seichigo/lib/planAgent/stage.ts`（`:50-59`）
- `/Users/mac/Desktop/seichigo/lib/planAgent/loop.ts`（`:278-291`）
- `/Users/mac/Desktop/seichigo/tests/planAgent/stage.test.ts:78`

**改成什么**

```ts
// lib/tripPlan/repo.ts
export type TripPlanStageInputs = {
  bangumiIds: number[]
  startDate: Date | null
  dayCount: number
  /** 是否存在任一 items[].pointId 为真值（非 null 且非空串）的条目 */
  hasPointItem: boolean
}
// 接口新增
getStageInputs(planId: string): Promise<TripPlanStageInputs | null>
```

```ts
// lib/tripPlan/repoPrisma.ts
async getStageInputs(planId: string): Promise<TripPlanStageInputs | null> {
  const row = await prisma.tripPlan.findUnique({
    where: { id: planId },
    select: {
      bangumiIds: true,
      startDate: true,
      dayCount: true,
      _count: { select: { days: { where: { items: { some: { pointId: { not: null, notIn: [''] } } } } } } },
    },
  })
  if (!row) return null
  return {
    bangumiIds: row.bangumiIds,
    startDate: row.startDate,
    dayCount: row.dayCount,
    hasPointItem: row._count.days > 0,
  }
}
```

```ts
// lib/tripPlan/repoMemory.ts —— ⚠️ 必须用与 stageInputsOfPlan 逐字相同的 JS 谓词
hasPointItem: plan.days.some((day) => day.items.some((item) => item.pointId))
```

```ts
// lib/planAgent/stage.ts
export function derivePlanStage(input: {
  plan: TripPlanStageInputs          // ← 由 TripPlanWithDays 改为此
  messages: TripPlanMessage[]
  quality: PlanQualityReport | null
}): PlanStage {
  const { plan, messages, quality } = input
  if (!plan.bangumiIds.length) return 'works'
  if (!plan.startDate || plan.dayCount <= 1) return 'dates'
  if (!plan.hasPointItem) return 'points'          // ← 原 :58-59 两行合并
  if (quality && !quality.passed) return 'enrich'
  // 以下（lastDaymapIndex / humanAfterDaymap / deliver / revise）一行不动
}

/** 持有完整 plan 的调用方（测试、任何未来调用点）用它构造 stage 输入 */
export function stageInputsOfPlan(plan: TripPlanWithDays): TripPlanStageInputs {
  return {
    bangumiIds: plan.bangumiIds,
    startDate: plan.startDate,
    dayCount: plan.dayCount,
    hasPointItem: plan.days.some((day) => day.items.some((item) => item.pointId)),
  }
}
```

```ts
// lib/planAgent/loop.ts:280
const stageInputs = await deps.repo.getStageInputs(deps.planId)
if (stageInputs) {
  const lastDaymap = [...stageHistory].reverse().find((m) => m.kind === 'daymap')
  const quality = lastDaymap ? parseDaymapPayload(lastDaymap.content)?.quality ?? null : null
  stage = derivePlanStage({ plan: stageInputs, messages: stageHistory, quality })
  stageContext = buildStageContext(stage, quality)
  // updateStage 见 CUT-6
}
```

**为什么行为等价**

1. **输入最小充分集（穷举）**：`derivePlanStage`（`stage.ts:55-65`）对 `plan` 的**全部**读取只有 `plan.bangumiIds`（仅 `.length`，`:56`）、`plan.startDate`（`:57`）、`plan.dayCount`（`:57`）、`plan.days.length`（`:59`）、`plan.days[].items[].pointId` 的真值（`:58`）。不读 `plan.stage` / `title` / `status` / `userId` / `preferences` / `updatedAt`，不读 `day.dayIndex`/`date`/`citySlug`/`summary`，不读 `item` 的任何其它列，**更不读 `item.point`**——而 `item.point`（`POINT_SELECT`，`repoPrisma.ts:25-34`，含 `i18n where language='en' take 1`）正是 `PLAN_INCLUDE` 第 4、5 条 SQL 的全部理由。
2. **`days.length` 可证冗余**：`!plan.days.length || !hasPointItem ≡ !hasPointItem`。`[].some()` 恒为 `false`，故 `hasPointItem===true ⟹ days.length>=1`；`days.length===0 ⟹ hasPointItem===false`。四格真值表两式取值完全相同。
3. **SQL 谓词与 JS 谓词逐格对齐**：JS 的 `item.pointId` 真值 ⟺ 非 `null` 且非空串。故过滤条件写 `{ not: null, notIn: [''] }` 而不是裸 `{ not: null }`——避免 `pointId=''` 这一格把 `points` 误判成 `enrich`/`deliver`。
4. **`_count` 必须带 `where`**：裸 `_count: { days: true }` 只回答"有几天"。一个有 3 天、条目全是外部地点（`pointId=null`）的计划会被误判成 `enrich`/`deliver` 而不是 `points`——`tests/planAgent/stage.test.ts:97-102` 有现成用例覆盖这一格。
5. **判定顺序与短路不变**：`works → dates → points → enrich → lastDaymapIndex<0 → deliver/revise` 一行未动。messages 侧（`:61` `findLastIndex kind==='daymap'`、`:64` `humanAfterDaymap`）完全不碰。
6. **`quality` 与 `getPlan` 无关**：它来自 `loop.ts:282-283` 的最后一条 daymap 消息（`listMessages` 产出）。
7. **`buildStageContext` 不读 plan**：`stage.ts:115-127` 只读 `(stage, quality)`；调用点 `loop.ts:285` 只传两个参数，`:119-122` 的 `enrich` 分支在本路径是死码。所以 `stageContext` 是 `(stage, quality)` 的纯函数，两者都已证明不变。
8. **空计划语义不变**：`findUnique` 对不存在的行仍返回 `null`，守卫行为一致，`stage` 仍留在 `'works'`、`stageContext` 仍为 `''`。
9. **字段值逐字节相同**：`toPlan`（`repoPrisma.ts:86-101`）是逐字段直拷、没有任何归一化，所以 select 投影出的 `bangumiIds`/`startDate`/`dayCount` 与今天相同。
10. **仓储包装层安全**：loop 里的 `deps.repo` 被两层包过——`withModelUsageInRunLog`（`lib/planAgent/api.ts:326-348`）与 `withFencing`（`lib/planAgent/loopFencing.ts:38-45`）——**两者都是透明转发 Proxy**，新增仓储方法穿得过去，两处都不用改。
11. **blast radius 有界**：`derivePlanStage` 全仓调用点 grep 穷举只有 `loop.ts:284` 与 `tests/planAgent/stage.test.ts:78`。`TripPlanRepo` 的实现只有 `PrismaTripPlanRepo` 与 `MemoryTripPlanRepo` 两个（唯一的 `as unknown as TripPlanRepo` 在 `tests/planAgent/api.test.ts:428`，只喂 `appendRunLog`）——接口加必填方法会在 typecheck 阶段兜住。

**⚠️ 硬性约束**
- ⚠️ **必须用带 `where` 的过滤型 relation count**，不得用裸 `_count: { days: true }`（见论证 4）。
- ⚠️ **必须写 `{ not: null, notIn: [''] }`**（见论证 3）。等价性论证不该建立在"几乎不可能"上。若 P0-B 实测发现加 `notIn` 后变成两条 SQL：先确认生产库确无 `pointId=''` 的行，再考虑退回裸 `{ not: null }`；**没有生产数据核对就不许退**。
- ⚠️ **`derivePlanStage` 的参数必须改成显式 `hasPointItem: boolean`，不许"结构性放宽类型"**。结构性放宽（`Pick<TripPlan,...> & { days: Array<{ items: Array<{ pointId: string | null }> }> }`）能让测试一行不改，但它把"轻量投影必须自带点位存在性谓词"这个契约藏起来了——将来有人传一棵被截断的 days 树进来，类型检查照过、stage 静默变错。
- ⚠️ 本刀落在 `loop.ts`/`stage.ts`，**内联 SSE 路径同样吃到**，没有运行时开关。它的安全网是测试（见 §4），回滚是 `git revert`。

---

### CUT-6｜loop 前奏：`updateStage` 的**发起时刻**推到首次模型请求发出之后，并加栅栏

**省 164 ms（1 条 SQL）**

**改哪些文件**
- `/Users/mac/Desktop/seichigo/lib/planAgent/loop.ts`（`:286-290` 删；模型请求处新增派发点）
- `/Users/mac/Desktop/seichigo/lib/tripPlan/repo.ts` / `repoPrisma.ts` / `repoMemory.ts`（新增 `updateStageIfActive`）

**改成什么**

```ts
// lib/tripPlan/repo.ts / repoPrisma.ts —— 新增带栅栏的写
async updateStageIfActive(planId: string, token: string, stage: string): Promise<void> {
  await prisma.tripPlan.updateMany({ where: { id: planId, agentRunToken: token }, data: { stage } })
}
```

```ts
// lib/planAgent/loop.ts —— 前奏块
let pendingStageWrite: PlanStage | null = null
if (stageInputs) {
  // ...derivePlanStage / buildStageContext 不变
  pendingStageWrite = stage        // ← 取代原来的 try { await deps.repo.updateStage(...) } catch {}
}
```

```ts
// lib/planAgent/loop.ts —— 首次模型请求处（原 :446-447 附近）
runTiming?.markModelRequestSent()
const modelCall = deps.createMessage(
  { messages: sanitizeHistoryForModel(messages), tools: modelTools, signal: modelAbort.signal },
  onDelta,
)
afterModelRequestIssued()          // ← 见下（CUT-6 与 CUT-7 共用同一个释放点）
response = await modelCall
```

```ts
// 释放点辅助（放在 loop 顶层闭包里，两刀共用，控制行数）
const afterModelRequestIssued = () => {
  runLiveWriter?.releaseStartupFlush()                        // CUT-7
  const s = pendingStageWrite
  pendingStageWrite = null
  if (!s) return
  const write = deps.runToken
    ? () => deps.repo.updateStageIfActive(deps.planId, deps.runToken!, s)
    : () => deps.repo.updateStage(deps.planId, s)             // 无 token（单测/旧调用）走今天的无栅栏写
  ;(deps.runInBackground ?? runInBackground)(() => write().catch(() => undefined))
}
```

**为什么行为等价**

1. **写的值逐字相同**（同一个 `stage` 变量），只是发生时刻晚约一个模型请求发出的距离。
2. **前奏没有任何读者**：`derivePlanStage` 全程不读 `plan.stage`（论证见 CUT-3 第 1 条）；loop 内没有第二个读者（`grep '\.stage'` 在 `lib/planAgent/` 只命中注释与 `resume.ts:33` 的 `runLog.stage`，那是另一张表的另一个字段）。
3. **⚠️ `TripPlan.stage` 的真实读者有两个，不是一个**：
   - `lib/tripPlan/view.ts:51` 的 `toPlanView`（进 GET 计划的响应载荷）——`repo.ts:57` 已把它定义为"仅展示用，真值由证据推断"，且 C 端计划页不渲染它（`grep` `app/` 与 `components/` 零命中；`handlers/planById.ts:67` 读的是 `runLog.stage`，另一个字段）。
   - **`repoPrisma.ts:474 stage: true` → `:496 composePlanRevision`（`repo.ts:335-353`）→ 观察流 `plan_updated`（`app/api/me/plans/[id]/agent/stream/route.ts:213`）**。队列路径上 `onEvent` 是 no-op，观察流是用户唯一可见通道。所以本刀的可见效果是"一次 `plan_updated` 被推迟一个模型请求的距离"。今天这次写本来也发生在 run 开始后约 2.5 秒，推迟后仍落在同一个"run 进行中"的窗口内，无 UI 影响——**但论证必须写成这一条，不是"只有 view.ts 读它"**。
4. **加栅栏比今天更安全，而非改变语义**：今天 `updateStage` 是 `repoPrisma.ts:354-356` 的**无栅栏 `updateMany`（where 只有 id）**，但它执行的时刻我们必然持有 token，所以"gate on token"在那一刻是恒真的。把写推后之后，恒真不再成立——`updateStageIfActive` 正是把"写发生时我们仍持有 run"这条今天隐含成立的性质显式化。不加它的后果：run A 算出 `stage='enrich'` → 用户停止 → 用户再发一条 → run B 写下 `stage='revise'` → run A 的延后写把它覆写回 `'enrich'`，触发一次凭空的 `plan_updated` + 客户端全量 refetch，且 stage 缓存一直错到下一次 run。
5. **`pool=1` 下光去 `await` 没用**：未 `await` 的写只要在模型请求之前被**发起**，就会 FIFO 占住那条唯一连接（活证据：runLive 的 flush#1/#2 发起点在关键查询之前，实打实拖慢了 `getPlan`；flush#3 发起点被推到 `renewLease` 之后就免费）。所以**落点必须在模型请求确实发出之后**。

**⚠️ 硬性约束**
- ⚠️ **派发点在 `deps.createMessage(...)` 被调用之后（拿到 promise、`await` 之前），不是在它 resolve 之后。** 若挂在 resolve 之后，首次模型调用抛错（网络错误 / `RunFencedError` / abort）就**完全不写** stage，而今天是无条件写——那是新增的丢弃路径，不是原注释所说的"写失败可忽略"。同时，`createChatCompletion` 内部第一件事是 `await resolveLlmForScope('agent')`（`lib/planAgent/api.ts:212-220`），调用一发出、provider 查询（若缓存未命中）就已排上连接，我们的后台写自然排在它后面——这是最优顺序。
- ⚠️ **内层 `.catch(() => undefined)` 必须保留**：今天的失败是静默吞掉；`runInBackground` 自己会 `console.warn`，加了 catch 才保持原样。
- ⚠️ 已知取舍（写进 PR 描述）：run 在首个模型回合前被硬杀 → 这一轮不写 stage。这正是今天注释明确接受的（"阶段缓存写失败不影响本轮对话"），下一轮 run 会重新推断并回写。
- `runInBackground`（`lib/planAgent/serverDeps.ts:69`）依赖 `getCfBindings()?.ctx`；拿不到时降级为浮动 promise。本场景可接受——内部路由的心跳响应流在 run 结束前一直开着。且 `loop.ts:8` 已 import、`:110` 已有 `deps.runInBackground?`、`:706` 的补齐续跑已在生产上跑同一条路，可达性有先例。

---

### CUT-7｜runLive：启动段三次强制 flush（6 条 SQL）压成一次并后移

**省 656 ms（4 条 SQL）** ｜ ⚠️ **全案唯一有用户可见变化的一刀** ｜ ⚠️ **独立开关，独立部署窗口，最后上**

**改哪些文件**
- `/Users/mac/Desktop/seichigo/lib/planAgent/runLive.ts`（`:22-28` Deps、`:30-42` 接口、`:129-143` status 分支）
- `/Users/mac/Desktop/seichigo/lib/planAgent/loop.ts`（`:230-232` writer 构造 + 释放点）
- `/Users/mac/Desktop/seichigo/lib/planAgent/execute.ts`（⚠️ **原清单漏了这个文件**——`ExecutePlanAgentRunInput` 是必经之地）
- `/Users/mac/Desktop/seichigo/app/api/internal/plan-agent/run/route.ts`（读开关传下去）

**改成什么**

```ts
// lib/planAgent/runLive.ts
// Deps 新增：
holdStartupFlush?: boolean
// Writer 接口新增：
releaseStartupFlush(): void

let startupHeld = deps.holdStartupFlush === true

// status 分支（:136-142）
if (statusChanged) {
  if (startupHeld) return       // 只更新内存 statusText + dirty，不排 flush
  queueFlush()
  return
}

function releaseStartupFlush(): void {
  if (!startupHeld) return      // ⚠️ 未持有时严格 no-op
  startupHeld = false
  if (dirty) queueFlush()
}
```

`execute.ts`：`ExecutePlanAgentRunInput` 加 `deferStartupRunLive?: boolean`，透传进 `runPlanAgent` 的 deps。
`loop.ts:230-232`：构造 writer 时传 `holdStartupFlush: deps.deferStartupRunLive === true`；释放点见 CUT-6 的 `afterModelRequestIssued()`。
内部路由：`deferStartupRunLive: process.env.PLAN_AGENT_STARTUP_RUNLIVE_DEFER === '1'`（**默认关**，第三个窗口再开）。
⚠️ **内联 SSE 路径不传**，`holdStartupFlush` 为 `false`，实况写库行为逐字不变。

**为什么行为等价（以及哪里不等价）**

1. **SSE 事件流逐字节不变**：三条 status 仍在 `loop.ts:264`/`:277`/`:405` 原地发出，仍经 `forwardEvent → onEvent` 下发。本刀只改 runLiveWriter 这条旁路的**落库时机**。队列路径上 `onEvent` 是 `route.ts:143` 的 `() => undefined`，根本没有 SSE 消费者。
2. **stage 推断与 messages 数组完全不涉及**：runLive 是纯旁路，loop 从不读回它。
3. **今天那三行本来就极少被完整看到**：观察流的落库/轮询节奏是 500 ms，而本方案落地后 `readHistory → organize` 之间只剩 `listMessages`(164ms) + `getStageInputs`(164ms) + 亚毫秒级纯 CPU（实测 `sanitizeChatHistory` 0.011ms、`sanitizeHistoryForModel` 0.101ms、prompt 拼接 0.002ms），三条文案的间隔已小于观察流的分辨率。
4. **`organize` 的绝对时刻更早**：今天它排在三次 flush 拉长的 0.66s 之后。2026-09-10 首帧优化的意图（TTFT 黑屏期不能挂通用兜底文案）被完整保住——黑屏期挂的正是 `organize` 这句。
5. **⚠️ 但可见变化比"三条变一条"更大**：观察流的首帧分支（`stream/route.ts:176-186`）是 `if (snap.live)` 才发，live 推送键是 `snap.live.updatedAt`（`:191`）。启动 flush 全部延后后，run 早期 `TripPlanRunLive` 行**根本不存在**，一个 freshOpen 的观察者拿到的首帧可能完全没有 live 载荷。**验收时必须专门看"刷新恢复"场景。**
6. **净安全性提升（必须锁死）**：释放点在 `loop.ts:434` 的 `renewLease` **之后**——被接管/被停止的 run 在那里就抛 `RunFencedError`，永远走不到释放点，**一条也不落库**。而今天的 flush#3 在 `:405` 发起，排在 `renewLease` 之前，反而可能以旧 token 落笔覆盖新 run 的实况行。
7. **停止路径**：`stopAgentRun` 用**我们自己的 token** 写 `RUN_STOP_MARKER`（`repoPrisma.ts:337`），释放时 `sameRun=true` 触发 `preservedMarker`（`repoPrisma.ts:418`）粘住标记；同时 `agentBusyUntil` 已被清空 → live 判定返回 null，观察流按 `done{stopped}` 正常收幕。
8. **排队关系不劣于今天**：今天模型请求前排着 flush#3 的 2 条 + `renewLease` 的 1 条共 3 条；改后是 flush 的 2 条（`renewLease` 保留但在 `:434` 已先行完成）。

**⚠️ 硬性约束**
- ⚠️ **释放点必须在 `loop.ts:434` 的 `renewLease` 之后**。这是本刀相对今天的净安全性提升（见论证 6），**必须写成代码注释 + 一条测试锁死**，否则后人为了再省 100ms 把释放点前移，就会静默退回"旧 token 可能落笔覆盖新 run 实况行"的状态。
- ⚠️ `releaseStartupFlush()` 在内联 SSE 路径也会被无条件调用，**实现上必须"未持有时严格 no-op"**，否则会给 SSE 路径凭空多一次 `upsertRunLive`。
- ⚠️ 独立开关 `PLAN_AGENT_STARTUP_RUNLIVE_DEFER`，**默认关**，单独一个部署窗口，排在最后。
- ⚠️ 收益是全案最不牢的一个数——它依赖 P0-A 的结论。若 loop 走全局池（`max=5`），flush 走另一条连接，收益归零而用户可见成本照付：**P0-A 结论为全局池时，直接不做 CUT-7。**

---

### CUT-8｜标题侧信道：`title.ts` 的 `getPlan` → 只取 title 的投影

**省 0–656 ms（争用性收益，不计入确定性总账）** ｜ 全案性价比最高、风险最低，建议**第一个上**

**改哪些文件**
- `/Users/mac/Desktop/seichigo/lib/planAgent/title.ts`（`:29-30`）
- `/Users/mac/Desktop/seichigo/lib/tripPlan/repo.ts` / `repoPrisma.ts` / `repoMemory.ts`

**改成什么**

```ts
// repo 新增
getPlanTitle(planId: string): Promise<string | null>
// Prisma 实现
const row = await prisma.tripPlan.findUnique({ where: { id: planId }, select: { title: true } })
return row?.title ?? null
```

```ts
// lib/planAgent/title.ts:29-30
const title0 = await deps.repo.getPlanTitle(deps.planId)
if (title0 === null || title0 !== DEFAULT_PLAN_TITLE) return
```

**为什么行为等价**
`maybeSetGeneratedTitle` 对 `getPlan` 结果的消费点只有 `title.ts:30` 一行：`if (!plan || plan.title !== DEFAULT_PLAN_TITLE) return`——只用存在性与 `title`，days/items/point 三层嵌套零消费。`TripPlan.title` 在 schema 与领域类型（`repo.ts:47`）里都是非空 `string`，所以 `row?.title ?? null === null` 唯一对应"计划不存在"，与 `!plan` 是同一判定（`??` 只吃 `null`/`undefined`，空串会原样返回 `''` 并被第二个条件挡掉，与今天一致）。写入侧 `updateMeta`、"刻意不走 run-token 栅栏"、"失败静默吞掉"三条既有语义（`title.ts` 文件头注释）一行未动。本刀完全不在主 loop 的读写序列上。

**收益说明**：它跑在 `execute.ts:68-123` 的 `Promise.all` 另一支上，落点取决于标题模型耗时（约 1–2s），在 `pool=1` 下会与主 loop 的 `listMessages`/`getStageInputs`/`renewLease` 抢同一条连接；抢中就省 4 条，没抢中就省 0。⚠️ **不要拿它凑 KPI**——列在这里是因为它以近乎零风险移走了每一轮对话固定 5 条 SQL 的连接争用。

---

## 3. 明确不做

### ❌ CUT-4：删掉 `loop.ts:257` 的 `isAgentRunStopped`，由路由传 `runHeldAtEntry`（原估 164 ms）

**不做的理由（三条独立）**：

1. **它移除的是 `loop.ts:250-253` 注释点名的一条并发防线**（"被接管的 run 不发也不落库，旧 token 落笔会覆盖新 run 的实况行"）。方案的等价性论证有一处事实错误：它称 `preservedMarker`（`repoPrisma.ts:418`）会粘住 `RUN_STOP_MARKER`——但 `preservedMarker` 的前提是 `sameRun === true`，只覆盖"停止但无人接管"这一格。**接管格**（停止 → 立刻再发一条 → `beginAgentRun` 拿到新 token）里 `sameRun=false`，`upsertRunLive` 的 update 分支是无条件整行重置。
2. **唯一的兜底不可靠**：`execute.ts:63` 是 `repo.renewAgentRun(...).catch(() => true)`——一次瞬时库错误就会让 `:434` 的栅栏放行。
3. **它把一条没有任何类型或测试强制的跨文件时序不变式**（"路由续租成功 ⇒ 亚毫秒后 loop 入口仍持有"）写进并发关键路径，换 164 ms（占总收益 6%）。任何人未来在 `route.ts:104` 与 `executePlanAgentRun` 之间插一个 `await`（多一次埋点查询、一次 KV 读、队列开重试），不变式就静默失效；而现有回归测试 `tests/planAgent/startupStatus.test.ts:74-115`（"stale token → 不发 status、`upsertRunLive` 一次都不调"）**不传新 dep、会继续走旧分支绿灯通过**，生产路径从此无人覆盖。
4. 它还与 CUT-7 开关耦合：`CUT-7 关 + CUT-4 开` 是唯一一个严格劣于今天的配置。

**砍掉零损失**，其余五刀不受影响。

### ❌ CUT-9：绕开 `getTripPlanApiDeps()`（原估 0，未测）

代码等价性没问题（本路由靠 `route.ts:40-49` 的 `x-plan-agent-secret` 常量时间比对鉴权，全文零处 `getSession`；`PrismaTripPlanRepo` 构造无状态、走 `repoPrisma.ts:3` 的模块级 prisma 单例）。**不做的理由**：`tests/api/plan-agent-internal-run.test.ts:11-13` 正是靠 `vi.mock('@/lib/tripPlan/api')` + `getTripPlanApiDeps` 注入 `MemoryTripPlanRepo`（`:75`/`:85`/`:105`/`:137` 四处）。改成模块作用域 `new PrismaTripPlanRepo()` 会让这个覆盖 503/401/stale_token/正常路径的测试文件整个失去注入点，必须重写 mock 目标。**用一次测试重写换一个未测量的收益，不划算。**

若将来要做：先照方案说的在 `getTripPlanApiDeps` 前后打时间戳、按 `consumerSeq` 分冷热读一轮，量到再改。⚠️ **绝不要把它算进任何收益预算。**

---

## 4. 必须写的测试

### 4.1 ⚠️ stage 推断等价性（核心）

**新增** `tests/planAgent/stageInputs.test.ts`：

1. **表驱动等价**：对一组 fixture（至少覆盖 `works` / `dates` / `points` / `enrich` / `deliver` / `revise` 六格，外加 `pointId = null` / `''` / 正常值 三格，以及 `days.length===0` 与 `days>0 但全 pointId=null` 两格），断言
   ```ts
   derivePlanStage({ plan: await repo.getStageInputs(id), messages, quality })
     === derivePlanStage({ plan: stageInputsOfPlan(await repo.getPlan(id)!), messages, quality })
   ```
2. **逐字段等价**：`await repo.getStageInputs(id)` 与 `stageInputsOfPlan(await repo.getPlan(id)!)` `toEqual` 相等。
3. **两个实现都跑**：`MemoryTripPlanRepo`（单测）+ `PrismaTripPlanRepo`（dev 库集成测试，或至少一次 query-log 快照贴进 PR）。⚠️ Memory 实现若与 SQL 谓词不同步，单测就在测一条生产上不存在的代码路径。
4. `tests/planAgent/stage.test.ts:78` 改一行 `plan: stageInputsOfPlan(...)`，**整张判定表不动**——这本身就是回归证据。

### 4.2 ⚠️ 发给模型的 messages 数组逐字节不变（核心）

**新增** `tests/planAgent/loop.messagesGolden.test.ts`：

1. 造一个含 36 条消息的计划（`human` / `assistant`(带 tool_calls) / `tool` / `ask` / `daymap` 混合，daymap 带完整 `days` + `quality`）。
2. `spy` 住 `deps.createMessage`，捕获**第一次**调用的 `messages` 参数。
3. **在改动前**先跑一次，把 `JSON.stringify(messages)` 落成 committed fixture（`tests/planAgent/__fixtures__/first-turn-messages.json`）。
4. 改动后断言与 fixture **逐字节相同**。
5. 附加断言：`sanitizeChatHistory` 的输入 === `repo.listMessages()` 的原始输出（`[系统状态]` 前缀只改内存中最后一条 user，不进 sanitize 输入——`loop.ts:303-331`）。

⚠️ 这条测试是本任务最硬的约束的唯一守卫，**不许省**。

### 4.3 CUT-1

`tests/api/plan-agent-internal-run.test.ts` 扩展：
- 计划不存在 → 响应体 `{ skipped: 'stale_token' }`、status 200。
- token 不符 → **同一响应体、同一 status**。
- 正常路径 → `executePlanAgentRun` 被调用，且 `billing` 由 `owner.userId` 推出。
- `MemoryTripPlanRepo` 新增 `renewAgentRunOwner`，语义与 `renewAgentRun` 逐字对齐（命中才写 `agentBusyUntil`）。

### 4.4 CUT-2

- 校验器容错：`tier` 为 `undefined` / `'team'`（未知）/ `null` / `123` / `'Pro'` 时，`isPlanAgentQueueMessage` 一律**不因它返回 false**。
- 内部路由：`tier='pro'` 且 `enqueuedAt` 新鲜 → **不调 `getAccount`**，且 `billing.entitlements` 与 `TIER_ENTITLEMENTS.pro` 逐字段相等、`runCapMicros` 与 `runCapMicros('pro')` 相等。
- 内部路由：`tier` 缺失 / 不认识 / `enqueuedAt` 超龄 / 开关为 `'0'` → **走 `getAccount` 三读**，且**不落 `TIER_ENTITLEMENTS.free`**。
- 内部路由：`getAccount` 抛错 → 回落 `free`（今天的行为，逐字保留）。
- ⚠️ 更新 `tests/api/plan-agent-queue.test.ts:116` 与 `:146` 的精确对象断言。

### 4.5 CUT-6

- 断言 `updateStage`/`updateStageIfActive` 在**首次 `createMessage` 被调用之后**才发起（用调用顺序 spy）。
- 断言写入的 `stage` 值与旧实现相同（可与 4.1 的 fixture 复用）。
- 断言持有 token 时走 `updateStageIfActive`；被接管（token 不符）时该写影响 0 行。
- 断言首次模型调用抛错时**仍然发起了**这次写（这是相对"挂在 resolve 之后"的关键差别）。

### 4.6 CUT-7

⚠️ **必须新增传 `deferStartupRunLive: true` 的对称用例**——否则 `tests/planAgent/startupStatus.test.ts:117-150` 会继续绿着（它断言首个 patch 是 `readHistory`），而生产上首条落库的已是 `organize`，测试守的东西已被绕开。

新增：
- 传 `deferStartupRunLive: true` → 启动段 `upsertRunLive` 调用次数为 **1**，首个 patch 的 `statusText === startupStatusPhrase('organize')`。
- 该次调用发生在 **`createMessage` 调用之后**、且在 `renewLease` 之后（调用顺序 spy）。
- 被接管的 stale run（`renewLease` 抛 `RunFencedError`）→ `upsertRunLive` **一次都不调**。
- 不传该 dep → 现有三条用例逐字不变、继续绿。
- `releaseStartupFlush()` 在未持有时是严格 no-op（不额外产生 `upsertRunLive`）。

### 4.7 CUT-8

`tests/planAgent/title.test.ts`：计划不存在 → 不写；`title !== DEFAULT_PLAN_TITLE` → 不写；`title === DEFAULT_PLAN_TITLE` → 写。

### 4.8 全量门

```bash
npm run typecheck          # typecheck:app + typecheck:tests
npm run test               # 含 node scripts/check-line-budget.mjs（loop.ts ≤ 750 且不得进 allowlist）
```

---

## 5. 回滚

⚠️ **"一个开关退回旧路径"是错的**，别按那个口径写 PR 描述。真实情况分三类：

| 刀 | 回滚方式 | 说明 |
|---|---|---|
| CUT-2（消费者侧） | `PLAN_AGENT_TIER_PASSTHROUGH=0` | 默认开。置 0 后字段被忽略、自动走 `getAccount` 三读 |
| CUT-2（生产者侧） | 无需回滚 | 多带一个可选字段本身无害；消费者忽略即可 |
| CUT-7 | `PLAN_AGENT_STARTUP_RUNLIVE_DEFER`（默认关，置 `1` 才开） | 唯一有用户可见变化的一刀，可单独关掉而保住其余约 2.1s |
| CUT-1 / CUT-3 / CUT-6 / CUT-8 | **`git revert` 对应 PR** | 无运行时开关。它们是等价性改动，安全网是 §4 的测试，不是开关 |

**为什么 CUT-3 / CUT-6 没有开关**：它们改的是 `lib/planAgent/loop.ts` 与 `lib/planAgent/stage.ts`，内联 SSE 路径与队列路径**共用**、无条件生效。要做成"一个开关"就得在 `loop.ts` 里读 `process.env`（破坏它现有的纯依赖注入形态，且 vitest 里该变量为空 → 单测跑的是回滚路径而不是上线路径），或者从两条 route 各自传一个新的可选 dep（两个 route 都要改）。**选择：不加开关，靠测试守。**

**共同性质**：新仓储方法（`renewAgentRunOwner` / `getStageInputs` / `getPlanTitle` / `updateStageIfActive`）与 `getPlan` / `renewAgentRun` / `updateStage` **并存不替换**，旧路径始终编译在内。队列字段 `tier` 是可选、`v` 保持 1。**没有任何数据库迁移、没有任何数据形状变化**，回滚不需要回填，不存在半新半旧的数据。

**回滚动作**：开关类是一次 `npm run cf:deploy`（或预览 `--var PLAN_AGENT_STARTUP_RUNLIVE_DEFER:0`）；真正的一动作回滚是 `wrangler versions rollback`。⚠️ 按既有踩坑，`cf:deploy` 不是秒级操作：需要注入 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>`，新 worktree 要先复制 `.env`/`.env.local` 并单独 `npm install`。

---

## 6. ⚠️ 明确不要做的事

**这些都已被论证否决，不要"顺手优化"。**

1. **不要砍 `loop.ts:434` 首轮的 `renewLease`**（省 164 ms）。它不只是续租，还是首次模型调用前唯一的栅栏（`execute.ts:62-65` 在返回 false 时抛 `RunFencedError`）。今天用户在前奏期间点停止，这一轮**不会发出任何模型请求**；砍掉之后停止只能靠 `stop.ts:114-117` 的租约看守在流式期间 abort——等于模型请求已发出再中止，多烧一次调用、可能已流出 reasoning。**直接违反"停止语义不变"。**
2. **不要把 `listMessages` + `getStageInputs` 合成 `$queryRaw` CTE**（省 164–328 ms）。`$queryRaw` 绕开 Prisma 的 JSON 反序列化路径，`content` 的 `Prisma.JsonValue` 往返一致性得逐类型自证，把"messages 逐字节等价"这条最硬的约束置于风险中。
3. **不要给 `listMessages` 做载荷投影**（砍 daymap 的 `content->'days'`，80.8 KB 里的 23.4 KB）。(a) 无收益：本机同一 planId 实测 FULL p50=0.62ms/82,690B vs 投影 p50=0.54ms/60,700B——22 KB 的边际库侧成本只有 **0.08 ms**，而一次往返是 164 ms；**载荷不是杠杆，往返次数才是**。(b) 有真风险：`parseDaymapPayload`（`lib/tripPlan/view.ts:108-112`）在 `days` 不是数组、或 `revisionId`/`savedAt` trim 后为空时**整条返回 null**，`quality` 静默变 null，stage 从 `deliver`/`revise` 翻成 `enrich`。
4. **不要把 `listMessages` 拆成两次查**（先 kind 列表再正文）。`pool=1` + 0.164s/往返下是纯亏——多 164 ms 只换约 1 KB，而且正文（模型输入）与 kind（daymap 位置 + turnIndex）都得拿全。
5. **不要只砍 `listMessages` 的 `id`/`planId`/`createdAt` 三列**。loop 路径确实一列不读，但只占约 2 KB，收益在测量噪声里，改动却要动 `TripPlanMessage` 的领域类型。
6. **不要删掉内部路由的 `getAccount` 而不做回落，也不要在字段缺失时回落 `TIER_ENTITLEMENTS.free`**（滚动窗口静默降档）。**同样不要"干脆不传 entitlements"**（`loop.ts:153` 是可选参数，不传 = `:301`/`:345`/`:357`/`:369` 全部放开，是反向越权，比降档更糟）。
7. **不要把 `getAccount` 结果按 userId 缓存进 isolate 内存或 KV**。缓存的 staleness 窗口由隔离体寿命决定、不可控；队列透传的窗口是投递延迟且值来自**授权这次 run 的那次请求本身**，语义严格更好、实现更简单。
8. **不要把前奏几次读改成 `Promise.all`**。`CLOUDFLARE_POOL_MAX = 1` 让 pg Pool 按 `pool.query()` 顺序 FIFO 发放——只是把串行换个写法，一毫秒都省不到，还会打乱副作用顺序。⚠️ **前提是 P0-A 确认走请求作用域 client；若 P0-A 证明是全局池（max=5），本条否决要重新评估。**
9. **不要不发 `emitStartup` 那三条 status**。它们是 2026-09-10 首帧优化的产物，是 TTFT 黑屏期唯一的真实进度。CUT-7 只压缩落库次数、不减少发出的事件。
10. **不要干脆不写 `updateStage`**。`TripPlan.stage` 进 GET 响应载荷（`view.ts:51`）且是 `composePlanRevision` 的输入（`repo.ts:335-353`），删掉是改数据不是改时机。
11. **不要用裸 `_count: { days: true }`**，**不要用裸 `pointId: { not: null }`**（理由见 CUT-3 论证 3、4）。
12. **不要"结构性放宽" `derivePlanStage` 的 plan 参数类型**（理由见 CUT-3 硬性约束）。
13. **不做 CUT-4、不做 CUT-9**（理由见 §3）。

---

## 7. 上线顺序与验收

⚠️ **验证空档警告**：CUT-1 / CUT-2 / CUT-7 **只在队列路径上执行**。本地 dev 无 CF 绑定 → 走内联 SSE；预览按既有约定要 `--var PLAN_AGENT_QUEUE_ENABLED:0`（预览跑不了消费者与自引用绑定）。也就是说这三刀的**首次真实执行就在生产**。因此必须分窗口：

| 窗口 | 内容 | 验收 |
|---|---|---|
| **0** | P0-A 探针 + P0-B SQL 实测 + P0-D 基线；（若行数超限）`loop.ts` 零行为变更抽取 PR | 拿到 Prisma client 分支结论与 SQL 原文 |
| **1** | **CUT-8**（性价比最高、零风险，兼作"往返数 vs 载荷"的免费探针） | `runTimings` 读一轮 |
| **2** | **CUT-1** 单独一个窗口 | 按 `consumerSeq` 分冷热读满一轮再放行 |
| **3** | **CUT-2** | 观察 `queueLatencyMs` p99；确认无 400/丢消息 |
| **4** | **CUT-3 + CUT-6**（都落在共享 `loop`/`stage` 上，能在预览与本地验，可合并） | 预览 + 本地跑通 §4 全量测试后再上 |
| **5** | **CUT-7**，独立开关默认关，观察后再置 `1` | ⚠️ 专门验"刷新恢复"场景的观察流首帧 |

**验收不需要新埋点**：`lib/planAgent/runTimings.ts` 现成的 `markLoopStarted` / `markStatus` / `markModelRequestSent` / `markModelByte` 已经能直接出前后对比，按 `consumerSeq` 分冷热两组读。

---

## 8. 诚实的预期收益区间

| 刀 | 省的 SQL 条数 | 省 ms（@0.164s/往返） |
|---|---|---|
| CUT-1 | 5（若 `updateManyAndReturn` 被拆则 4） | 820（下界 656） |
| CUT-2 | 3 | 492 |
| CUT-3 | 4 | 656 |
| CUT-6 | 1 | 164 |
| CUT-7 | 4 | 656 |
| CUT-8 | 0–4（争用性） | 0–656（**不计入总账**） |
| **合计（确定性）** | **17** | **≈ 2790 ms** |

**分段**：路由 prelude 2.4s 里砍 1312 ms（9 条串行 SQL → 1 条）；loop prelude 4.0s 里砍 1476 ms（13 条 → 4 条：`listMessages` 1 + `getStageInputs` 1 + 启动 flush 2，`renewLease` 与 `isAgentRunStopped` 保留）。

**区间**：

- **上界 ≈ 2.79 s**（P0-A 确认 `pool=1`，六刀全上，CUT-7 开）→ 6.4s 压到约 **3.6 s**
- **下界 ≈ 1.97 s**（P0-A 证明走全局池 `max=5`：CUT-6 与 CUT-7 的收益是"省排队"而非"省往返"，直接归零；CUT-1/2/3 因为砍的是**真实存在的串行往返**——`PLAN_INCLUDE` 的嵌套 include 天然依赖父级 id、`getAccount` 三读在代码里就是 `await` 链——所以在任一池大小下都成立）→ 6.4s 压到约 **4.4 s**
- 加上 CUT-8 的争用性收益，上界可到约 **3.45 s**

**⚠️ 明确的上限说明：不要预期 6.4 s 归零。** 往返模型只能解释实测 6.4 s 中的约 3.6 s（22 条关键路径 SQL），本方案吃掉其中 17 条。剩下的约 **2.8 s** 本方案**不攻击**：

- 80.8 KB + 23.2 KB 结果集的 Postgres 线协议传输（0.164s 是空查询往返，不含载荷）
- `engineType = "client"` 的 JS/WASM 查询编译器在 workerd 上反序列化 80 KB 历史
- 冷隔离体模块求值 + Hyperdrive 首连握手

**收益建立在这些未证实假设上（按影响排序）**：

1. **`pool=1` 严格串行**（P0-A）。若证伪，CUT-6/CUT-7 的 820 ms 归零，且"否决 `Promise.all`"这条结论要重新评估。**这是全案唯一的结构性未知。**
2. **0.164 s/往返与载荷无关**。它多半是在小查询上测的。若 80.8 KB 结果集经 Hyperdrive 实际要 0.30 s，按条数算的收益是**低估**的，而本方案主动否掉的载荷类优化要重新评。验证：生产上同一 planId 用 FULL 与 PROJ 两条 SQL 各打 20 次比 p50。
3. **本地 dev 库的 SQL 形态可迁移到 workerd**。生产从 `lib/db/prisma.ts:6` 加载 `@seichigo/prisma-client-runtime`（该包只是 `export * from '@prisma/client'` 的再导出，与本地走同一份生成产物，同为 Prisma 6.16 查询编译器），但**没有在 workerd 里验证过发出的语句**。
4. **CUT-2 的 tier 与消费时刻的 tier 可能不同**（订阅 webhook 落在投递窗口内）。窗口有界（加了 `TIER_PASSTHROUGH_MAX_AGE_MS` 后 ≤ 2 分钟）、只影响一次 run、与 POST 自身的能力判定/预扣用同一份快照，但**没有测量过，也没有告警**。
5. **EXISTS 子查询的索引覆盖**：`TripPlanItem` 有 `@@index([dayId])` 与 `@@index([pointId])`、**没有 `planId` 索引**，过滤型 count 要走 `TripPlanDay → TripPlanItem` 的连接。最大真实计划规模下仍很小，但**生产 planner 代价未测**。
6. **生产库不存在 `TripPlanItem.pointId = ''` 的行**（`notIn: ['']` 的存在让两种情况都安全，此条只影响"能不能退回更简单的 `{ not: null }`"）。
7. **`runInBackground` 的 `getCfBindings()?.ctx` 在内部路由的 `ReadableStream.start()` 里拿得到**。拿不到会降级成浮动 promise——本场景可接受（心跳响应流在 run 结束前一直开着），但没验过。
8. **`resolveLlmForScope` 的 30s isolate 缓存命中率未知**（`lib/planAgent/api.ts:212` 每次 attempt 开头都 `await` 它，而 `loop.ts:446` 的 `markModelRequestSent` 记的是**进入 `createMessage` 之前**，不是 HTTP 发出）。这不影响任何一刀的正确性，但会影响验收时对"剩余耗时"的归因。
9. **生产库 daymap 条数分布未知**（dev 库每个计划最多 1 条）。本方案主动否掉了裁剪 daymap，所以不影响任何一刀的收益，但它决定 `listMessages` 那 80.8 KB 未来会长到多大。建议跑一次建立基线：
   ```sql
   SELECT n, count(*) FROM (SELECT "planId", count(*) n FROM "TripPlanMessage" WHERE kind='daymap' GROUP BY 1) s GROUP BY 1;
   ```