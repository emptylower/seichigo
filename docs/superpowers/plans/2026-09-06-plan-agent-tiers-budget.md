# plan agent 权限与预算层实施计划（Part B，后端）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三档能力表在工具暴露、补齐层、天数校验三处生效；每个用户有按订阅日滚动的月度成本预算，run 前预扣、结束结算；提供 `GET /api/me/usage` 供前端显示剩余百分比。

**Architecture:** `lib/billing/` 新增能力表（tiers）、周期计算（period）、账本仓储（ledger，memory 与 prisma 两实现）与业务服务（service）。agent 路由在 `beginAgentRun` 之前预扣，把能力表与结算回调注入 loop；loop 只在三处读能力表并在收尾时回调结算。User 表加三个字段，新增 UsageLedger 表。

**Tech Stack:** TypeScript、Next.js App Router、Prisma（PostgreSQL）、vitest。

**前置：** Part A（`docs/superpowers/plans/2026-09-06-plan-agent-metering.md`）已完成，`summarizeRunCost`、`EnrichBudget.calls` 与 `lib/billing/priceTable.ts` 已存在。

**对应设计：** `docs/superpowers/specs/2026-09-06-plan-agent-billing-tiers-design.md` §5、§6、§8、§11。

**约束（对执行者）：**
- 不要 `git commit`。不要碰 `app/(authed)/plan/**`、`app/(site)/**`、`components/**`（前端由另一份任务负责）。
- **不要对任何数据库执行 prisma migrate。** 迁移 SQL 手写到 `prisma/migrations/`，只跑 `npx prisma generate`。
- 单测不连库：账本与用户仓储用 memory 实现测试；prisma 实现只保证 `npm run typecheck` 通过。
- `tests/setup.ts` 里 mock 了 `@/lib/db/prisma`，新加 prisma 表不需要往那个 mock 里加字段。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| 修改 `prisma/schema.prisma`，新建 `prisma/migrations/20260906000000_add_billing_tier_ledger/migration.sql` | User 三字段 + UsageLedger 表 |
| 新建 `lib/billing/tiers.ts` | Tier 类型、能力表、禁用工具集合、提示词附注 |
| 修改 `lib/billing/priceTable.ts` | 套餐月价、成本占比、预扣与免费预算常量、汇率 |
| 新建 `lib/billing/budget.ts` | 月预算、单次上限、剩余百分比的纯函数 |
| 新建 `lib/billing/period.ts` | 按锚点日滚动的周期计算 |
| 新建 `lib/billing/ledger.ts`、`ledgerMemory.ts`、`ledgerPrisma.ts` | 账本仓储接口与两实现 |
| 新建 `lib/billing/users.ts`、`usersMemory.ts`、`usersPrisma.ts` | 用户档位/周期仓储接口与两实现 |
| 新建 `lib/billing/service.ts` | getAccount、reserveRun、settleRun、refundStaleReserves |
| 新建 `lib/billing/serverDeps.ts` | 生产装配（prisma 实现） |
| 修改 `lib/planAgent/tools.ts` | `forbiddenTools`、`maxDays`、`tier_forbidden` 与天数校验 |
| 修改 `lib/planAgent/enrich/types.ts`、`restaurantEnricher.ts`、`mealEnricher.ts` | `EnrichContext.entitlements` 与跳过 |
| 修改 `lib/planAgent/loop.ts` | 工具过滤、提示词附注、单次上限、结算回调 |
| 修改 `app/api/me/plans/[id]/agent/route.ts` | 预检、402、预扣 |
| 修改 `lib/planAgent/execute.ts`、`app/api/internal/plan-agent/run/route.ts` | 能力表与结算回调注入（SSE 与队列两条路径） |
| 修改 `lib/planAgent/serverText.ts` | 三语 `budgetExhausted` 文案 |
| 新建 `app/api/me/usage/route.ts` | 用量查询接口 |

---

### Task B1: Prisma schema 与迁移 SQL

**Files:**
- Modify: `prisma/schema.prisma`（User 模型与文件末尾）
- Create: `prisma/migrations/20260906000000_add_billing_tier_ledger/migration.sql`

- [ ] **Step 1: 改 schema**

User 模型里 `isAdmin Boolean @default(false)` 之后加：

```prisma
  /** 订阅档位：free | standard | pro（设计 2026-09-06 §8） */
  tier                 String               @default("free")
  /** 当前计费周期起点（订阅日锚点；免费档为注册日） */
  periodStart          DateTime             @default(now())
  /** 当前计费周期终点；null 表示尚未初始化，首次访问时由 billing service 计算 */
  periodEnd            DateTime?
```

User 关系列表末尾（`tripPlans TripPlan[]` 后）加：`usageLedger UsageLedger[]`

文件末尾追加：

```prisma
/// 用量账本（设计 2026-09-06 §8）：grant / reserve / settle / refund 四种记账，
/// 余量 = 当前周期内 deltaMicros 之和；balanceAfter 只作对账快照。
model UsageLedger {
  id           String   @id @default(cuid())
  userId       String
  planId       String?
  /** 一次 run 的计费引用（route 生成的 uuid），reserve/settle/refund 用它配对 */
  runRef       String?
  kind         String
  deltaMicros  BigInt
  balanceAfter BigInt
  periodStart  DateTime
  createdAt    DateTime @default(now())
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, periodStart])
  @@index([runRef])
}
```

- [ ] **Step 2: 手写迁移 SQL**

```sql
-- prisma/migrations/20260906000000_add_billing_tier_ledger/migration.sql
-- AlterTable (2026-09-06 订阅分档：档位与计费周期)
ALTER TABLE "public"."User" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "public"."User" ADD COLUMN "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "public"."User" ADD COLUMN "periodEnd" TIMESTAMP(3);

-- CreateTable (用量账本)
CREATE TABLE "public"."UsageLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "runRef" TEXT,
    "kind" TEXT NOT NULL,
    "deltaMicros" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageLedger_userId_periodStart_idx" ON "public"."UsageLedger"("userId", "periodStart");
CREATE INDEX "UsageLedger_runRef_idx" ON "public"."UsageLedger"("runRef");

-- AddForeignKey
ALTER TABLE "public"."UsageLedger" ADD CONSTRAINT "UsageLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: 生成客户端并类型检查**

Run: `npx prisma generate && npm run typecheck`
Expected: 生成成功，无类型错误。

---

### Task B2: 能力表 `lib/billing/tiers.ts`

**Files:**
- Create: `lib/billing/tiers.ts`
- Test: `tests/billing/tiers.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/billing/tiers.test.ts
import { describe, expect, it } from 'vitest'
import { forbiddenToolsOf, parseTier, TIER_ENTITLEMENTS, tierPromptNote } from '@/lib/billing/tiers'

describe('tiers', () => {
  it('parseTier defaults to free for unknown values', () => {
    expect(parseTier('standard')).toBe('standard')
    expect(parseTier('pro')).toBe('pro')
    expect(parseTier('gold')).toBe('free')
    expect(parseTier(undefined)).toBe('free')
  })

  it('free tier has no directions and no restaurants', () => {
    const free = TIER_ENTITLEMENTS.free
    expect(free.directions).toBe(false)
    expect(free.restaurants).toBe(false)
    expect(free.directionsMax).toBe(0)
    expect(free.maxDays).toBe(3)
    expect([...forbiddenToolsOf(free)].sort()).toEqual(['estimate_travel', 'find_restaurants'])
    expect(tierPromptNote(free)).toContain('直线估算')
  })

  it('standard tier has full current features and nothing forbidden', () => {
    const std = TIER_ENTITLEMENTS.standard
    expect(std.directions).toBe(true)
    expect(std.restaurants).toBe(true)
    expect(std.maxDays).toBe(7)
    expect(forbiddenToolsOf(std).size).toBe(0)
    expect(tierPromptNote(std)).toBeNull()
  })

  it('pro is not purchasable yet', () => {
    expect(TIER_ENTITLEMENTS.pro.purchasable).toBe(false)
    expect(TIER_ENTITLEMENTS.standard.purchasable).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/billing/tiers.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// lib/billing/tiers.ts
/**
 * 三档能力表（设计 §5）。服务端唯一真值，三处卡点（工具暴露、补齐层、
 * 天数校验）都读这里，任何一处不得单独判断 tier。
 */
export type Tier = 'free' | 'standard' | 'pro'

export const TIERS: readonly Tier[] = ['free', 'standard', 'pro']

export const TIER_LABELS: Record<Tier, string> = { free: '免费', standard: '标准', pro: '高级' }

export type Entitlements = {
  tier: Tier
  /** 餐厅推荐：find_restaurants 工具 + restaurant enricher */
  restaurants: boolean
  /** 真实路线：estimate_travel 工具 + transport enricher 的 Directions 调用 */
  directions: boolean
  /** 单个行程天数上限 */
  maxDays: number
  /** 单 run Places 预算上限（EnrichBudget.places.max） */
  placesMax: number
  /** 单 run Directions 预算上限（EnrichBudget.directions.max；0 = 只走直线估算） */
  directionsMax: number
  priorityQueue: boolean
  /** 高级档模型选择（首期未实现，占位） */
  modelChoice: boolean
  /** 首期是否开放购买 */
  purchasable: boolean
}

export const TIER_ENTITLEMENTS: Record<Tier, Entitlements> = {
  free: {
    tier: 'free',
    restaurants: false,
    directions: false,
    maxDays: 3,
    placesMax: 15,
    directionsMax: 0,
    priorityQueue: false,
    modelChoice: false,
    purchasable: false,
  },
  standard: {
    tier: 'standard',
    restaurants: true,
    directions: true,
    maxDays: 7,
    placesMax: 40,
    directionsMax: 40,
    priorityQueue: false,
    modelChoice: false,
    purchasable: true,
  },
  pro: {
    tier: 'pro',
    restaurants: true,
    directions: true,
    maxDays: 14,
    placesMax: 40,
    directionsMax: 40,
    priorityQueue: true,
    modelChoice: true,
    purchasable: false,
  },
}

export function parseTier(value: unknown): Tier {
  return value === 'standard' || value === 'pro' ? value : 'free'
}

/** 该档位不注入模型、被调用时返回 tier_forbidden 的工具名 */
export function forbiddenToolsOf(e: Entitlements): Set<string> {
  const set = new Set<string>()
  if (!e.directions) set.add('estimate_travel')
  if (!e.restaurants) set.add('find_restaurants')
  return set
}

/** 拼进 system prompt 末尾的档位说明；标准档及以上无附注 */
export function tierPromptNote(e: Entitlements): string | null {
  const lines: string[] = []
  if (!e.directions) lines.push('- 本档位交通只能用 estimate_transit 做直线估算，不要尝试查询真实路线；transit 条目照常写入，服务端会标注为参考估算。')
  if (!e.restaurants) lines.push('- 本档位不提供餐厅推荐，不要尝试搜索餐厅；meal 条目仍要输出（title 写「午餐」/「晚餐」），payload.place 留空。')
  lines.push(`- 本档位单个行程最多 ${e.maxDays} 天，用户要求更多天数时说明上限并建议分成多个行程。`)
  if (e.directions && e.restaurants) return null
  return `[档位限制]\n${lines.join('\n')}`
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/billing/tiers.test.ts`
Expected: PASS。

---

### Task B3: 价格表补套餐常量；`lib/billing/budget.ts` 与 `lib/billing/period.ts`

**Files:**
- Modify: `lib/billing/priceTable.ts`
- Create: `lib/billing/budget.ts`
- Create: `lib/billing/period.ts`
- Test: `tests/billing/budget.test.ts`、`tests/billing/period.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/billing/budget.test.ts
import { describe, expect, it } from 'vitest'
import { monthlyBudgetMicros, remainingPercent, runCapMicros } from '@/lib/billing/budget'
import { CNY_PER_USD, COST_SHARE, FREE_BUDGET_MICROS, RUN_CAP_SHARE, TIER_MONTHLY_PRICE_CNY } from '@/lib/billing/priceTable'

describe('budget', () => {
  it('free budget is the fixed constant', () => {
    expect(monthlyBudgetMicros('free')).toBe(FREE_BUDGET_MICROS)
  })
  it('paid budget = price / fx × cost share, in micro-USD', () => {
    const expected = Math.round((TIER_MONTHLY_PRICE_CNY.standard / CNY_PER_USD) * COST_SHARE * 1_000_000)
    expect(monthlyBudgetMicros('standard')).toBe(expected)
  })
  it('run cap is a share of the monthly budget', () => {
    expect(runCapMicros('free')).toBe(Math.round(FREE_BUDGET_MICROS * RUN_CAP_SHARE.free))
    expect(runCapMicros('standard')).toBe(Math.round(monthlyBudgetMicros('standard') * RUN_CAP_SHARE.standard))
  })
  it('remainingPercent floors, clamps at 0 and 100', () => {
    expect(remainingPercent(999, 1000)).toBe(99)
    expect(remainingPercent(1000, 1000)).toBe(100)
    expect(remainingPercent(-5, 1000)).toBe(0)
    expect(remainingPercent(5, 0)).toBe(0)
  })
})
```

```ts
// tests/billing/period.test.ts
import { describe, expect, it } from 'vitest'
import { addMonthsClamped, computePeriod } from '@/lib/billing/period'

describe('period', () => {
  it('addMonthsClamped clamps to the last day of shorter months', () => {
    expect(addMonthsClamped(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(addMonthsClamped(new Date('2026-03-15T10:00:00Z'), 1).toISOString()).toBe('2026-04-15T10:00:00.000Z')
  })
  it('computePeriod returns the current window containing now, anchored on the subscription day', () => {
    const anchor = new Date('2026-06-10T00:00:00Z')
    const { periodStart, periodEnd } = computePeriod(anchor, new Date('2026-09-06T12:00:00Z'))
    expect(periodStart.toISOString()).toBe('2026-08-10T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-09-10T00:00:00.000Z')
  })
  it('computePeriod with now before anchor returns the first window', () => {
    const anchor = new Date('2026-09-10T00:00:00Z')
    const { periodStart, periodEnd } = computePeriod(anchor, new Date('2026-09-06T00:00:00Z'))
    expect(periodStart).toEqual(anchor)
    expect(periodEnd.toISOString()).toBe('2026-10-10T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/billing/budget.test.ts tests/billing/period.test.ts`
Expected: FAIL。

- [ ] **Step 3: 价格表追加**（`lib/billing/priceTable.ts` 末尾）

```ts
import type { Tier } from './tiers'

/** 人民币标价 → 美元成本口径的换算（调价时人工更新） */
export const CNY_PER_USD = 7.2

/**
 * 套餐月价（人民币）。**示例值**：标准档月价在计量层跑满两周、拿到 p75
 * 单次成本后按设计 §10 校准；高级档首期不可购买，这里的数值只用于计算
 * 内测账号的预算。
 */
export const TIER_MONTHLY_PRICE_CNY: Record<Tier, number> = { free: 0, standard: 29.9, pro: 99 }

/** 月度成本预算占月价的比例（设计 §3：45%，留 5 个点给手续费与摊销） */
export const COST_SHARE = 0.45

/** 免费档月预算（微美元）。示例值 = 免费路径 p75 单次成本 × 2.5，计量数据出来后校准 */
export const FREE_BUDGET_MICROS = 400_000

/** run 开始时的预扣额（微美元）：各档最近 30 天 p75 单次成本。示例值，计量数据出来后校准 */
export const RESERVE_MICROS: Record<Tier, number> = { free: 150_000, standard: 400_000, pro: 400_000 }

/** 单 run 成本上限占月预算的比例（设计 §6.2：付费 15%，免费 50%） */
export const RUN_CAP_SHARE: Record<Tier, number> = { free: 0.5, standard: 0.15, pro: 0.15 }
```

- [ ] **Step 4: 实现 budget.ts**

```ts
// lib/billing/budget.ts
import type { Tier } from './tiers'
import { CNY_PER_USD, COST_SHARE, FREE_BUDGET_MICROS, RUN_CAP_SHARE, TIER_MONTHLY_PRICE_CNY } from './priceTable'

/** 月度成本预算（微美元）：免费档固定值；付费档 = 月价 / 汇率 × 成本占比 */
export function monthlyBudgetMicros(tier: Tier): number {
  if (tier === 'free') return FREE_BUDGET_MICROS
  return Math.round((TIER_MONTHLY_PRICE_CNY[tier] / CNY_PER_USD) * COST_SHARE * 1_000_000)
}

/** 单 run 成本上限（微美元） */
export function runCapMicros(tier: Tier): number {
  return Math.round(monthlyBudgetMicros(tier) * RUN_CAP_SHARE[tier])
}

/** 用户可见的剩余百分比：向下取整，0..100 */
export function remainingPercent(balanceMicros: number, budgetMicros: number): number {
  if (budgetMicros <= 0) return 0
  return Math.max(0, Math.min(100, Math.floor((balanceMicros / budgetMicros) * 100)))
}
```

- [ ] **Step 5: 实现 period.ts**

```ts
// lib/billing/period.ts
/** 加 n 个月，日数超出目标月天数时钳到该月最后一天（1/31 + 1 月 = 2/28） */
export function addMonthsClamped(date: Date, months: number): Date {
  const d = new Date(date.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d
}

/**
 * 以 anchor（订阅日/注册日）为锚按月滚动，返回包含 now 的周期
 * [periodStart, periodEnd)。now 早于 anchor 时返回第一个周期。
 */
export function computePeriod(anchor: Date, now: Date): { periodStart: Date; periodEnd: Date } {
  let start = new Date(anchor.getTime())
  let end = addMonthsClamped(anchor, 1)
  let n = 1
  while (now.getTime() >= end.getTime()) {
    start = end
    n += 1
    end = addMonthsClamped(anchor, n)
  }
  return { periodStart: start, periodEnd: end }
}
```

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run tests/billing`
Expected: PASS。

---

### Task B4: 账本与用户仓储（接口 + memory + prisma）

**Files:**
- Create: `lib/billing/ledger.ts`、`lib/billing/ledgerMemory.ts`、`lib/billing/ledgerPrisma.ts`
- Create: `lib/billing/users.ts`、`lib/billing/usersMemory.ts`、`lib/billing/usersPrisma.ts`
- Test: `tests/billing/ledgerMemory.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/billing/ledgerMemory.test.ts
import { describe, expect, it } from 'vitest'
import { MemoryUsageLedger } from '@/lib/billing/ledgerMemory'

const period = new Date('2026-09-01T00:00:00Z')

describe('MemoryUsageLedger', () => {
  it('balance sums deltas within the period and balanceAfter tracks it', async () => {
    const ledger = new MemoryUsageLedger()
    const grant = await ledger.append({ userId: 'u1', planId: null, runRef: null, kind: 'grant', deltaMicros: 1000, periodStart: period })
    expect(grant.balanceAfter).toBe(1000)
    const reserve = await ledger.append({ userId: 'u1', planId: 'p1', runRef: 'r1', kind: 'reserve', deltaMicros: -300, periodStart: period })
    expect(reserve.balanceAfter).toBe(700)
    expect(await ledger.balance('u1', period)).toBe(700)
    expect(await ledger.balance('u1', new Date('2026-10-01T00:00:00Z'))).toBe(0)
    expect(await ledger.balance('u2', period)).toBe(0)
  })

  it('findOpenReserve returns the reserve only while no settle/refund shares its runRef', async () => {
    const ledger = new MemoryUsageLedger()
    await ledger.append({ userId: 'u1', planId: 'p1', runRef: 'r1', kind: 'reserve', deltaMicros: -300, periodStart: period })
    expect((await ledger.findOpenReserve('r1'))?.deltaMicros).toBe(-300)
    await ledger.append({ userId: 'u1', planId: 'p1', runRef: 'r1', kind: 'settle', deltaMicros: 100, periodStart: period })
    expect(await ledger.findOpenReserve('r1')).toBeNull()
  })

  it('listOpenReserves returns unsettled reserves older than the cutoff', async () => {
    const ledger = new MemoryUsageLedger(() => new Date('2026-09-06T00:00:00Z'))
    await ledger.append({ userId: 'u1', planId: 'p1', runRef: 'old', kind: 'reserve', deltaMicros: -300, periodStart: period })
    ;(ledger as unknown as { now: () => Date }).now = () => new Date('2026-09-06T01:00:00Z')
    await ledger.append({ userId: 'u1', planId: 'p2', runRef: 'new', kind: 'reserve', deltaMicros: -300, periodStart: period })
    const stale = await ledger.listOpenReserves('u1', new Date('2026-09-06T00:30:00Z'))
    expect(stale.map((e) => e.runRef)).toEqual(['old'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/billing/ledgerMemory.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现接口**

```ts
// lib/billing/ledger.ts
export type LedgerKind = 'grant' | 'reserve' | 'settle' | 'refund'

export type LedgerEntry = {
  id: string
  userId: string
  planId: string | null
  runRef: string | null
  kind: LedgerKind
  /** 微美元；grant/refund/settle 为正或负调整，reserve 为负 */
  deltaMicros: number
  balanceAfter: number
  periodStart: Date
  createdAt: Date
}

export type LedgerAppendInput = Omit<LedgerEntry, 'id' | 'createdAt' | 'balanceAfter'>

/**
 * 用量账本仓储（设计 §8）。余量 = 同一 userId + periodStart 下 deltaMicros 之和。
 * withUserLock 串行化同一用户的"读余量 → 写账目"；prisma 实现用事务级 advisory lock。
 */
export interface UsageLedgerRepo {
  balance(userId: string, periodStart: Date): Promise<number>
  append(input: LedgerAppendInput): Promise<LedgerEntry>
  /** 尚无 settle/refund 配对的 reserve */
  findOpenReserve(runRef: string): Promise<LedgerEntry | null>
  /** 该用户所有早于 olderThan 且仍未配对的 reserve */
  listOpenReserves(userId: string, olderThan: Date): Promise<LedgerEntry[]>
  withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T>
}
```

```ts
// lib/billing/users.ts
import type { Tier } from './tiers'

export type BillingUser = {
  id: string
  tier: Tier
  periodStart: Date
  periodEnd: Date | null
  isAdmin: boolean
}

export interface BillingUserRepo {
  get(userId: string): Promise<BillingUser | null>
  setPeriod(userId: string, periodStart: Date, periodEnd: Date): Promise<void>
}
```

- [ ] **Step 4: 实现 memory 版**

```ts
// lib/billing/ledgerMemory.ts
import type { LedgerAppendInput, LedgerEntry, UsageLedgerRepo } from './ledger'

export class MemoryUsageLedger implements UsageLedgerRepo {
  private entries: LedgerEntry[] = []
  private seq = 0
  constructor(public now: () => Date = () => new Date()) {}

  async balance(userId: string, periodStart: Date): Promise<number> {
    return this.entries
      .filter((e) => e.userId === userId && e.periodStart.getTime() === periodStart.getTime())
      .reduce((sum, e) => sum + e.deltaMicros, 0)
  }

  async append(input: LedgerAppendInput): Promise<LedgerEntry> {
    const balanceAfter = (await this.balance(input.userId, input.periodStart)) + input.deltaMicros
    const entry: LedgerEntry = { ...input, id: `ledger_${++this.seq}`, balanceAfter, createdAt: this.now() }
    this.entries.push(entry)
    return entry
  }

  async findOpenReserve(runRef: string): Promise<LedgerEntry | null> {
    const related = this.entries.filter((e) => e.runRef === runRef)
    const reserve = related.find((e) => e.kind === 'reserve')
    if (!reserve) return null
    return related.some((e) => e.kind === 'settle' || e.kind === 'refund') ? null : reserve
  }

  async listOpenReserves(userId: string, olderThan: Date): Promise<LedgerEntry[]> {
    const out: LedgerEntry[] = []
    for (const e of this.entries) {
      if (e.userId !== userId || e.kind !== 'reserve' || !e.runRef) continue
      if (e.createdAt.getTime() >= olderThan.getTime()) continue
      if (await this.findOpenReserve(e.runRef)) out.push(e)
    }
    return out
  }

  async withUserLock<T>(_userId: string, fn: () => Promise<T>): Promise<T> {
    return fn()
  }
}
```

```ts
// lib/billing/usersMemory.ts
import type { BillingUser, BillingUserRepo } from './users'

export class MemoryBillingUsers implements BillingUserRepo {
  private users = new Map<string, BillingUser>()
  seed(user: BillingUser): void {
    this.users.set(user.id, { ...user })
  }
  async get(userId: string): Promise<BillingUser | null> {
    const u = this.users.get(userId)
    return u ? { ...u } : null
  }
  async setPeriod(userId: string, periodStart: Date, periodEnd: Date): Promise<void> {
    const u = this.users.get(userId)
    if (u) this.users.set(userId, { ...u, periodStart, periodEnd })
  }
}
```

- [ ] **Step 5: 实现 prisma 版**

```ts
// lib/billing/ledgerPrisma.ts
import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'
import type { LedgerAppendInput, LedgerEntry, LedgerKind, UsageLedgerRepo } from './ledger'

type Row = {
  id: string
  userId: string
  planId: string | null
  runRef: string | null
  kind: string
  deltaMicros: bigint
  balanceAfter: bigint
  periodStart: Date
  createdAt: Date
}

function toEntry(row: Row): LedgerEntry {
  return {
    id: row.id,
    userId: row.userId,
    planId: row.planId,
    runRef: row.runRef,
    kind: row.kind as LedgerKind,
    deltaMicros: Number(row.deltaMicros),
    balanceAfter: Number(row.balanceAfter),
    periodStart: row.periodStart,
    createdAt: row.createdAt,
  }
}

type Db = Prisma.TransactionClient | typeof prisma

/**
 * Prisma 实现。withUserLock 开事务并取 pg_advisory_xact_lock(hashtext(userId))，
 * 与 repoPrisma.beginAgentRun 的锁键一致，fn 内的 balance/append 走同一事务。
 */
export class PrismaUsageLedger implements UsageLedgerRepo {
  private db: Db = prisma

  async balance(userId: string, periodStart: Date): Promise<number> {
    const agg = await this.db.usageLedger.aggregate({ where: { userId, periodStart }, _sum: { deltaMicros: true } })
    return Number(agg._sum.deltaMicros ?? 0n)
  }

  async append(input: LedgerAppendInput): Promise<LedgerEntry> {
    const balanceAfter = (await this.balance(input.userId, input.periodStart)) + input.deltaMicros
    const row = await this.db.usageLedger.create({
      data: {
        userId: input.userId,
        planId: input.planId,
        runRef: input.runRef,
        kind: input.kind,
        deltaMicros: BigInt(Math.round(input.deltaMicros)),
        balanceAfter: BigInt(Math.round(balanceAfter)),
        periodStart: input.periodStart,
      },
    })
    return toEntry(row)
  }

  async findOpenReserve(runRef: string): Promise<LedgerEntry | null> {
    const rows = await this.db.usageLedger.findMany({ where: { runRef } })
    const reserve = rows.find((r) => r.kind === 'reserve')
    if (!reserve) return null
    return rows.some((r) => r.kind === 'settle' || r.kind === 'refund') ? null : toEntry(reserve)
  }

  async listOpenReserves(userId: string, olderThan: Date): Promise<LedgerEntry[]> {
    const reserves = await this.db.usageLedger.findMany({
      where: { userId, kind: 'reserve', createdAt: { lt: olderThan }, runRef: { not: null } },
    })
    if (!reserves.length) return []
    const closed = await this.db.usageLedger.findMany({
      where: { runRef: { in: reserves.map((r) => r.runRef as string) }, kind: { in: ['settle', 'refund'] } },
      select: { runRef: true },
    })
    const closedRefs = new Set(closed.map((c) => c.runRef))
    return reserves.filter((r) => !closedRefs.has(r.runRef)).map(toEntry)
  }

  async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))::text`
        const scoped = new PrismaUsageLedger()
        scoped.db = tx
        return fn.call(scoped)
      },
      { maxWait: 10_000, timeout: 15_000 },
    )
  }
}
```

注意 `withUserLock` 里 `fn.call(scoped)`：service 调用时用 `ledger.withUserLock(userId, async function (this: UsageLedgerRepo) { ... })`，函数体内通过 `this` 使用事务内实例（见 Task B5 service 代码）。

```ts
// lib/billing/usersPrisma.ts
import { prisma } from '@/lib/db/prisma'
import { parseTier } from './tiers'
import type { BillingUser, BillingUserRepo } from './users'

export class PrismaBillingUsers implements BillingUserRepo {
  async get(userId: string): Promise<BillingUser | null> {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tier: true, periodStart: true, periodEnd: true, isAdmin: true },
    })
    if (!row) return null
    return { id: row.id, tier: parseTier(row.tier), periodStart: row.periodStart, periodEnd: row.periodEnd, isAdmin: row.isAdmin }
  }
  async setPeriod(userId: string, periodStart: Date, periodEnd: Date): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { periodStart, periodEnd } })
  }
}
```

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run tests/billing/ledgerMemory.test.ts && npm run typecheck`
Expected: PASS，无类型错误。

---

### Task B5: 业务服务 `lib/billing/service.ts`

**Files:**
- Create: `lib/billing/service.ts`
- Create: `lib/billing/serverDeps.ts`
- Test: `tests/billing/service.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/billing/service.test.ts
import { describe, expect, it } from 'vitest'
import { createBillingService } from '@/lib/billing/service'
import { MemoryUsageLedger } from '@/lib/billing/ledgerMemory'
import { MemoryBillingUsers } from '@/lib/billing/usersMemory'
import { monthlyBudgetMicros } from '@/lib/billing/budget'
import { RESERVE_MICROS } from '@/lib/billing/priceTable'

function setup(now = new Date('2026-09-06T00:00:00Z')) {
  const ledger = new MemoryUsageLedger(() => now)
  const users = new MemoryBillingUsers()
  users.seed({ id: 'u1', tier: 'standard', periodStart: new Date('2026-08-20T00:00:00Z'), periodEnd: null, isAdmin: false })
  users.seed({ id: 'admin', tier: 'free', periodStart: new Date('2026-08-20T00:00:00Z'), periodEnd: null, isAdmin: true })
  const billing = createBillingService({ ledger, users, now: () => now })
  return { ledger, users, billing }
}

describe('billing service', () => {
  it('getAccount initializes the period and grants the full budget once', async () => {
    const { billing, users } = setup()
    const a = await billing.getAccount('u1')
    expect(a?.tier).toBe('standard')
    expect(a?.periodStart.toISOString()).toBe('2026-08-20T00:00:00.000Z')
    expect(a?.periodEnd.toISOString()).toBe('2026-09-20T00:00:00.000Z')
    expect(a?.budgetMicros).toBe(monthlyBudgetMicros('standard'))
    expect(a?.balanceMicros).toBe(monthlyBudgetMicros('standard'))
    expect(a?.remainingPercent).toBe(100)
    expect((await users.get('u1'))?.periodEnd?.toISOString()).toBe('2026-09-20T00:00:00.000Z')
    const again = await billing.getAccount('u1')
    expect(again?.balanceMicros).toBe(monthlyBudgetMicros('standard'))
  })

  it('rolls the period forward and grants a fresh budget when periodEnd has passed', async () => {
    const { billing } = setup(new Date('2026-09-25T00:00:00Z'))
    const a = await billing.getAccount('u1')
    expect(a?.periodStart.toISOString()).toBe('2026-09-20T00:00:00.000Z')
    expect(a?.periodEnd.toISOString()).toBe('2026-10-20T00:00:00.000Z')
    expect(a?.balanceMicros).toBe(monthlyBudgetMicros('standard'))
  })

  it('reserveRun deducts the reserve and settleRun adjusts to the actual cost', async () => {
    const { billing } = setup()
    const account = (await billing.getAccount('u1'))!
    const r = await billing.reserveRun({ account, planId: 'p1', runRef: 'run1' })
    expect(r.ok).toBe(true)
    expect((await billing.getAccount('u1'))!.balanceMicros).toBe(account.budgetMicros - RESERVE_MICROS.standard)
    await billing.settleRun({ runRef: 'run1', actualMicros: 250_000, hadModelOutput: true })
    expect((await billing.getAccount('u1'))!.balanceMicros).toBe(account.budgetMicros - 250_000)
  })

  it('settleRun refunds fully when the run produced no model output', async () => {
    const { billing } = setup()
    const account = (await billing.getAccount('u1'))!
    await billing.reserveRun({ account, planId: 'p1', runRef: 'run1' })
    await billing.settleRun({ runRef: 'run1', actualMicros: 0, hadModelOutput: false })
    expect((await billing.getAccount('u1'))!.balanceMicros).toBe(account.budgetMicros)
  })

  it('reserveRun refuses when the balance cannot cover the reserve and reports resetsAt', async () => {
    const { billing } = setup()
    const account = (await billing.getAccount('u1'))!
    const runs = Math.ceil(account.budgetMicros / RESERVE_MICROS.standard)
    for (let i = 0; i < runs; i++) {
      await billing.reserveRun({ account: (await billing.getAccount('u1'))!, planId: 'p1', runRef: `r${i}` })
    }
    const denied = await billing.reserveRun({ account: (await billing.getAccount('u1'))!, planId: 'p1', runRef: 'late' })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.resetsAt.toISOString()).toBe('2026-09-20T00:00:00.000Z')
  })

  it('canStartRun is a read-only precheck and force reserve skips the balance check', async () => {
    const { billing } = setup()
    const account = (await billing.getAccount('u1'))!
    expect(billing.canStartRun(account)).toBe(true)
    expect(billing.canStartRun({ ...account, balanceMicros: RESERVE_MICROS.standard - 1 })).toBe(false)
    const forced = await billing.reserveRun({ account: { ...account, balanceMicros: 0 }, planId: 'p1', runRef: 'f1', force: true })
    expect(forced.ok).toBe(true)
  })

  it('admins are never charged', async () => {
    const { billing, ledger } = setup()
    const account = (await billing.getAccount('admin'))!
    expect(account.isAdmin).toBe(true)
    const r = await billing.reserveRun({ account, planId: 'p1', runRef: 'a1' })
    expect(r.ok).toBe(true)
    await billing.settleRun({ runRef: 'a1', actualMicros: 999_999, hadModelOutput: true })
    expect(await ledger.findOpenReserve('a1')).toBeNull()
    expect((await billing.getAccount('admin'))!.balanceMicros).toBe(account.budgetMicros)
  })

  it('refundStaleReserves refunds unsettled reserves older than the cutoff', async () => {
    const { billing, ledger } = setup()
    const account = (await billing.getAccount('u1'))!
    await billing.reserveRun({ account, planId: 'p1', runRef: 'stale' })
    ledger.now = () => new Date('2026-09-06T01:00:00Z')
    await billing.refundStaleReserves('u1', new Date('2026-09-06T00:30:00Z'))
    expect(await ledger.findOpenReserve('stale')).toBeNull()
    expect((await billing.getAccount('u1'))!.balanceMicros).toBe(account.budgetMicros)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/billing/service.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// lib/billing/service.ts
import { monthlyBudgetMicros, remainingPercent, runCapMicros } from './budget'
import type { UsageLedgerRepo } from './ledger'
import { computePeriod } from './period'
import { RESERVE_MICROS } from './priceTable'
import { TIER_ENTITLEMENTS, type Entitlements, type Tier } from './tiers'
import type { BillingUserRepo } from './users'

export type BillingAccount = {
  userId: string
  tier: Tier
  entitlements: Entitlements
  isAdmin: boolean
  periodStart: Date
  periodEnd: Date
  budgetMicros: number
  balanceMicros: number
  remainingPercent: number
  runCapMicros: number
}

export type ReserveResult = { ok: true } | { ok: false; resetsAt: Date }

export type BillingService = {
  /** 读取账户并保证周期有效：periodEnd 为空或已过 → 滚动周期并写入整月 grant */
  getAccount(userId: string): Promise<BillingAccount | null>
  /**
   * 预扣。force=true 跳过余量检查（路由已在 beginAgentRun 之前做过预检，
   * 抢到 busy 位后无条件预扣，允许余量短暂为负，避免回滚已落库的人类消息）
   */
  reserveRun(input: { account: BillingAccount; planId: string; runRef: string; force?: boolean }): Promise<ReserveResult>
  /** 只读预检：余量是否够一次预扣；管理员恒 true */
  canStartRun(account: BillingAccount): boolean
  /** 按真实成本结算；hadModelOutput=false 时全额退回 */
  settleRun(input: { runRef: string; actualMicros: number; hadModelOutput: boolean }): Promise<void>
  /** 进程崩溃等留下的孤儿 reserve：早于 olderThan 且未配对的一律退回 */
  refundStaleReserves(userId: string, olderThan: Date): Promise<void>
}

export function createBillingService(deps: {
  ledger: UsageLedgerRepo
  users: BillingUserRepo
  now?: () => Date
}): BillingService {
  const now = deps.now ?? (() => new Date())

  async function getAccount(userId: string): Promise<BillingAccount | null> {
    const user = await deps.users.get(userId)
    if (!user) return null
    const budgetMicros = monthlyBudgetMicros(user.tier)
    const current = now()
    let { periodStart, periodEnd } = user
    if (!periodEnd || current.getTime() >= periodEnd.getTime()) {
      const next = computePeriod(user.periodStart, current)
      periodStart = next.periodStart
      periodEnd = next.periodEnd
      await deps.users.setPeriod(userId, periodStart, periodEnd)
    }
    const startForBalance = periodStart
    const balanceMicros = await deps.ledger.withUserLock(userId, async function (this: UsageLedgerRepo | void) {
      const ledger = (this as UsageLedgerRepo | undefined) ?? deps.ledger
      const existing = await ledger.balance(userId, startForBalance)
      // 周期内还没有任何账目 → 写入整月 grant（幂等：有账目就不再写）
      const hasEntries = existing !== 0 || (await ledger.listOpenReserves(userId, new Date(8640000000000000))).length > 0
      if (hasEntries) return existing
      const grant = await ledger.append({ userId, planId: null, runRef: null, kind: 'grant', deltaMicros: budgetMicros, periodStart: startForBalance })
      return grant.balanceAfter
    })
    return {
      userId,
      tier: user.tier,
      entitlements: TIER_ENTITLEMENTS[user.tier],
      isAdmin: user.isAdmin,
      periodStart,
      periodEnd: periodEnd as Date,
      budgetMicros,
      balanceMicros,
      remainingPercent: remainingPercent(balanceMicros, budgetMicros),
      runCapMicros: runCapMicros(user.tier),
    }
  }

  function canStartRun(account: BillingAccount): boolean {
    return account.isAdmin || account.balanceMicros >= RESERVE_MICROS[account.tier]
  }

  async function reserveRun(input: { account: BillingAccount; planId: string; runRef: string; force?: boolean }): Promise<ReserveResult> {
    const { account } = input
    if (account.isAdmin) return { ok: true }
    const amount = RESERVE_MICROS[account.tier]
    return deps.ledger.withUserLock(account.userId, async function (this: UsageLedgerRepo | void) {
      const ledger = (this as UsageLedgerRepo | undefined) ?? deps.ledger
      const balance = await ledger.balance(account.userId, account.periodStart)
      if (!input.force && balance < amount) return { ok: false as const, resetsAt: account.periodEnd }
      await ledger.append({
        userId: account.userId,
        planId: input.planId,
        runRef: input.runRef,
        kind: 'reserve',
        deltaMicros: -amount,
        periodStart: account.periodStart,
      })
      return { ok: true as const }
    })
  }

  async function settleRun(input: { runRef: string; actualMicros: number; hadModelOutput: boolean }): Promise<void> {
    const reserve = await deps.ledger.findOpenReserve(input.runRef)
    if (!reserve) return // 管理员或已结算/已退回
    const reserved = -reserve.deltaMicros
    const base = { userId: reserve.userId, planId: reserve.planId, runRef: reserve.runRef, periodStart: reserve.periodStart }
    if (!input.hadModelOutput) {
      await deps.ledger.append({ ...base, kind: 'refund', deltaMicros: reserved })
      return
    }
    // settle 的增量 = 预扣 − 实际：实际少于预扣补回差额，多于预扣继续扣（允许余量短暂为负）
    await deps.ledger.append({ ...base, kind: 'settle', deltaMicros: reserved - Math.max(0, Math.round(input.actualMicros)) })
  }

  async function refundStaleReserves(userId: string, olderThan: Date): Promise<void> {
    const stale = await deps.ledger.listOpenReserves(userId, olderThan)
    for (const reserve of stale) {
      await deps.ledger.append({
        userId: reserve.userId,
        planId: reserve.planId,
        runRef: reserve.runRef,
        kind: 'refund',
        deltaMicros: -reserve.deltaMicros,
        periodStart: reserve.periodStart,
      })
    }
  }

  return { getAccount, canStartRun, reserveRun, settleRun, refundStaleReserves }
}
```

说明：`getAccount` 判断"周期内是否已有账目"用 `existing !== 0 || 有未结算 reserve` 兜底，覆盖"余量恰好为 0 但已经有账目"的边界（此时至少有一条 reserve 或 settle；若全部已 settle 到恰好 0，再写一次 grant 会多给一个月预算——为堵住这个洞，memory 与 prisma 的 `balance` 之外，再给 `UsageLedgerRepo` 加一个方法 `hasEntries(userId, periodStart): Promise<boolean>`，并把上面 `hasEntries` 的计算改成直接调用它）。**执行时请按下面修正实现，而不是用 `listOpenReserves` 兜底：**

- `lib/billing/ledger.ts` 接口加：`hasEntries(userId: string, periodStart: Date): Promise<boolean>`
- memory 实现：`return this.entries.some((e) => e.userId === userId && e.periodStart.getTime() === periodStart.getTime())`
- prisma 实现：`return (await this.db.usageLedger.count({ where: { userId, periodStart } })) > 0`
- service：`const hasEntries = await ledger.hasEntries(userId, startForBalance)`

```ts
// lib/billing/serverDeps.ts
import { PrismaUsageLedger } from './ledgerPrisma'
import { createBillingService, type BillingService } from './service'
import { PrismaBillingUsers } from './usersPrisma'

let cached: BillingService | null = null

export function getBillingService(): BillingService {
  if (!cached) cached = createBillingService({ ledger: new PrismaUsageLedger(), users: new PrismaBillingUsers() })
  return cached
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/billing && npm run typecheck`
Expected: PASS。

---

### Task B6: tools.ts —— 禁用工具、天数上限、`EnrichContext.entitlements`

**Files:**
- Modify: `lib/planAgent/tools.ts`（`PlanAgentToolDeps`、`executePlanTool` 开头、`cluster_points`、`update_plan_meta`、构造 EnrichContext 处）
- Modify: `lib/planAgent/enrich/types.ts`（`EnrichContext`）
- Modify: `lib/planAgent/enrich/restaurantEnricher.ts`、`lib/planAgent/enrich/mealEnricher.ts`
- Test: `tests/planAgent/tierTools.test.ts`、`tests/planAgent/enrich/tierSkip.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/planAgent/tierTools.test.ts
import { describe, expect, it } from 'vitest'
import { executePlanTool } from '@/lib/planAgent/tools'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { PointFinder } from '@/lib/planAgent/points'

const finder: PointFinder = {
  async searchBangumi() {
    return []
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return []
  },
  async getPointsByIds() {
    return [{ id: 'p1', lat: 35, lng: 139 }, { id: 'p2', lat: 35.1, lng: 139.1 }]
  },
}

describe('tier gates in executePlanTool', () => {
  it('returns tier_forbidden for forbidden tools without calling anything', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const out = JSON.parse(
      await executePlanTool(
        { planId: plan.id, repo, points: finder, forbiddenTools: new Set(['find_restaurants']) },
        'find_restaurants',
        { lat: 35, lng: 139 },
      ),
    )
    expect(out.code).toBe('tier_forbidden')
  })

  it('caps dayCount in update_plan_meta and cluster_points by maxDays', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const deps = { planId: plan.id, repo, points: finder, maxDays: 3 }
    const meta = JSON.parse(await executePlanTool(deps, 'update_plan_meta', { dayCount: 5 }))
    expect(meta.code).toBe('tier_max_days')
    expect((await repo.getPlan(plan.id))?.dayCount).toBe(1)
    const cluster = JSON.parse(await executePlanTool(deps, 'cluster_points', { pointIds: ['p1', 'p2'], dayCount: 4 }))
    expect(cluster.code).toBe('tier_max_days')
    const ok = JSON.parse(await executePlanTool(deps, 'update_plan_meta', { dayCount: 3 }))
    expect(ok.code).toBeUndefined()
  })
})
```

```ts
// tests/planAgent/enrich/tierSkip.test.ts
import { describe, expect, it, vi } from 'vitest'
import { runEnrichers } from '@/lib/planAgent/enrich'
import { TIER_ENTITLEMENTS } from '@/lib/billing/tiers'
import type { EnrichDay } from '@/lib/planAgent/enrich/types'

describe('restaurant enricher under free tier', () => {
  it('skips meal items with a tier reason and never calls findRestaurants', async () => {
    const findRestaurants = vi.fn()
    const days: EnrichDay[] = [
      {
        dayIndex: 1,
        citySlug: null,
        summary: null,
        items: [
          { type: 'point', pointId: 'p1', title: 'A', sortOrder: 0 } as never,
          { type: 'meal', title: '午餐', sortOrder: 1 } as never,
        ],
      },
    ]
    const { report } = await runEnrichers(days, {
      deps: { findRestaurants },
      coordsByPointId: new Map([['p1', { lat: 35, lng: 139 }]]),
      entitlements: TIER_ENTITLEMENTS.free,
    })
    expect(findRestaurants).not.toHaveBeenCalled()
    expect(report.skipped.some((s) => s.enricher === 'restaurant' && s.reason.includes('档位'))).toBe(true)
  })
})
```

（`EnrichItem` 的字段以 `lib/planAgent/schedule.ts` 的 `ScheduleItemInput` 为准，上面用 `as never` 只为了让最小字面量通过类型检查；若现有 `tests/planAgent/enrich/restaurantEnricher.test.ts` 有构造 meal 条目的助手，直接复用它。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/planAgent/tierTools.test.ts tests/planAgent/enrich/tierSkip.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`lib/planAgent/enrich/types.ts`：
- import：`import type { Entitlements } from '@/lib/billing/tiers'`
- `EnrichContext` 加字段：`/** 档位能力表（设计 §5 卡点 2）；缺省视为全开 */ entitlements?: Entitlements`

`lib/planAgent/enrich/restaurantEnricher.ts` 的 `runRestaurantEnricher` 函数体开头加：

```ts
  if (ctx.entitlements && !ctx.entitlements.restaurants) {
    for (const day of days) {
      for (const item of day.items) {
        if (item.type === 'meal') report.skipped.push({ enricher: 'restaurant', itemTitle: item.title, reason: '当前档位不含餐厅推荐' })
      }
    }
    return
  }
```

`lib/planAgent/enrich/mealEnricher.ts`：找到它给 `budget.places.reserved` 预留餐厅次数的地方，在预留前加判断 `if (ctx.entitlements && !ctx.entitlements.restaurants) { /* 不预留 */ } else { 原预留逻辑 }`。meal 条目本身照常插入。

`lib/planAgent/tools.ts`：
- import：`import type { Entitlements } from '@/lib/billing/tiers'`
- `PlanAgentToolDeps` 加：

```ts
  /** 档位禁用的工具名（设计 §5 卡点 1）；被调用时返回 tier_forbidden */
  forbiddenTools?: Set<string>
  /** 档位天数上限；缺省 30（与 update_plan_meta 现有钳制一致） */
  maxDays?: number
  /** 透传给补齐层（EnrichContext.entitlements） */
  entitlements?: Entitlements
```

- `executePlanTool` 里 `try {` 之后、`switch` 之前加：

```ts
    if (deps.forbiddenTools?.has(name)) {
      return JSON.stringify({
        error: '当前档位不支持该功能：交通请用 estimate_transit 直线估算，餐厅不要推荐，直接保存进度并向用户说明',
        code: 'tier_forbidden',
      })
    }
    const maxDays = deps.maxDays ?? 30
```

- `cluster_points` 里 `if (!pointIds.length || !Number.isFinite(dayCount))` 判断之后加：

```ts
        if (dayCount > maxDays) {
          return JSON.stringify({ error: `当前档位单个行程最多 ${maxDays} 天，请缩减天数或建议用户升级后再规划`, code: 'tier_max_days' })
        }
```

- `update_plan_meta` 里 `if (Number.isFinite(Number(args.dayCount)))` 那行改为：

```ts
        if (Number.isFinite(Number(args.dayCount))) {
          const requested = Math.max(1, Math.floor(Number(args.dayCount)))
          if (requested > maxDays) {
            return JSON.stringify({ error: `当前档位单个行程最多 ${maxDays} 天，请缩减天数或建议用户升级后再规划`, code: 'tier_max_days' })
          }
          patch.dayCount = Math.min(30, requested)
        }
```

- 构造 `EnrichContext` 处（搜索 `enrichAndNormalizeDays(` 的调用，ctx 对象里有 `budget:`/`travelMode:`）加：`entitlements: deps.entitlements,`

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/planAgent`
Expected: PASS。

---

### Task B7: loop —— 工具过滤、提示词附注、单次上限、结算回调

**Files:**
- Modify: `lib/planAgent/loop.ts`
- Test: `tests/planAgent/loop.tier.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/planAgent/loop.tier.test.ts
import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import { runPlanAgent, type PlanAgentChatMessage } from '@/lib/planAgent/loop'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { TIER_ENTITLEMENTS } from '@/lib/billing/tiers'
import { attachLlmUsage } from '@/lib/llm/usage'
import { createEnrichBudget } from '@/lib/planAgent/enrich/types'
import type { PointFinder } from '@/lib/planAgent/points'

const finder: PointFinder = {
  async searchBangumi() {
    return []
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return []
  },
  async getPointsByIds() {
    return []
  },
}

describe('loop tier integration', () => {
  it('filters forbidden tools out of the model tool list and appends the tier note to the system prompt', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async (params: { messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]; tools: OpenAI.Chat.Completions.ChatCompletionTool[] }): Promise<PlanAgentChatMessage> => {
      const names = params.tools.map((t) => t.function.name)
      expect(names).not.toContain('estimate_travel')
      expect(names).not.toContain('find_restaurants')
      expect(names).toContain('estimate_transit')
      expect(String(params.messages[0].content)).toContain('[档位限制]')
      return { role: 'assistant', content: '好', refusal: null }
    })
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, entitlements: TIER_ENTITLEMENTS.free, maxIterations: 3 },
      '你好',
      () => {},
    )
    expect(createMessage).toHaveBeenCalledTimes(1)
  })

  it('applies tier budget maxima to the enrich budget it is given', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async (): Promise<PlanAgentChatMessage> => ({ role: 'assistant', content: '好', refusal: null }))
    const budget = createEnrichBudget()
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder, enrichBudget: budget }, entitlements: TIER_ENTITLEMENTS.free, maxIterations: 2 },
      '你好',
      () => {},
    )
    expect({ places: budget.places.max, directions: budget.directions.max }).toEqual({ places: 15, directions: 0 })
  })

  it('calls onRunCost once with the run summary and whether the model produced output', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async (): Promise<PlanAgentChatMessage> =>
      attachLlmUsage({ role: 'assistant', content: '好', refusal: null }, { inputMiss: 10, inputCacheHit: 0, output: 5, reasoning: 0 }),
    )
    const onRunCost = vi.fn(async () => {})
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, onRunCost, maxIterations: 2 },
      '你好',
      () => {},
    )
    expect(onRunCost).toHaveBeenCalledTimes(1)
    const [summary, hadModelOutput] = onRunCost.mock.calls[0]
    expect(hadModelOutput).toBe(true)
    expect(summary.costMicros.total).toBeGreaterThan(0)
  })

  it('stops issuing new model calls two iterations after the run cap is reached', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    // 每次调用都返回一个 read_plan 工具调用，使循环持续；usage 巨大使第一轮就超上限
    const createMessage = vi.fn(async (): Promise<PlanAgentChatMessage> =>
      attachLlmUsage(
        {
          role: 'assistant',
          content: null,
          refusal: null,
          tool_calls: [{ id: `c${Math.random()}`, type: 'function', function: { name: 'read_plan', arguments: '{}' } }],
        },
        { inputMiss: 50_000_000, inputCacheHit: 0, output: 0, reasoning: 0 },
      ),
    )
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, runCapMicros: 1, maxIterations: 12 },
      '你好',
      () => {},
    )
    // 第 1 次调用触发上限 → 最多再允许 2 次
    expect(createMessage.mock.calls.length).toBeLessThanOrEqual(3)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/planAgent/loop.tier.test.ts`
Expected: FAIL（`entitlements`/`onRunCost`/`runCapMicros` 不在 `PlanAgentDeps` 上）。

- [ ] **Step 3: 实现**

`lib/planAgent/loop.ts`：

1. import：

```ts
import { forbiddenToolsOf, tierPromptNote, type Entitlements } from '@/lib/billing/tiers'
import type { RunCostSummary } from '@/lib/billing/cost'
```

2. `PlanAgentDeps` 加：

```ts
  /** 档位能力表（设计 §5）：过滤工具、附注提示词、初始化补齐预算上限；缺省全开 */
  entitlements?: Entitlements
  /** 单 run 成本上限（微美元，设计 §6.2）；达到后最多再允许两次模型调用用于保存收尾 */
  runCapMicros?: number
  /** run 结束（含报错/停止/接管）回调一次：成本汇总与是否产生过模型输出（route 用它结算） */
  onRunCost?: (summary: RunCostSummary, hadModelOutput: boolean) => Promise<void>
```

3. system prompt（`content: PLAN_AGENT_SYSTEM_PROMPT,`）改为：

```ts
      content: [PLAN_AGENT_SYSTEM_PROMPT, deps.entitlements ? tierPromptNote(deps.entitlements) : null].filter(Boolean).join('\n\n'),
```

4. Part A 提出来的 `const enrichBudget = ...` 之后加：

```ts
  if (deps.entitlements) {
    enrichBudget.places.max = deps.entitlements.placesMax
    enrichBudget.directions.max = deps.entitlements.directionsMax
  }
  const forbiddenTools = deps.entitlements ? forbiddenToolsOf(deps.entitlements) : new Set<string>()
  const modelTools = PLAN_AGENT_TOOLS.filter((t) => !forbiddenTools.has(t.function.name))
```

toolDeps 对象里加：

```ts
    forbiddenTools,
    maxDays: deps.entitlements?.maxDays,
    entitlements: deps.entitlements,
```

5. 模型调用处 `tools: PLAN_AGENT_TOOLS` 改为 `tools: modelTools`。

6. 在 `outer: for (let iteration = 0; iteration < maxIterations; iteration++)` 之前加：

```ts
    // 单次上限（设计 §6.2）：达到后关掉 Google 预算、只留两轮让模型保存收尾
    let iterationLimit = maxIterations
    let capReached = false
```

并把 for 条件改为 `iteration < iterationLimit`。

7. Part A 加的 usage 累加代码块之后加：

```ts
      if (deps.runCapMicros !== undefined && !capReached) {
        const running = summarizeRunCost({ usageByModel, calls: enrichBudget.calls ?? { ...EMPTY_GOOGLE_CALLS }, modelCalls, usageMissing, withTitle: false })
        if (running.costMicros.total >= deps.runCapMicros) {
          capReached = true
          iterationLimit = Math.min(maxIterations, iteration + 3)
          enrichBudget.places.max = enrichBudget.places.used
          enrichBudget.directions.max = enrichBudget.directions.used
          messages.push({ role: 'user', content: '[系统状态]\n本回合可用预算已用完：不要再发起任何外部查询，立即用 save_plan_days 保存当前进度并向用户简短说明，然后结束本轮。' })
        }
      }
```

（`iteration + 3` 是因为当前这次已计入：还允许"读到系统状态后保存"与"收尾说明"两次。）

8. finally 块里、`appendRunLog` 之前（无论 fenced 与否）加：

```ts
    if (deps.onRunCost) {
      try {
        await deps.onRunCost(
          summarizeRunCost({
            usageByModel,
            calls: enrichBudget.calls ?? { ...EMPTY_GOOGLE_CALLS },
            modelCalls,
            usageMissing: usageMissing || modelCalls === 0,
            withTitle: Boolean(userMessage),
          }),
          modelCalls > 0,
        )
      } catch (err) {
        console.warn('[planAgent] onRunCost failed', err)
      }
    }
```

（把这份 summary 存成局部变量 `runCost`，下面 appendRunLog 的 `modelUsage` 直接复用它，避免算两遍。）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/planAgent`
Expected: PASS。

---

### Task B8: 路由预检与预扣、执行体注入、`GET /api/me/usage`

**当前结构（以此为准，不是计划初稿里的旧结构）：** `app/api/me/plans/[id]/agent/route.ts` 只做鉴权、`beginAgentRun`、队列投递或 SSE；真正的 run 在 `lib/planAgent/execute.ts` 的 `executePlanAgentRun`，SSE 路径与队列消费者的内部路由 `app/api/internal/plan-agent/run/route.ts` 都调它。计费引用 `runRef` 直接使用 `runToken`（两条路径都有它）。

**Files:**
- Modify: `app/api/me/plans/[id]/agent/route.ts`
- Modify: `lib/planAgent/execute.ts`
- Modify: `app/api/internal/plan-agent/run/route.ts`
- Modify: `lib/planAgent/serverText.ts`（三语新增 `errors.budgetExhausted`）
- Create: `app/api/me/usage/route.ts`
- Create: `lib/billing/usageView.ts`
- Test: `tests/billing/usageView.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/billing/usageView.test.ts
import { describe, expect, it } from 'vitest'
import { toUsageView } from '@/lib/billing/usageView'
import { TIER_ENTITLEMENTS } from '@/lib/billing/tiers'

describe('toUsageView', () => {
  it('exposes only tier, percent, reset date and hints', () => {
    const view = toUsageView({
      userId: 'u1',
      tier: 'free',
      entitlements: TIER_ENTITLEMENTS.free,
      isAdmin: false,
      periodStart: new Date('2026-08-20T00:00:00Z'),
      periodEnd: new Date('2026-09-20T00:00:00Z'),
      budgetMicros: 400_000,
      balanceMicros: 123_456,
      remainingPercent: 30,
      runCapMicros: 200_000,
    })
    expect(view).toEqual({
      tier: 'free',
      tierLabel: '免费',
      remainingPercent: 30,
      resetsAt: '2026-09-20T00:00:00.000Z',
      upgradeAvailable: true,
      hints: { transitEstimateOnly: true, restaurantsLocked: true, maxDays: 3 },
    })
  })
  it('admins always show 100% and no upgrade', () => {
    const view = toUsageView({
      userId: 'a',
      tier: 'free',
      entitlements: TIER_ENTITLEMENTS.free,
      isAdmin: true,
      periodStart: new Date(),
      periodEnd: new Date(),
      budgetMicros: 1,
      balanceMicros: 0,
      remainingPercent: 0,
      runCapMicros: 1,
    })
    expect(view.remainingPercent).toBe(100)
    expect(view.upgradeAvailable).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/billing/usageView.test.ts`
Expected: FAIL。

- [ ] **Step 3: 视图与用量接口**

```ts
// lib/billing/usageView.ts
import type { BillingAccount } from './service'
import { TIER_LABELS, type Tier } from './tiers'

/** 前端唯一可见的用量信息（设计 §4）：不含任何成本、token、调用次数 */
export type UsageView = {
  tier: Tier
  tierLabel: string
  remainingPercent: number
  resetsAt: string
  upgradeAvailable: boolean
  hints: { transitEstimateOnly: boolean; restaurantsLocked: boolean; maxDays: number }
}

export function toUsageView(account: BillingAccount): UsageView {
  return {
    tier: account.tier,
    tierLabel: TIER_LABELS[account.tier],
    remainingPercent: account.isAdmin ? 100 : account.remainingPercent,
    resetsAt: account.periodEnd.toISOString(),
    upgradeAvailable: !account.isAdmin && account.tier === 'free',
    hints: {
      transitEstimateOnly: !account.entitlements.directions,
      restaurantsLocked: !account.entitlements.restaurants,
      maxDays: account.entitlements.maxDays,
    },
  }
}
```

```ts
// app/api/me/usage/route.ts
import { NextResponse } from 'next/server'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { getBillingService } from '@/lib/billing/serverDeps'
import { toUsageView } from '@/lib/billing/usageView'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const deps = await getTripPlanApiDeps()
  const session = await deps.getSession()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  try {
    const account = await getBillingService().getAccount(userId)
    if (!account) return NextResponse.json({ error: 'user not found' }, { status: 404 })
    return NextResponse.json(toUsageView(account), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/me/usage] GET failed', err)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
```

（`getSession` 的取法与 agent 路由一致；tierLabel 首期只有中文，前端 i18n 后续再补。）

- [ ] **Step 4: serverText 新增错误文案**

`lib/planAgent/serverText.ts` 的 `errors` 类型加 `budgetExhausted: string`，三语字典各加一条（`{date}` 由路由替换成 “9 月 20 日” / “Sep 20” / “9月20日”）：

- zh：`'本月 AI 规划用量已用完，{date}恢复'`
- en：`'You have used up this month\'s AI planning allowance. It resets on {date}.'`
- ja：`'今月の AI プランニング利用量を使い切りました。{date}に回復します。'`

在 serverText.ts 末尾加一个纯函数：

```ts
export function formatResetDate(locale: SupportedLocale, d: Date): string {
  if (locale === 'en') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (locale === 'ja') return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`
}
```

- [ ] **Step 5: 执行体注入（两条路径共用）**

`lib/planAgent/execute.ts`：

1. import：`import { getBillingService } from '@/lib/billing/serverDeps'`、`import type { Entitlements } from '@/lib/billing/tiers'`
2. `ExecutePlanAgentRunInput` 加：

```ts
  /** 计费（设计 §5/§6）：档位能力表与单次上限；缺省（内部测试）不限档位、不设上限 */
  billing?: { entitlements: Entitlements; runCapMicros: number }
```

3. `runPlanAgent` 的 deps 里加：

```ts
          ...(input.billing ? { entitlements: input.billing.entitlements, runCapMicros: input.billing.runCapMicros } : {}),
          // 结算（设计 §6.2）：runRef 即 runToken；管理员/无预扣时 settleRun 是 no-op
          onRunCost: (summary, hadModelOutput) =>
            getBillingService().settleRun({ runRef: runToken, actualMicros: summary.costMicros.total, hadModelOutput }),
```

`app/api/internal/plan-agent/run/route.ts`：在 `renewed` 检查通过之后、构造 stream 之前加：

```ts
  // 计费：按计划归属用户的档位装配能力表（队列消息不带 userId）
  const billingAccount = await getBillingService().getAccount(plan.userId).catch(() => null)
  const billing = billingAccount ? { entitlements: billingAccount.entitlements, runCapMicros: billingAccount.runCapMicros } : undefined
```

并在 `executePlanAgentRun({...})` 参数里加 `billing,`。import `getBillingService`。

- [ ] **Step 6: agent 路由预检与预扣**

`app/api/me/plans/[id]/agent/route.ts`：

1. import：`import { getBillingService } from '@/lib/billing/serverDeps'`、`import { formatResetDate } from '@/lib/planAgent/serverText'`（与现有 serverText import 合并）。
2. 在 `const begin = await deps.repo.beginAgentRun({` **之前**加：

```ts
  // 预算层（设计 §6.2）：只读预检 → 抢 busy 位 → 无条件预扣（force）。
  // 预检拦住的请求不落库人类消息；预检通过后并发挤过的极少数请求允许余量短暂为负。
  const billing = getBillingService()
  const account = await billing.getAccount(userId)
  if (!account) return NextResponse.json({ error: errors.planNotFound }, { status: 404 })
  if (!account.isAdmin) {
    await billing.refundStaleReserves(userId, new Date(Date.now() - AGENT_BUSY_TTL_MS * 2)).catch(() => undefined)
  }
  if (!billing.canStartRun(account)) {
    return NextResponse.json(
      {
        error: errors.budgetExhausted.replace('{date}', formatResetDate(locale, account.periodEnd)),
        code: 'budget_exhausted',
        resetsAt: account.periodEnd.toISOString(),
        upgradeAvailable: account.tier === 'free',
      },
      { status: 402 },
    )
  }
```

（注意：`refundStaleReserves` 在 `getAccount` 之后调用会让刚算出的 `account.balanceMicros` 偏低；把顺序改成先退孤儿、再 `getAccount`：即先 `const billing = ...`，再 `await billing.refundStaleReserves(...)`（它内部不依赖 account，只需 userId），再 `const account = await billing.getAccount(userId)`。管理员也可以安全调用，因为管理员没有 reserve。）

3. `const runToken = begin.token` 之后加：

```ts
  // 抢到 busy 位后无条件预扣（runRef = runToken，执行体结算时配对）
  await billing.reserveRun({ account, planId: id, runRef: runToken, force: true }).catch((err) => {
    console.warn('[planAgent/billing] reserve failed (run continues, will be settled without reserve)', err)
  })
  const billingInput = { entitlements: account.entitlements, runCapMicros: account.runCapMicros }
```

4. SSE 路径的 `executePlanAgentRun({ ... })` 参数加 `billing: billingInput,`。队列路径不用改（消费者端按 plan.userId 取档位）。

- [ ] **Step 7: 运行确认通过**

Run: `npx vitest run tests/billing tests/planAgent tests/tripPlan && npm run typecheck`
Expected: PASS，无新增类型错误。若现有路由测试（`tests/planAgent/routeStop.test.ts`、`tests/plan/*` 等）因引入 `@/lib/billing/serverDeps` 需要 mock：`vi.mock('@/lib/billing/serverDeps', ...)` 返回基于 `createBillingService` + `MemoryUsageLedger` + `MemoryBillingUsers`（种一个 `isAdmin: true` 的账户）的实例。

---

## 自查清单（执行者完成后）

- 免费档 run：模型工具列表里没有 estimate_travel / find_restaurants；system prompt 末尾有 `[档位限制]`；EnrichBudget.directions.max = 0，交通行 `source:'heuristic'`；enrichReport 里 restaurant 的 skipped reason 含"档位"。
- 标准档 run：行为与改动前完全一致。
- 一次成功 run：UsageLedger 有 reserve + settle 两条，余量 = 预算 − 实际成本。
- 一次 402：没有 human 消息落库，没有 busy 位被占，账本无新记录。
- 队列路径（PLAN_AGENT_QUEUE_ENABLED=1）：消费者执行的 run 同样按 plan.userId 的档位过滤工具并结算。
- 管理员：账本无记录，run log 仍有完整 modelUsage。
- 未改动 `app/(authed)/plan/**`、`app/(site)/**`、`components/**`。
