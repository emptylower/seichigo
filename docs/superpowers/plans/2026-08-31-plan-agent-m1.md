# 计划 Agent M1 + 信息架构改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一句"帮我安排下月中旬京都京吹巡礼"能产出可保存、地图可视的多日计划（spec M1 验收线），同时完成导航语义改造（计划 | 地图 | 热门攻略 | 热门城市 | 我的）。

**Architecture:** 严格沿用本仓库领域模式——`lib/tripPlan/`（repo 接口 + Prisma/内存双实现 + deps 注入的 handlers）+ `app/api/me/plans` 薄路由；agent 是手写 Anthropic tool-use 循环（`createMessage` 注入以便单测），产出全部通过 `save_plan_days` 工具落到结构化 TripPlan 对象；前端 `/plan` 左对话右计划，地图复用 `RoutePreviewMap`。地理聚类是本地确定性算法，LLM 只做选择与解释。

**Tech Stack:** Next.js 15 App Router、Prisma 6 (PostgreSQL)、`@anthropic-ai/sdk`（模型 `claude-opus-5`，可用 `PLAN_AGENT_MODEL` 覆盖）、MapLibre（现有 `RoutePreviewMap`）、vitest（node 项目跑 `.test.ts`，jsdom 跑 `.test.tsx`）。

**Spec:** `docs/superpowers/specs/2026-08-31-plan-agent-ia-redesign-design.md`。本计划只覆盖 M1；M2（结构化对话组件/实体超链接/导出）、M3（天气/精选景点/美食/状态机提示）另立计划。

**对 spec 的一处简化（需用户知悉）:** spec 写的是 PlanConversation + PlanMessage 两张会话表；M1 每个计划只有一条会话，故只建 `TripPlanMessage`（挂 planId，存 Anthropic MessageParam 原文，可恢复续聊）。多会话需求出现时再加 conversation 维度。

**通用约定（每个任务都适用）:**
- 测试命令：`npx vitest run <file>`；类型检查：`npm run typecheck:app`（改了 tests 再跑 `npm run typecheck:tests`）。
- 提交信息末尾加：
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
- 所有新文件用仓库现行风格：无分号习惯跟随邻近文件、`@/` 路径别名、中文错误文案与现有 API 一致。

---

### Task 1: 安装 Anthropic SDK

**Files:**
- Modify: `package.json`（由 npm 修改）

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/mac/Desktop/seichigo && npm install @anthropic-ai/sdk
```

- [ ] **Step 2: 验证安装**

```bash
node -e "console.log(require('@anthropic-ai/sdk/package.json').version)"
```
Expected: 输出版本号（0.x 或 1.x 均可）。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(plan-agent): add @anthropic-ai/sdk dependency"
```

---

### Task 2: Prisma 数据模型 TripPlan / TripPlanDay / TripPlanItem / TripPlanMessage

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 在 schema.prisma 末尾追加四个模型**

```prisma
model TripPlan {
  id          String            @id @default(cuid())
  userId      String
  title       String
  status      String            @default("draft")
  startDate   DateTime?
  dayCount    Int               @default(1)
  bangumiIds  Int[]             @default([])
  preferences Json?
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt
  user        User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  days        TripPlanDay[]
  messages    TripPlanMessage[]

  @@index([userId])
  @@index([status])
}

model TripPlanDay {
  id       String         @id @default(cuid())
  planId   String
  dayIndex Int
  date     DateTime?
  citySlug String?
  summary  String?
  plan     TripPlan       @relation(fields: [planId], references: [id], onDelete: Cascade)
  items    TripPlanItem[]

  @@unique([planId, dayIndex])
}

model TripPlanItem {
  id        String        @id @default(cuid())
  dayId     String
  sortOrder Int
  type      String
  pointId   String?
  timeHint  String?
  title     String
  note      String?
  reason    String?
  payload   Json?
  day       TripPlanDay   @relation(fields: [dayId], references: [id], onDelete: Cascade)
  point     AnitabiPoint? @relation(fields: [pointId], references: [id], onDelete: SetNull)

  @@index([dayId])
  @@index([pointId])
}

model TripPlanMessage {
  id        String   @id @default(cuid())
  planId    String
  role      String
  content   Json
  createdAt DateTime @default(now())
  plan      TripPlan @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@index([planId, createdAt])
}
```

- [ ] **Step 2: 给关联模型补反向关系字段**

在 `model User {` 体内（其它 relation 字段旁）加一行：

```prisma
  tripPlans            TripPlan[]
```

在 `model AnitabiPoint {` 体内加一行：

```prisma
  tripPlanItems  TripPlanItem[]
```

- [ ] **Step 3: 生成迁移并应用**

```bash
npm run db:migrate:dev -- --name add_trip_plan
```
Expected: 新目录 `prisma/migrations/*_add_trip_plan/`，迁移应用成功。若报缺少 `DATABASE_URL`/`DATABASE_URL_UNPOOLED`，停下来向用户要环境变量，不要用 `--create-only` 绕过。

- [ ] **Step 4: 生成 client 并类型检查**

```bash
npm run db:generate && npm run typecheck:app
```
Expected: 均通过。

- [ ] **Step 5: Commit**

```bash
git add prisma
git commit -m "feat(plan-agent): add TripPlan data model"
```

---

### Task 3: TripPlan 仓库接口 + 内存实现（TDD）

**Files:**
- Create: `lib/tripPlan/repo.ts`
- Create: `lib/tripPlan/repoMemory.ts`
- Test: `tests/tripPlan/repoMemory.test.ts`

- [ ] **Step 1: 写类型与接口 `lib/tripPlan/repo.ts`**

```typescript
import type { Prisma } from '@prisma/client'

export type TripPlanStatus = 'draft' | 'upcoming' | 'ongoing' | 'done'
export type TripPlanItemType = 'point' | 'transit' | 'meal' | 'lodging' | 'attraction' | 'free'

export const TRIP_PLAN_STATUSES: TripPlanStatus[] = ['draft', 'upcoming', 'ongoing', 'done']
export const TRIP_PLAN_ITEM_TYPES: TripPlanItemType[] = ['point', 'transit', 'meal', 'lodging', 'attraction', 'free']

export type TripPlanPointLite = {
  id: string
  name: string
  nameZh: string | null
  lat: number | null
  lng: number | null
  image: string | null
}

export type TripPlanItem = {
  id: string
  dayId: string
  sortOrder: number
  type: TripPlanItemType
  pointId: string | null
  timeHint: string | null
  title: string
  note: string | null
  reason: string | null
  payload: Prisma.JsonValue | null
  point: TripPlanPointLite | null
}

export type TripPlanDay = {
  id: string
  planId: string
  dayIndex: number
  date: Date | null
  citySlug: string | null
  summary: string | null
  items: TripPlanItem[]
}

export type TripPlan = {
  id: string
  userId: string
  title: string
  status: TripPlanStatus
  startDate: Date | null
  dayCount: number
  bangumiIds: number[]
  preferences: Prisma.JsonValue | null
  createdAt: Date
  updatedAt: Date
}

export type TripPlanWithDays = TripPlan & { days: TripPlanDay[] }

export type TripPlanItemInput = {
  type: TripPlanItemType
  pointId?: string | null
  timeHint?: string | null
  title: string
  note?: string | null
  reason?: string | null
  payload?: Prisma.JsonValue | null
}

export type TripPlanDayInput = {
  dayIndex: number
  date?: Date | null
  citySlug?: string | null
  summary?: string | null
  items: TripPlanItemInput[]
}

export type TripPlanMetaUpdate = {
  title?: string
  status?: TripPlanStatus
  startDate?: Date | null
  dayCount?: number
  bangumiIds?: number[]
  preferences?: Prisma.JsonValue | null
}

export type TripPlanMessageRole = 'user' | 'assistant'

export type TripPlanMessage = {
  id: string
  planId: string
  role: TripPlanMessageRole
  content: Prisma.JsonValue
  createdAt: Date
}

export interface TripPlanRepo {
  createPlan(input: { userId: string; title: string }): Promise<TripPlan>
  listPlans(userId: string): Promise<TripPlan[]>
  getPlan(id: string): Promise<TripPlanWithDays | null>
  updateMeta(id: string, patch: TripPlanMetaUpdate): Promise<TripPlan>
  replaceDays(id: string, days: TripPlanDayInput[]): Promise<TripPlanWithDays>
  countPlansCreatedSince(userId: string, since: Date): Promise<number>
  appendMessage(planId: string, role: TripPlanMessageRole, content: Prisma.JsonValue): Promise<TripPlanMessage>
  listMessages(planId: string): Promise<TripPlanMessage[]>
  countUserMessagesSince(userId: string, since: Date): Promise<number>
}
```

- [ ] **Step 2: 写失败测试 `tests/tripPlan/repoMemory.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'

describe('MemoryTripPlanRepo', () => {
  it('creates and lists plans scoped to user', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: '京都京吹巡礼' })
    await repo.createPlan({ userId: 'u2', title: '别人的计划' })

    expect(plan.status).toBe('draft')
    expect(plan.dayCount).toBe(1)
    const list = await repo.listPlans('u1')
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('京都京吹巡礼')
  })

  it('replaceDays swaps the whole day structure and resolves seeded points', async () => {
    const repo = new MemoryTripPlanRepo({
      points: new Map([
        ['p1', { id: 'p1', name: 'Uji Bridge', nameZh: '宇治桥', lat: 34.889, lng: 135.807, image: null }],
      ]),
    })
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const updated = await repo.replaceDays(plan.id, [
      {
        dayIndex: 1,
        summary: '宇治日',
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥', reason: '京吹核心取景地' },
          { type: 'transit', title: 'JR 奈良线', note: '约 20 分钟' },
        ],
      },
    ])

    expect(updated.days).toHaveLength(1)
    expect(updated.days[0].items).toHaveLength(2)
    expect(updated.days[0].items[0].sortOrder).toBe(0)
    expect(updated.days[0].items[0].point?.nameZh).toBe('宇治桥')
    expect(updated.days[0].items[1].point).toBeNull()

    const replaced = await repo.replaceDays(plan.id, [
      { dayIndex: 1, items: [{ type: 'free', title: '自由活动' }] },
    ])
    expect(replaced.days[0].items).toHaveLength(1)
  })

  it('updateMeta patches fields and bumps updatedAt', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const updated = await repo.updateMeta(plan.id, { title: '新标题', dayCount: 4, status: 'upcoming', bangumiIds: [115908] })
    expect(updated.title).toBe('新标题')
    expect(updated.dayCount).toBe(4)
    expect(updated.status).toBe('upcoming')
    expect(updated.bangumiIds).toEqual([115908])
  })

  it('counts plans and messages since a date for quota checks', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    await repo.appendMessage(plan.id, 'user', { role: 'user', content: 'hi' })
    await repo.appendMessage(plan.id, 'assistant', { role: 'assistant', content: [] })

    const since = new Date(Date.now() - 60_000)
    expect(await repo.countPlansCreatedSince('u1', since)).toBe(1)
    expect(await repo.countUserMessagesSince('u1', since)).toBe(1)
    expect(await repo.countUserMessagesSince('u2', since)).toBe(0)
    expect(await repo.listMessages(plan.id)).toHaveLength(2)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run tests/tripPlan/repoMemory.test.ts
```
Expected: FAIL（`MemoryTripPlanRepo` 不存在）。

- [ ] **Step 4: 实现 `lib/tripPlan/repoMemory.ts`**

```typescript
import type { Prisma } from '@prisma/client'
import type {
  TripPlan,
  TripPlanDayInput,
  TripPlanMessage,
  TripPlanMessageRole,
  TripPlanMetaUpdate,
  TripPlanPointLite,
  TripPlanRepo,
  TripPlanWithDays,
} from './repo'

type MemoryOptions = {
  points?: Map<string, TripPlanPointLite>
}

export class MemoryTripPlanRepo implements TripPlanRepo {
  private plans = new Map<string, TripPlanWithDays>()
  private messages: TripPlanMessage[] = []
  private points: Map<string, TripPlanPointLite>
  private seq = 0

  constructor(options: MemoryOptions = {}) {
    this.points = options.points ?? new Map()
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${this.seq}`
  }

  async createPlan(input: { userId: string; title: string }): Promise<TripPlan> {
    const now = new Date()
    const plan: TripPlanWithDays = {
      id: this.nextId('plan'),
      userId: input.userId,
      title: input.title,
      status: 'draft',
      startDate: null,
      dayCount: 1,
      bangumiIds: [],
      preferences: null,
      createdAt: now,
      updatedAt: now,
      days: [],
    }
    this.plans.set(plan.id, plan)
    const { days: _days, ...meta } = plan
    return { ...meta }
  }

  async listPlans(userId: string): Promise<TripPlan[]> {
    return [...this.plans.values()]
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(({ days: _days, ...meta }) => ({ ...meta }))
  }

  async getPlan(id: string): Promise<TripPlanWithDays | null> {
    const plan = this.plans.get(id)
    return plan ? structuredClone(plan) : null
  }

  async updateMeta(id: string, patch: TripPlanMetaUpdate): Promise<TripPlan> {
    const plan = this.plans.get(id)
    if (!plan) throw new Error(`plan not found: ${id}`)
    Object.assign(plan, patch, { updatedAt: new Date() })
    const { days: _days, ...meta } = plan
    return { ...meta }
  }

  async replaceDays(id: string, days: TripPlanDayInput[]): Promise<TripPlanWithDays> {
    const plan = this.plans.get(id)
    if (!plan) throw new Error(`plan not found: ${id}`)
    plan.days = days.map((day) => {
      const dayId = this.nextId('day')
      return {
        id: dayId,
        planId: id,
        dayIndex: day.dayIndex,
        date: day.date ?? null,
        citySlug: day.citySlug ?? null,
        summary: day.summary ?? null,
        items: day.items.map((item, sortOrder) => ({
          id: this.nextId('item'),
          dayId,
          sortOrder,
          type: item.type,
          pointId: item.pointId ?? null,
          timeHint: item.timeHint ?? null,
          title: item.title,
          note: item.note ?? null,
          reason: item.reason ?? null,
          payload: item.payload ?? null,
          point: item.pointId ? this.points.get(item.pointId) ?? null : null,
        })),
      }
    })
    plan.updatedAt = new Date()
    return structuredClone(plan)
  }

  async countPlansCreatedSince(userId: string, since: Date): Promise<number> {
    return [...this.plans.values()].filter((p) => p.userId === userId && p.createdAt >= since).length
  }

  async appendMessage(planId: string, role: TripPlanMessageRole, content: Prisma.JsonValue): Promise<TripPlanMessage> {
    const message: TripPlanMessage = {
      id: this.nextId('msg'),
      planId,
      role,
      content,
      createdAt: new Date(),
    }
    this.messages.push(message)
    return message
  }

  async listMessages(planId: string): Promise<TripPlanMessage[]> {
    return this.messages.filter((m) => m.planId === planId)
  }

  async countUserMessagesSince(userId: string, since: Date): Promise<number> {
    const planIds = new Set([...this.plans.values()].filter((p) => p.userId === userId).map((p) => p.id))
    return this.messages.filter((m) => planIds.has(m.planId) && m.role === 'user' && m.createdAt >= since).length
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run tests/tripPlan/repoMemory.test.ts && npm run typecheck:app && npm run typecheck:tests
```
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add lib/tripPlan tests/tripPlan
git commit -m "feat(plan-agent): TripPlan repo interface and memory implementation"
```

---

### Task 4: TripPlan Prisma 实现

**Files:**
- Create: `lib/tripPlan/repoPrisma.ts`

- [ ] **Step 1: 实现 `lib/tripPlan/repoPrisma.ts`**

（照 `lib/routeBook/repoPrisma.ts` 的风格；正确性由 Task 3 接口测试 + Task 16 手工验证覆盖，不为 Prisma 层写 mock 测试——仓库现行惯例如此。）

```typescript
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type {
  TripPlan,
  TripPlanDayInput,
  TripPlanItemType,
  TripPlanMessage,
  TripPlanMessageRole,
  TripPlanMetaUpdate,
  TripPlanRepo,
  TripPlanStatus,
  TripPlanWithDays,
} from './repo'

const POINT_SELECT = {
  select: { id: true, name: true, nameZh: true, geoLat: true, geoLng: true, image: true },
} as const

const PLAN_INCLUDE = {
  days: {
    orderBy: { dayIndex: 'asc' as const },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' as const },
        include: { point: POINT_SELECT },
      },
    },
  },
} as const

type PrismaPlanWithDays = Prisma.TripPlanGetPayload<{ include: typeof PLAN_INCLUDE }>

function toPlan(row: Prisma.TripPlanGetPayload<Record<string, never>>): TripPlan {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    status: row.status as TripPlanStatus,
    startDate: row.startDate,
    dayCount: row.dayCount,
    bangumiIds: row.bangumiIds,
    preferences: row.preferences,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toPlanWithDays(row: PrismaPlanWithDays): TripPlanWithDays {
  return {
    ...toPlan(row),
    days: row.days.map((day) => ({
      id: day.id,
      planId: day.planId,
      dayIndex: day.dayIndex,
      date: day.date,
      citySlug: day.citySlug,
      summary: day.summary,
      items: day.items.map((item) => ({
        id: item.id,
        dayId: item.dayId,
        sortOrder: item.sortOrder,
        type: item.type as TripPlanItemType,
        pointId: item.pointId,
        timeHint: item.timeHint,
        title: item.title,
        note: item.note,
        reason: item.reason,
        payload: item.payload,
        point: item.point
          ? {
              id: item.point.id,
              name: item.point.name,
              nameZh: item.point.nameZh,
              lat: item.point.geoLat,
              lng: item.point.geoLng,
              image: item.point.image,
            }
          : null,
      })),
    })),
  }
}

export class PrismaTripPlanRepo implements TripPlanRepo {
  async createPlan(input: { userId: string; title: string }): Promise<TripPlan> {
    const row = await prisma.tripPlan.create({ data: { userId: input.userId, title: input.title } })
    return toPlan(row)
  }

  async listPlans(userId: string): Promise<TripPlan[]> {
    const rows = await prisma.tripPlan.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } })
    return rows.map(toPlan)
  }

  async getPlan(id: string): Promise<TripPlanWithDays | null> {
    const row = await prisma.tripPlan.findUnique({ where: { id }, include: PLAN_INCLUDE })
    return row ? toPlanWithDays(row) : null
  }

  async updateMeta(id: string, patch: TripPlanMetaUpdate): Promise<TripPlan> {
    const row = await prisma.tripPlan.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
        ...(patch.dayCount !== undefined ? { dayCount: patch.dayCount } : {}),
        ...(patch.bangumiIds !== undefined ? { bangumiIds: patch.bangumiIds } : {}),
        ...(patch.preferences !== undefined ? { preferences: patch.preferences ?? Prisma.JsonNull } : {}),
      },
    })
    return toPlan(row)
  }

  async replaceDays(id: string, days: TripPlanDayInput[]): Promise<TripPlanWithDays> {
    await prisma.$transaction([
      prisma.tripPlanDay.deleteMany({ where: { planId: id } }),
      ...days.map((day) =>
        prisma.tripPlanDay.create({
          data: {
            planId: id,
            dayIndex: day.dayIndex,
            date: day.date ?? null,
            citySlug: day.citySlug ?? null,
            summary: day.summary ?? null,
            items: {
              create: day.items.map((item, sortOrder) => ({
                sortOrder,
                type: item.type,
                pointId: item.pointId ?? null,
                timeHint: item.timeHint ?? null,
                title: item.title,
                note: item.note ?? null,
                reason: item.reason ?? null,
                payload: item.payload ?? undefined,
              })),
            },
          },
        }),
      ),
      prisma.tripPlan.update({ where: { id }, data: { updatedAt: new Date() } }),
    ])
    const plan = await this.getPlan(id)
    if (!plan) throw new Error(`plan not found after replaceDays: ${id}`)
    return plan
  }

  async countPlansCreatedSince(userId: string, since: Date): Promise<number> {
    return prisma.tripPlan.count({ where: { userId, createdAt: { gte: since } } })
  }

  async appendMessage(planId: string, role: TripPlanMessageRole, content: Prisma.JsonValue): Promise<TripPlanMessage> {
    const row = await prisma.tripPlanMessage.create({
      data: { planId, role, content: content as Prisma.InputJsonValue },
    })
    return { id: row.id, planId: row.planId, role: row.role as TripPlanMessageRole, content: row.content, createdAt: row.createdAt }
  }

  async listMessages(planId: string): Promise<TripPlanMessage[]> {
    const rows = await prisma.tripPlanMessage.findMany({ where: { planId }, orderBy: { createdAt: 'asc' } })
    return rows.map((row) => ({
      id: row.id,
      planId: row.planId,
      role: row.role as TripPlanMessageRole,
      content: row.content,
      createdAt: row.createdAt,
    }))
  }

  async countUserMessagesSince(userId: string, since: Date): Promise<number> {
    return prisma.tripPlanMessage.count({
      where: { role: 'user', createdAt: { gte: since }, plan: { userId } },
    })
  }
}
```

- [ ] **Step 2: 类型检查**

```bash
npm run typecheck:app
```
Expected: PASS。若 `prisma.tripPlan` 类型缺失，先跑 `npm run db:generate`。

- [ ] **Step 3: Commit**

```bash
git add lib/tripPlan/repoPrisma.ts
git commit -m "feat(plan-agent): Prisma TripPlan repository"
```

---

### Task 5: 视图序列化 + 计划 CRUD handlers（TDD）

**Files:**
- Create: `lib/tripPlan/view.ts`
- Create: `lib/tripPlan/handlers/plans.ts`
- Create: `lib/tripPlan/handlers/planById.ts`
- Test: `tests/tripPlan/handlers.test.ts`

- [ ] **Step 1: 写 `lib/tripPlan/view.ts`（API/前端共用的 JSON 视图，Date → ISO 字符串）**

```typescript
import type { TripPlan, TripPlanWithDays } from './repo'

export type TripPlanItemView = {
  id: string
  sortOrder: number
  type: string
  pointId: string | null
  timeHint: string | null
  title: string
  note: string | null
  reason: string | null
  point: { id: string; name: string; nameZh: string | null; lat: number | null; lng: number | null; image: string | null } | null
}

export type TripPlanDayView = {
  id: string
  dayIndex: number
  date: string | null
  citySlug: string | null
  summary: string | null
  items: TripPlanItemView[]
}

export type TripPlanView = {
  id: string
  title: string
  status: string
  startDate: string | null
  dayCount: number
  bangumiIds: number[]
  updatedAt: string
  days: TripPlanDayView[]
}

export type TripPlanListItemView = Omit<TripPlanView, 'days'>

export function toPlanListItemView(plan: TripPlan): TripPlanListItemView {
  return {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    startDate: plan.startDate ? plan.startDate.toISOString() : null,
    dayCount: plan.dayCount,
    bangumiIds: plan.bangumiIds,
    updatedAt: plan.updatedAt.toISOString(),
  }
}

export function toPlanView(plan: TripPlanWithDays): TripPlanView {
  return {
    ...toPlanListItemView(plan),
    days: plan.days.map((day) => ({
      id: day.id,
      dayIndex: day.dayIndex,
      date: day.date ? day.date.toISOString() : null,
      citySlug: day.citySlug,
      summary: day.summary,
      items: day.items.map((item) => ({
        id: item.id,
        sortOrder: item.sortOrder,
        type: item.type,
        pointId: item.pointId,
        timeHint: item.timeHint,
        title: item.title,
        note: item.note,
        reason: item.reason,
        point: item.point,
      })),
    })),
  }
}
```

- [ ] **Step 2: 写失败测试 `tests/tripPlan/handlers.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { createPlansHandlers, DAILY_PLAN_CREATE_LIMIT } from '@/lib/tripPlan/handlers/plans'
import { createPlanByIdHandlers } from '@/lib/tripPlan/handlers/planById'
import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'

function makeDeps(overrides?: Partial<TripPlanHandlerDeps>): TripPlanHandlerDeps {
  return {
    repo: new MemoryTripPlanRepo(),
    getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    ...overrides,
  }
}

describe('plans handlers', () => {
  it('rejects unauthenticated requests', async () => {
    const deps = makeDeps({ getSession: vi.fn().mockResolvedValue(null) })
    const res = await createPlansHandlers(deps).GET()
    expect(res.status).toBe(401)
  })

  it('creates a plan and lists it', async () => {
    const deps = makeDeps()
    const post = await createPlansHandlers(deps).POST(
      new Request('http://localhost/api/me/plans', {
        method: 'POST',
        body: JSON.stringify({ title: '京都京吹巡礼' }),
      }),
    )
    expect(post.status).toBe(201)
    const created = await post.json()
    expect(created.plan.title).toBe('京都京吹巡礼')

    const list = await createPlansHandlers(deps).GET()
    const body = await list.json()
    expect(body.plans).toHaveLength(1)
  })

  it('enforces the daily creation quota', async () => {
    const deps = makeDeps()
    for (let i = 0; i < DAILY_PLAN_CREATE_LIMIT; i++) {
      const res = await createPlansHandlers(deps).POST(
        new Request('http://localhost/api/me/plans', { method: 'POST', body: JSON.stringify({ title: `p${i}` }) }),
      )
      expect(res.status).toBe(201)
    }
    const blocked = await createPlansHandlers(deps).POST(
      new Request('http://localhost/api/me/plans', { method: 'POST', body: JSON.stringify({ title: 'over' }) }),
    )
    expect(blocked.status).toBe(429)
  })
})

describe('planById handlers', () => {
  it('returns 404 for missing plan and 403 for others plans', async () => {
    const deps = makeDeps()
    const handlers = createPlanByIdHandlers(deps)
    expect((await handlers.GET('nope')).status).toBe(404)

    const other = await deps.repo.createPlan({ userId: 'u2', title: 'not mine' })
    expect((await handlers.GET(other.id)).status).toBe(403)
  })

  it('returns the plan view with days and patches meta', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    await deps.repo.replaceDays(plan.id, [
      { dayIndex: 1, summary: '宇治日', items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }] },
    ])
    const handlers = createPlanByIdHandlers(deps)

    const got = await handlers.GET(plan.id)
    expect(got.status).toBe(200)
    const body = await got.json()
    expect(body.plan.days).toHaveLength(1)
    expect(typeof body.plan.updatedAt).toBe('string')

    const patched = await handlers.PATCH(
      plan.id,
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ title: '新', status: 'upcoming' }) }),
    )
    expect(patched.status).toBe(200)

    const bad = await handlers.PATCH(
      plan.id,
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ status: 'bogus' }) }),
    )
    expect(bad.status).toBe(400)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run tests/tripPlan/handlers.test.ts
```
Expected: FAIL（handlers 不存在）。

- [ ] **Step 4: 实现 `lib/tripPlan/handlers/plans.ts`**

```typescript
import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'
import { toPlanListItemView } from '@/lib/tripPlan/view'

export const DAILY_PLAN_CREATE_LIMIT = 3

export type TripPlanHandlerDeps = {
  repo: TripPlanRepo
  getSession: () => Promise<Session | null>
}

export function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function createPlansHandlers(deps: TripPlanHandlerDeps) {
  return {
    async GET() {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })
      const plans = await deps.repo.listPlans(userId)
      return NextResponse.json({ plans: plans.map(toPlanListItemView) })
    },

    async POST(req: Request) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })

      const created = await deps.repo.countPlansCreatedSince(userId, startOfToday())
      if (created >= DAILY_PLAN_CREATE_LIMIT) {
        return NextResponse.json({ error: '今日创建计划次数已达上限，明天再来吧' }, { status: 429 })
      }

      let title = '未命名巡礼计划'
      try {
        const body = (await req.json()) as { title?: unknown }
        if (typeof body.title === 'string' && body.title.trim()) title = body.title.trim().slice(0, 80)
      } catch {
        // 空 body 用默认标题
      }

      const plan = await deps.repo.createPlan({ userId, title })
      return NextResponse.json({ plan: toPlanListItemView(plan) }, { status: 201 })
    },
  }
}
```

- [ ] **Step 5: 实现 `lib/tripPlan/handlers/planById.ts`**

```typescript
import { NextResponse } from 'next/server'
import { TRIP_PLAN_STATUSES, type TripPlanStatus } from '@/lib/tripPlan/repo'
import { toPlanView } from '@/lib/tripPlan/view'
import type { TripPlanHandlerDeps } from './plans'

export function createPlanByIdHandlers(deps: TripPlanHandlerDeps) {
  async function authorize(planId: string) {
    const session = await deps.getSession()
    const userId = session?.user?.id
    if (!userId) return { error: NextResponse.json({ error: '未登录' }, { status: 401 }) }
    const plan = await deps.repo.getPlan(planId)
    if (!plan) return { error: NextResponse.json({ error: '计划不存在' }, { status: 404 }) }
    if (plan.userId !== userId) return { error: NextResponse.json({ error: '无权访问' }, { status: 403 }) }
    return { plan, userId }
  }

  return {
    async GET(planId: string) {
      const auth = await authorize(planId)
      if ('error' in auth) return auth.error
      return NextResponse.json({ plan: toPlanView(auth.plan) })
    },

    async PATCH(planId: string, req: Request) {
      const auth = await authorize(planId)
      if ('error' in auth) return auth.error

      let body: { title?: unknown; status?: unknown }
      try {
        body = (await req.json()) as { title?: unknown; status?: unknown }
      } catch {
        return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
      }

      const patch: { title?: string; status?: TripPlanStatus } = {}
      if (body.title !== undefined) {
        if (typeof body.title !== 'string' || !body.title.trim()) {
          return NextResponse.json({ error: '标题不能为空' }, { status: 400 })
        }
        patch.title = body.title.trim().slice(0, 80)
      }
      if (body.status !== undefined) {
        if (typeof body.status !== 'string' || !TRIP_PLAN_STATUSES.includes(body.status as TripPlanStatus)) {
          return NextResponse.json({ error: '非法状态' }, { status: 400 })
        }
        patch.status = body.status as TripPlanStatus
      }

      await deps.repo.updateMeta(planId, patch)
      const plan = await deps.repo.getPlan(planId)
      return NextResponse.json({ plan: plan ? toPlanView(plan) : null })
    },
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

```bash
npx vitest run tests/tripPlan/handlers.test.ts && npm run typecheck:app && npm run typecheck:tests
```
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add lib/tripPlan tests/tripPlan
git commit -m "feat(plan-agent): trip plan CRUD handlers with daily quota"
```

---

### Task 6: deps 工厂 + API 路由

**Files:**
- Create: `lib/tripPlan/api.ts`
- Create: `app/api/me/plans/route.ts`
- Create: `app/api/me/plans/[id]/route.ts`

- [ ] **Step 1: 写 `lib/tripPlan/api.ts`（照 `lib/directions/api.ts` 的缓存工厂模式）**

```typescript
import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'

let cached: TripPlanHandlerDeps | null = null

export async function getTripPlanApiDeps(): Promise<TripPlanHandlerDeps> {
  if (cached) return cached

  const [{ PrismaTripPlanRepo }, { getServerAuthSession }] = await Promise.all([
    import('@/lib/tripPlan/repoPrisma'),
    import('@/lib/auth/session'),
  ])

  cached = {
    repo: new PrismaTripPlanRepo(),
    getSession: getServerAuthSession,
  }
  return cached
}
```

- [ ] **Step 2: 写 `app/api/me/plans/route.ts`**

```typescript
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { createPlansHandlers } from '@/lib/tripPlan/handlers/plans'

export const runtime = 'nodejs'

export async function GET() {
  const deps = await getTripPlanApiDeps()
  return createPlansHandlers(deps).GET()
}

export async function POST(req: Request) {
  const deps = await getTripPlanApiDeps()
  return createPlansHandlers(deps).POST(req)
}
```

- [ ] **Step 3: 写 `app/api/me/plans/[id]/route.ts`**

```typescript
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { createPlanByIdHandlers } from '@/lib/tripPlan/handlers/planById'

export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const deps = await getTripPlanApiDeps()
  return createPlanByIdHandlers(deps).GET(id)
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const deps = await getTripPlanApiDeps()
  return createPlanByIdHandlers(deps).PATCH(id, req)
}
```

注意：先看一眼相邻路由（如 `app/api/me/routebooks/[id]/route.ts`）确认 params 是否为 Promise 形式（Next 15 是 `Promise<{...}>`），与仓库保持一致。

- [ ] **Step 4: 类型检查 + Commit**

```bash
npm run typecheck:app
git add lib/tripPlan/api.ts app/api/me/plans
git commit -m "feat(plan-agent): trip plan API routes"
```

---

### Task 7: 地理聚类算法（TDD，纯函数）

**Files:**
- Create: `lib/planAgent/cluster.ts`
- Test: `tests/planAgent/cluster.test.ts`

- [ ] **Step 1: 写失败测试 `tests/planAgent/cluster.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { clusterIntoDays, orderWithinDay, haversineKm } from '@/lib/planAgent/cluster'

const UJI = [
  { id: 'uji-bridge', lat: 34.8892, lng: 135.8075 },
  { id: 'daikichiyama', lat: 34.8963, lng: 135.8123 },
  { id: 'uji-shrine', lat: 34.8918, lng: 135.8113 },
]
const KYOTO = [
  { id: 'kyoto-station', lat: 34.9858, lng: 135.7585 },
  { id: 'rokujizo', lat: 34.9337, lng: 135.7695 },
]

describe('haversineKm', () => {
  it('measures ~8km between Kyoto Station and Uji Bridge', () => {
    const d = haversineKm({ lat: 34.9858, lng: 135.7585 }, { lat: 34.8892, lng: 135.8075 })
    expect(d).toBeGreaterThan(8)
    expect(d).toBeLessThan(15)
  })
})

describe('clusterIntoDays', () => {
  it('separates Uji and Kyoto groups into two days', () => {
    const clusters = clusterIntoDays([...UJI, ...KYOTO], 2)
    expect(clusters).toHaveLength(2)
    const groups = clusters.map((c) => [...c.pointIds].sort())
    expect(groups).toContainEqual(['daikichiyama', 'uji-bridge', 'uji-shrine'])
    expect(groups).toContainEqual(['kyoto-station', 'rokujizo'])
  })

  it('caps cluster count at point count and assigns sequential dayIndex from 1', () => {
    const clusters = clusterIntoDays(UJI.slice(0, 2), 5)
    expect(clusters.length).toBeLessThanOrEqual(2)
    expect(clusters.map((c) => c.dayIndex)).toEqual(clusters.map((_, i) => i + 1))
  })

  it('is deterministic', () => {
    const a = clusterIntoDays([...UJI, ...KYOTO], 2)
    const b = clusterIntoDays([...UJI, ...KYOTO], 2)
    expect(a).toEqual(b)
  })

  it('handles empty input', () => {
    expect(clusterIntoDays([], 3)).toEqual([])
  })
})

describe('orderWithinDay', () => {
  it('produces a nearest-neighbor walk starting from the northernmost point', () => {
    const line = [
      { id: 'south', lat: 34.90, lng: 135.80 },
      { id: 'north', lat: 34.94, lng: 135.80 },
      { id: 'middle', lat: 34.92, lng: 135.80 },
    ]
    expect(orderWithinDay(line).map((p) => p.id)).toEqual(['north', 'middle', 'south'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/planAgent/cluster.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `lib/planAgent/cluster.ts`**

```typescript
export type GeoPoint = { id: string; lat: number; lng: number }
export type DayCluster = { dayIndex: number; pointIds: string[] }

const EARTH_RADIUS_KM = 6371

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

export function orderWithinDay(points: GeoPoint[]): GeoPoint[] {
  if (points.length <= 1) return [...points]
  const remaining = [...points]
  remaining.sort((a, b) => b.lat - a.lat || a.lng - b.lng)
  const path: GeoPoint[] = [remaining.shift() as GeoPoint]
  while (remaining.length) {
    const last = path[path.length - 1]
    let bestIdx = 0
    let bestDist = Infinity
    remaining.forEach((p, idx) => {
      const d = haversineKm(last, p)
      if (d < bestDist) {
        bestDist = d
        bestIdx = idx
      }
    })
    path.push(remaining.splice(bestIdx, 1)[0])
  }
  return path
}

export function clusterIntoDays(points: GeoPoint[], dayCount: number): DayCluster[] {
  if (!points.length || dayCount < 1) return []
  const k = Math.min(dayCount, points.length)

  const sorted = [...points].sort((a, b) => a.lng - b.lng || a.lat - b.lat)
  let centroids = Array.from({ length: k }, (_, i) => {
    const seed = sorted[Math.min(sorted.length - 1, Math.floor(((i + 0.5) * sorted.length) / k))]
    return { lat: seed.lat, lng: seed.lng }
  })

  const assignment = new Array<number>(points.length).fill(0)
  for (let iter = 0; iter < 30; iter++) {
    let changed = false
    points.forEach((p, idx) => {
      let best = 0
      let bestDist = Infinity
      centroids.forEach((c, ci) => {
        const d = haversineKm(p, c)
        if (d < bestDist) {
          bestDist = d
          best = ci
        }
      })
      if (assignment[idx] !== best) {
        assignment[idx] = best
        changed = true
      }
    })
    centroids = centroids.map((c, ci) => {
      const members = points.filter((_, idx) => assignment[idx] === ci)
      if (!members.length) return c
      return {
        lat: members.reduce((sum, p) => sum + p.lat, 0) / members.length,
        lng: members.reduce((sum, p) => sum + p.lng, 0) / members.length,
      }
    })
    if (!changed) break
  }

  const groups = new Map<number, GeoPoint[]>()
  points.forEach((p, idx) => {
    const list = groups.get(assignment[idx]) ?? []
    list.push(p)
    groups.set(assignment[idx], list)
  })

  const ordered = [...groups.values()].sort((a, b) => {
    const lngA = a.reduce((sum, p) => sum + p.lng, 0) / a.length
    const lngB = b.reduce((sum, p) => sum + p.lng, 0) / b.length
    return lngA - lngB
  })

  return ordered.map((members, i) => ({
    dayIndex: i + 1,
    pointIds: orderWithinDay(members).map((p) => p.id),
  }))
}
```

- [ ] **Step 4: 跑测试确认通过 + Commit**

```bash
npx vitest run tests/planAgent/cluster.test.ts && npm run typecheck:app
git add lib/planAgent tests/planAgent
git commit -m "feat(plan-agent): deterministic geo clustering for day planning"
```

---

### Task 8: 点位查询器（PointFinder）

**Files:**
- Create: `lib/planAgent/points.ts`
- Create: `lib/planAgent/pointsPrisma.ts`

- [ ] **Step 1: 写接口 `lib/planAgent/points.ts`**

```typescript
export type BangumiHit = { id: number; titleZh: string | null; titleJaRaw: string | null; city: string | null }
export type AgentPoint = { id: string; name: string; nameZh: string | null; lat: number; lng: number; ep: string | null }

export interface PointFinder {
  searchBangumi(query: string, limit: number): Promise<BangumiHit[]>
  listPoints(bangumiId: number, limit: number): Promise<AgentPoint[]>
  getPointsByIds(ids: string[]): Promise<Array<{ id: string; lat: number; lng: number }>>
}
```

- [ ] **Step 2: 写 `lib/planAgent/pointsPrisma.ts`**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { AgentPoint, BangumiHit, PointFinder } from './points'

export class PrismaPointFinder implements PointFinder {
  async searchBangumi(query: string, limit: number): Promise<BangumiHit[]> {
    const rows = await prisma.anitabiBangumi.findMany({
      where: {
        mapEnabled: true,
        OR: [
          { titleZh: { contains: query, mode: 'insensitive' } },
          { titleJaRaw: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, titleZh: true, titleJaRaw: true, city: true },
      take: limit,
    })
    return rows
  }

  async listPoints(bangumiId: number, limit: number): Promise<AgentPoint[]> {
    const rows = await prisma.anitabiPoint.findMany({
      where: { bangumiId, geoLat: { not: null }, geoLng: { not: null } },
      select: { id: true, name: true, nameZh: true, geoLat: true, geoLng: true, ep: true },
      take: limit,
    })
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      nameZh: r.nameZh,
      lat: r.geoLat as number,
      lng: r.geoLng as number,
      ep: r.ep,
    }))
  }

  async getPointsByIds(ids: string[]): Promise<Array<{ id: string; lat: number; lng: number }>> {
    const rows = await prisma.anitabiPoint.findMany({
      where: { id: { in: ids }, geoLat: { not: null }, geoLng: { not: null } },
      select: { id: true, geoLat: true, geoLng: true },
    })
    return rows.map((r) => ({ id: r.id, lat: r.geoLat as number, lng: r.geoLng as number }))
  }
}
```

- [ ] **Step 3: 类型检查 + Commit**

```bash
npm run typecheck:app
git add lib/planAgent/points.ts lib/planAgent/pointsPrisma.ts
git commit -m "feat(plan-agent): point finder over anitabi tables"
```

---

### Task 9: Agent 工具定义与执行器（TDD）

**Files:**
- Create: `lib/planAgent/tools.ts`
- Test: `tests/planAgent/tools.test.ts`

- [ ] **Step 1: 写失败测试 `tests/planAgent/tools.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool, PLAN_AGENT_TOOLS } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import type { PointFinder } from '@/lib/planAgent/points'

const fakeFinder: PointFinder = {
  async searchBangumi(query) {
    return query.includes('上低音号') || query.includes('京吹')
      ? [{ id: 115908, titleZh: '吹响吧！上低音号', titleJaRaw: '響け！ユーフォニアム', city: '宇治' }]
      : []
  },
  async listPoints(bangumiId) {
    if (bangumiId !== 115908) return []
    return [
      { id: 'p-uji-bridge', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, ep: '1' },
      { id: 'p-daikichi', name: '大吉山', nameZh: '大吉山', lat: 34.8963, lng: 135.8123, ep: '8' },
      { id: 'p-kyoto-sta', name: '京都駅', nameZh: '京都站', lat: 34.9858, lng: 135.7585, ep: '2' },
    ]
  },
  async getPointsByIds(ids) {
    const all = await this.listPoints(115908, 100)
    return all.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }))
  },
}

async function makeDeps(): Promise<{ deps: PlanAgentToolDeps; planId: string; repo: MemoryTripPlanRepo }> {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  let updated = 0
  const deps: PlanAgentToolDeps = {
    planId: plan.id,
    repo,
    points: fakeFinder,
    onPlanUpdated: () => {
      updated += 1
    },
  }
  return { deps, planId: plan.id, repo }
}

describe('PLAN_AGENT_TOOLS', () => {
  it('declares the six M1 tools', () => {
    expect(PLAN_AGENT_TOOLS.map((t) => t.name).sort()).toEqual([
      'cluster_points',
      'list_points',
      'read_plan',
      'save_plan_days',
      'search_anime',
      'update_plan_meta',
    ])
  })
})

describe('executePlanTool', () => {
  it('search_anime returns bangumi hits', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'search_anime', { query: '上低音号' }))
    expect(out.results[0].id).toBe(115908)
  })

  it('list_points returns geo points for a bangumi', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'list_points', { bangumiId: 115908 }))
    expect(out.points).toHaveLength(3)
    expect(out.points[0]).toHaveProperty('lat')
  })

  it('cluster_points groups by geography', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'cluster_points', {
        pointIds: ['p-uji-bridge', 'p-daikichi', 'p-kyoto-sta'],
        dayCount: 2,
      }),
    )
    expect(out.clusters).toHaveLength(2)
  })

  it('save_plan_days persists days, resolves invalid types, and fires onPlanUpdated', async () => {
    const { deps, repo, planId } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            summary: '宇治巡礼日',
            items: [
              { type: 'point', pointId: 'p-uji-bridge', title: '宇治桥', reason: '第 1 集取景地' },
              { type: 'transit', title: 'JR 奈良线返回京都', note: '约 20 分钟' },
            ],
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    const plan = await repo.getPlan(planId)
    expect(plan?.days).toHaveLength(1)
    expect(plan?.days[0].items).toHaveLength(2)
  })

  it('update_plan_meta patches title/dayCount/startDate', async () => {
    const { deps, repo, planId } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'update_plan_meta', {
        title: '京都京吹圣地巡礼',
        dayCount: 3,
        startDate: '2026-09-15',
        bangumiIds: [115908],
      }),
    )
    expect(out.ok).toBe(true)
    const plan = await repo.getPlan(planId)
    expect(plan?.title).toBe('京都京吹圣地巡礼')
    expect(plan?.dayCount).toBe(3)
  })

  it('read_plan returns current structure and unknown tool errors cleanly', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'read_plan', {}))
    expect(out.plan.title).toBe('t')
    const err = JSON.parse(await executePlanTool(deps, 'no_such_tool', {}))
    expect(err.error).toBeTruthy()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/planAgent/tools.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 `lib/planAgent/tools.ts`**

```typescript
import type Anthropic from '@anthropic-ai/sdk'
import { clusterIntoDays } from './cluster'
import type { PointFinder } from './points'
import { TRIP_PLAN_ITEM_TYPES, type TripPlanDayInput, type TripPlanItemType, type TripPlanRepo } from '@/lib/tripPlan/repo'
import { toPlanView } from '@/lib/tripPlan/view'

export type PlanAgentToolDeps = {
  planId: string
  repo: TripPlanRepo
  points: PointFinder
  onPlanUpdated?: () => void
}

const itemSchema = {
  type: 'object' as const,
  properties: {
    type: { type: 'string', enum: TRIP_PLAN_ITEM_TYPES, description: '条目类型' },
    pointId: { type: 'string', description: 'type=point 时必填，来自 list_points 的点位 id' },
    title: { type: 'string', description: '条目标题（点位中文名/交通段/活动名）' },
    timeHint: { type: 'string', description: '时间提示，如“上午”“14:00”' },
    note: { type: 'string', description: '补充说明' },
    reason: { type: 'string', description: '为什么这么安排（面向用户展示）' },
  },
  required: ['type', 'title'],
}

export const PLAN_AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_anime',
    description: '按作品名（中文或日文，支持部分匹配）搜索圣地巡礼作品，返回 bangumiId。规划前必须先用它确定作品。',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: '作品名关键词，如“上低音号”' } },
      required: ['query'],
    },
  },
  {
    name: 'list_points',
    description: '列出某作品的全部有坐标巡礼点位（含中文名、经纬度、出现集数）。',
    input_schema: {
      type: 'object',
      properties: {
        bangumiId: { type: 'number', description: 'search_anime 返回的作品 id' },
        limit: { type: 'number', description: '最多返回条数，默认 60' },
      },
      required: ['bangumiId'],
    },
  },
  {
    name: 'cluster_points',
    description: '把一组点位按地理位置聚成 N 天，并给出每天内的顺路访问顺序。这是确定性算法，排天分组必须用它，不要自己凭感觉分。',
    input_schema: {
      type: 'object',
      properties: {
        pointIds: { type: 'array', items: { type: 'string' }, description: '要安排的点位 id 列表' },
        dayCount: { type: 'number', description: '巡礼天数' },
      },
      required: ['pointIds', 'dayCount'],
    },
  },
  {
    name: 'read_plan',
    description: '读取当前计划的完整结构（标题、天数、每日条目）。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'update_plan_meta',
    description: '更新计划元信息：标题、总天数、出发日期（ISO 日期字符串）、关联作品 id。',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        dayCount: { type: 'number' },
        startDate: { type: 'string', description: 'ISO 日期，如 2026-09-15；传空字符串清除' },
        bangumiIds: { type: 'array', items: { type: 'number' } },
      },
    },
  },
  {
    name: 'save_plan_days',
    description:
      '整体保存每日行程（覆盖旧内容）。每天是一个按访问顺序排列的条目时间线：point 条目挂 pointId，点位之间插入 transit 条目说明交通方式。每个安排都写 reason。这是计划的唯一落库方式，规划结果必须通过它保存。',
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dayIndex: { type: 'number', description: '第几天，从 1 开始' },
              citySlug: { type: 'string', description: '当天主要城市，如 kyoto' },
              summary: { type: 'string', description: '当天一句话概述' },
              items: { type: 'array', items: itemSchema },
            },
            required: ['dayIndex', 'items'],
          },
        },
      },
      required: ['days'],
    },
  },
]

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

export async function executePlanTool(deps: PlanAgentToolDeps, name: string, input: unknown): Promise<string> {
  const args = asRecord(input)
  try {
    switch (name) {
      case 'search_anime': {
        const query = String(args.query ?? '').trim()
        if (!query) return JSON.stringify({ error: 'query 不能为空' })
        const results = await deps.points.searchBangumi(query, 8)
        return JSON.stringify({ results })
      }
      case 'list_points': {
        const bangumiId = Number(args.bangumiId)
        if (!Number.isFinite(bangumiId)) return JSON.stringify({ error: 'bangumiId 必须是数字' })
        const limit = Number.isFinite(Number(args.limit)) ? Math.min(Number(args.limit), 120) : 60
        const points = await deps.points.listPoints(bangumiId, limit)
        return JSON.stringify({ points })
      }
      case 'cluster_points': {
        const pointIds = Array.isArray(args.pointIds) ? args.pointIds.map(String) : []
        const dayCount = Number(args.dayCount)
        if (!pointIds.length || !Number.isFinite(dayCount)) {
          return JSON.stringify({ error: 'pointIds 与 dayCount 必填' })
        }
        const coords = await deps.points.getPointsByIds(pointIds)
        const clusters = clusterIntoDays(coords, Math.max(1, Math.floor(dayCount)))
        return JSON.stringify({ clusters })
      }
      case 'read_plan': {
        const plan = await deps.repo.getPlan(deps.planId)
        if (!plan) return JSON.stringify({ error: '计划不存在' })
        return JSON.stringify({ plan: toPlanView(plan) })
      }
      case 'update_plan_meta': {
        const patch: Parameters<TripPlanRepo['updateMeta']>[1] = {}
        if (typeof args.title === 'string' && args.title.trim()) patch.title = args.title.trim().slice(0, 80)
        if (Number.isFinite(Number(args.dayCount))) patch.dayCount = Math.max(1, Math.floor(Number(args.dayCount)))
        if (typeof args.startDate === 'string') {
          patch.startDate = args.startDate.trim() ? new Date(args.startDate) : null
        }
        if (Array.isArray(args.bangumiIds)) patch.bangumiIds = args.bangumiIds.map(Number).filter(Number.isFinite)
        await deps.repo.updateMeta(deps.planId, patch)
        deps.onPlanUpdated?.()
        return JSON.stringify({ ok: true })
      }
      case 'save_plan_days': {
        const rawDays = Array.isArray(args.days) ? args.days : null
        if (!rawDays) return JSON.stringify({ error: 'days 必须是数组' })
        const days: TripPlanDayInput[] = rawDays.map((raw) => {
          const day = asRecord(raw)
          const items = Array.isArray(day.items) ? day.items : []
          return {
            dayIndex: Math.max(1, Math.floor(Number(day.dayIndex) || 1)),
            citySlug: typeof day.citySlug === 'string' ? day.citySlug : null,
            summary: typeof day.summary === 'string' ? day.summary : null,
            items: items.map((rawItem) => {
              const item = asRecord(rawItem)
              const type = TRIP_PLAN_ITEM_TYPES.includes(item.type as TripPlanItemType)
                ? (item.type as TripPlanItemType)
                : 'free'
              return {
                type,
                pointId: typeof item.pointId === 'string' ? item.pointId : null,
                title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '未命名条目',
                timeHint: typeof item.timeHint === 'string' ? item.timeHint : null,
                note: typeof item.note === 'string' ? item.note : null,
                reason: typeof item.reason === 'string' ? item.reason : null,
              }
            }),
          }
        })
        await deps.repo.replaceDays(deps.planId, days)
        deps.onPlanUpdated?.()
        return JSON.stringify({ ok: true, savedDays: days.length })
      }
      default:
        return JSON.stringify({ error: `未知工具: ${name}` })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return JSON.stringify({ error: message })
  }
}
```

- [ ] **Step 4: 跑测试确认通过 + Commit**

```bash
npx vitest run tests/planAgent/tools.test.ts && npm run typecheck:app && npm run typecheck:tests
git add lib/planAgent tests/planAgent
git commit -m "feat(plan-agent): agent tool definitions and executor"
```

---

### Task 10: 系统提示词

**Files:**
- Create: `lib/planAgent/prompt.ts`

- [ ] **Step 1: 写 `lib/planAgent/prompt.ts`**

```typescript
export const PLAN_AGENT_SYSTEM_PROMPT = `你是 SeichiGo（圣地GO）的巡礼行程规划师，帮动漫爱好者把圣地巡礼安排成可执行的多日计划。

## 工作流程（严格遵守）
1. 用 search_anime 确定用户要巡礼的作品，拿到 bangumiId。搜不到就告诉用户并请其换个说法，不要编造点位。
2. 用 list_points 拉取该作品的真实点位。你只能使用这些点位，绝不虚构任何巡礼点位。
3. 若用户没说清天数或日期，先用一句话问清（一次只问一个问题）。
4. 用 cluster_points 做按天分组和顺路排序，以它的结果为准安排每天的点位顺序。
5. 用 update_plan_meta 写入标题、天数、出发日期和作品 id；用 save_plan_days 保存每日行程。规划结果必须落到这两个工具里，只写在聊天文字里等于没做。
6. 保存后用简短的文字向用户总结：每天去哪、为什么这么排、有什么注意事项。

## 行程编排规则
- 每天条目按访问顺序排列；相邻点位间隔较远时插入 transit 条目，写明建议交通方式（步行/JR/地铁/巴士）与粗略耗时。
- 每个安排尽量填 reason（为什么这么排），用户会在界面上看到。
- 一天安排 4-8 个点位为宜，节奏留有余地；点位很多时优先取该作品的代表性场景。
- 你可以给出住宿区域、美食方向的口头建议，但不要编造具体店名、价格、航班信息；涉及实时信息时提醒用户自行核实。

## 语气
- 中文回复，热情但不啰嗦。懂圣地巡礼文化（如打卡、取景对比），像一个可靠的巡礼老手朋友。
- 修改请求（如“第二天太赶了”）：读取当前计划（read_plan），调整后重新 save_plan_days，并说明改了什么。`
```

- [ ] **Step 2: 类型检查 + Commit**

```bash
npm run typecheck:app
git add lib/planAgent/prompt.ts
git commit -m "feat(plan-agent): system prompt"
```

---

### Task 11: Agent 主循环（TDD，注入 createMessage）

**Files:**
- Create: `lib/planAgent/loop.ts`
- Test: `tests/planAgent/loop.test.ts`

- [ ] **Step 1: 写失败测试 `tests/planAgent/loop.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import type { PointFinder } from '@/lib/planAgent/points'

const finder: PointFinder = {
  async searchBangumi() {
    return [{ id: 115908, titleZh: '吹响吧！上低音号', titleJaRaw: null, city: '宇治' }]
  },
  async listPoints() {
    return [{ id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, ep: '1' }]
  },
  async getPointsByIds() {
    return [{ id: 'p1', lat: 34.8892, lng: 135.8075 }]
  },
}

function message(content: Anthropic.ContentBlock[], stopReason: Anthropic.Message['stop_reason']): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } as Anthropic.Message['usage'],
  } as Anthropic.Message
}

describe('runPlanAgent', () => {
  it('executes tool calls, persists messages, and emits events', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: Anthropic.Message[] = [
      message(
        [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'save_plan_days',
            input: { days: [{ dayIndex: 1, items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }] }] },
          } as Anthropic.ToolUseBlock,
        ],
        'tool_use',
      ),
      message([{ type: 'text', text: '安排好了！Day1 去宇治桥。', citations: null } as Anthropic.TextBlock], 'end_turn'),
    ]
    const createMessage = vi.fn(async () => responses.shift() as Anthropic.Message)

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage,
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        maxIterations: 5,
      },
      '帮我安排京吹一日巡礼',
      (e) => events.push(e),
    )

    expect(createMessage).toHaveBeenCalledTimes(2)
    const saved = await repo.getPlan(plan.id)
    expect(saved?.days).toHaveLength(1)

    expect(events.some((e) => e.type === 'plan_updated')).toBe(true)
    expect(events.some((e) => e.type === 'text' && e.text.includes('宇治桥'))).toBe(true)
    expect(events[events.length - 1].type).toBe('done')

    const persisted = await repo.listMessages(plan.id)
    expect(persisted.length).toBeGreaterThanOrEqual(4)
    expect(persisted[0].role).toBe('user')
  })

  it('stops at maxIterations and still emits done', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async () =>
      message(
        [{ type: 'tool_use', id: 'tu_x', name: 'read_plan', input: {} } as Anthropic.ToolUseBlock],
        'tool_use',
      ),
    )

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 3 },
      'hi',
      (e) => events.push(e),
    )
    expect(createMessage).toHaveBeenCalledTimes(3)
    expect(events[events.length - 1].type).toBe('done')
  })

  it('emits error event when the model call throws', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async () => {
      throw new Error('rate limited')
    })
    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      'hi',
      (e) => events.push(e),
    )
    expect(events.some((e) => e.type === 'error')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/planAgent/loop.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 `lib/planAgent/loop.ts`**

```typescript
import type Anthropic from '@anthropic-ai/sdk'
import type { Prisma } from '@prisma/client'
import { executePlanTool, PLAN_AGENT_TOOLS, type PlanAgentToolDeps } from './tools'
import { PLAN_AGENT_SYSTEM_PROMPT } from './prompt'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'

export type PlanAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'plan_updated' }
  | { type: 'done' }
  | { type: 'error'; message: string }

export type CreateMessageFn = (params: {
  system: string
  messages: Anthropic.MessageParam[]
  tools: Anthropic.Tool[]
}) => Promise<Anthropic.Message>

export type PlanAgentDeps = {
  createMessage: CreateMessageFn
  repo: TripPlanRepo
  planId: string
  toolDeps: PlanAgentToolDeps
  maxIterations?: number
}

const DEFAULT_MAX_ITERATIONS = 12

function isMessageParam(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'role' in value
}

export async function runPlanAgent(
  deps: PlanAgentDeps,
  userMessage: string,
  onEvent: (event: PlanAgentEvent) => void,
): Promise<void> {
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS

  const history = await deps.repo.listMessages(deps.planId)
  const messages: Anthropic.MessageParam[] = history
    .map((m) => m.content)
    .filter(isMessageParam)
    .map((m) => m as unknown as Anthropic.MessageParam)

  const userParam: Anthropic.MessageParam = { role: 'user', content: userMessage }
  messages.push(userParam)
  await deps.repo.appendMessage(deps.planId, 'user', userParam as unknown as Prisma.JsonValue)

  const toolDeps: PlanAgentToolDeps = {
    ...deps.toolDeps,
    onPlanUpdated: () => {
      deps.toolDeps.onPlanUpdated?.()
      onEvent({ type: 'plan_updated' })
    },
  }

  try {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await deps.createMessage({
        system: PLAN_AGENT_SYSTEM_PROMPT,
        messages,
        tools: PLAN_AGENT_TOOLS,
      })

      for (const block of response.content) {
        if (block.type === 'text' && block.text) onEvent({ type: 'text', text: block.text })
      }

      const assistantParam: Anthropic.MessageParam = { role: 'assistant', content: response.content }
      messages.push(assistantParam)
      await deps.repo.appendMessage(deps.planId, 'assistant', assistantParam as unknown as Prisma.JsonValue)

      if (response.stop_reason === 'pause_turn') continue

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (!toolUses.length) break

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const toolUse of toolUses) {
        const result = await executePlanTool(toolDeps, toolUse.name, toolUse.input)
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result })
      }

      const resultParam: Anthropic.MessageParam = { role: 'user', content: toolResults }
      messages.push(resultParam)
      await deps.repo.appendMessage(deps.planId, 'user', resultParam as unknown as Prisma.JsonValue)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    onEvent({ type: 'error', message })
  }

  onEvent({ type: 'done' })
}
```

- [ ] **Step 4: 跑测试确认通过 + Commit**

```bash
npx vitest run tests/planAgent/loop.test.ts && npm run typecheck:app && npm run typecheck:tests
git add lib/planAgent tests/planAgent
git commit -m "feat(plan-agent): tool-use agent loop with injectable model client"
```

---

### Task 12: Agent deps 工厂 + SSE 路由

**Files:**
- Create: `lib/planAgent/api.ts`
- Create: `app/api/me/plans/[id]/agent/route.ts`

- [ ] **Step 1: 写 `lib/planAgent/api.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { CreateMessageFn } from './loop'

const MODEL = process.env.PLAN_AGENT_MODEL || 'claude-opus-5'

let cachedClient: Anthropic | null = null

function getClient(): Anthropic {
  if (!cachedClient) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY 未配置')
    }
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return cachedClient
}

export const createAnthropicMessage: CreateMessageFn = async ({ system, messages, tools }) => {
  return getClient().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages,
    tools,
  })
}
```

- [ ] **Step 2: 写 `app/api/me/plans/[id]/agent/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { startOfToday } from '@/lib/tripPlan/handlers/plans'
import { createAnthropicMessage } from '@/lib/planAgent/api'
import { runPlanAgent, type PlanAgentEvent } from '@/lib/planAgent/loop'
import { PrismaPointFinder } from '@/lib/planAgent/pointsPrisma'

export const runtime = 'nodejs'

const DAILY_MESSAGE_LIMIT = 40

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const deps = await getTripPlanApiDeps()

  const session = await deps.getSession()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const plan = await deps.repo.getPlan(id)
  if (!plan) return NextResponse.json({ error: '计划不存在' }, { status: 404 })
  if (plan.userId !== userId) return NextResponse.json({ error: '无权访问' }, { status: 403 })

  const used = await deps.repo.countUserMessagesSince(userId, startOfToday())
  if (used >= DAILY_MESSAGE_LIMIT) {
    return NextResponse.json({ error: '今日 AI 规划额度已用完，明天再来吧' }, { status: 429 })
  }

  let message = ''
  try {
    const body = (await req.json()) as { message?: unknown }
    if (typeof body.message === 'string') message = body.message.trim()
  } catch {
    // fallthrough
  }
  if (!message) return NextResponse.json({ error: '消息不能为空' }, { status: 400 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PlanAgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      try {
        await runPlanAgent(
          {
            createMessage: createAnthropicMessage,
            repo: deps.repo,
            planId: id,
            toolDeps: { planId: id, repo: deps.repo, points: new PrismaPointFinder() },
          },
          message,
          send,
        )
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : '服务器错误' })
        send({ type: 'done' })
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
```

- [ ] **Step 3: 类型检查 + Commit**

```bash
npm run typecheck:app
git add lib/planAgent/api.ts app/api/me/plans
git commit -m "feat(plan-agent): SSE agent route with daily message quota"
```

- [ ] **Step 4: 在 `.env.local` 确认/补充环境变量（不提交）**

`.env.local` 需要 `ANTHROPIC_API_KEY=sk-ant-...`。若没有该文件或 key，提醒用户提供，不要自己造。

---

### Task 13: RoutePreviewMap 移到共享目录

**Files:**
- Move: `app/(authed)/me/routebooks/[id]/components/RoutePreviewMap.tsx` → `components/route/RoutePreviewMap.tsx`
- Modify: `app/(authed)/me/routebooks/[id]/components/PlannerMapStage.tsx`（更新 import）

- [ ] **Step 1: 移动文件**

```bash
mkdir -p components/route
git mv "app/(authed)/me/routebooks/[id]/components/RoutePreviewMap.tsx" components/route/RoutePreviewMap.tsx
```

- [ ] **Step 2: 更新引用**

先确认全部引用点：

```bash
grep -rn "RoutePreviewMap" app components features --include="*.tsx" --include="*.ts"
```

把 `PlannerMapStage.tsx`（以及 grep 出的其它引用）中的相对导入改为：

```typescript
import { RoutePreviewMap } from '@/components/route/RoutePreviewMap'
```

（若原文件是 default export，则对应改成 `import RoutePreviewMap from '@/components/route/RoutePreviewMap'`——以移动后文件的实际导出为准。）

- [ ] **Step 3: 验证 + Commit**

```bash
npm run typecheck:app && npx vitest run tests/routeBook
git add -A
git commit -m "refactor(route): move RoutePreviewMap to shared components"
```

---

### Task 14: /plan 前端（列表 + 规划器：对话 + 日程卡片 + 地图）

**Files:**
- Create: `app/(authed)/plan/page.tsx`
- Create: `app/(authed)/plan/CreatePlanButton.tsx`
- Create: `app/(authed)/plan/[id]/page.tsx`
- Create: `app/(authed)/plan/[id]/ui.tsx`
- Create: `app/(authed)/plan/[id]/components/DayCards.tsx`
- Test: `tests/plan/day-cards.test.tsx`

先看一眼 `app/(authed)/me/routebooks/page.tsx` 与 `layout.tsx`，确认 (authed) 组的鉴权与页面骨架写法，保持一致（比如未登录重定向的方式）。

- [ ] **Step 1: 写失败测试 `tests/plan/day-cards.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DayCards } from '@/app/(authed)/plan/[id]/components/DayCards'
import type { TripPlanView } from '@/lib/tripPlan/view'

const plan: TripPlanView = {
  id: 'plan-1',
  title: '京都京吹圣地巡礼',
  status: 'draft',
  startDate: null,
  dayCount: 2,
  bangumiIds: [115908],
  updatedAt: new Date().toISOString(),
  days: [
    {
      id: 'day-1',
      dayIndex: 1,
      date: null,
      citySlug: 'kyoto',
      summary: '宇治巡礼日',
      items: [
        {
          id: 'item-1',
          sortOrder: 0,
          type: 'point',
          pointId: 'p1',
          timeHint: '上午',
          title: '宇治桥',
          note: null,
          reason: '第 1 集开场取景地',
          point: { id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, image: null },
        },
        {
          id: 'item-2',
          sortOrder: 1,
          type: 'transit',
          pointId: null,
          timeHint: null,
          title: 'JR 奈良线',
          note: '约 20 分钟',
          reason: null,
          point: null,
        },
      ],
    },
    { id: 'day-2', dayIndex: 2, date: null, citySlug: null, summary: null, items: [] },
  ],
}

describe('DayCards', () => {
  it('renders day tabs and items with reason', () => {
    render(<DayCards plan={plan} selectedDay={1} onSelectDay={() => {}} />)
    expect(screen.getByText('Day 1')).toBeTruthy()
    expect(screen.getByText('Day 2')).toBeTruthy()
    expect(screen.getByText('宇治桥')).toBeTruthy()
    expect(screen.getByText('第 1 集开场取景地')).toBeTruthy()
    expect(screen.getByText(/JR 奈良线/)).toBeTruthy()
  })

  it('shows empty state when plan has no days', () => {
    render(<DayCards plan={{ ...plan, days: [] }} selectedDay={1} onSelectDay={() => {}} />)
    expect(screen.getByText(/还没有行程/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/plan/day-cards.test.tsx
```
Expected: FAIL。

- [ ] **Step 3: 实现 `app/(authed)/plan/[id]/components/DayCards.tsx`**

```tsx
'use client'

import type { TripPlanView } from '@/lib/tripPlan/view'

const TYPE_LABELS: Record<string, string> = {
  point: '点位',
  transit: '交通',
  meal: '用餐',
  lodging: '住宿',
  attraction: '景点',
  free: '自由',
}

export function DayCards(props: {
  plan: TripPlanView
  selectedDay: number
  onSelectDay: (dayIndex: number) => void
}) {
  const { plan, selectedDay, onSelectDay } = props

  if (!plan.days.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        还没有行程——在左侧告诉规划师你想去哪、巡礼哪部作品吧。
      </div>
    )
  }

  const active = plan.days.find((d) => d.dayIndex === selectedDay) ?? plan.days[0]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {plan.days.map((day) => (
          <button
            key={day.id}
            type="button"
            onClick={() => onSelectDay(day.dayIndex)}
            className={
              day.dayIndex === active.dayIndex
                ? 'rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white'
                : 'rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-600 hover:border-brand-300'
            }
          >
            {`Day ${day.dayIndex}`}
          </button>
        ))}
      </div>

      {active.summary ? <p className="text-sm font-medium text-gray-700">{active.summary}</p> : null}

      <ol className="space-y-3">
        {active.items.map((item) => (
          <li key={item.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {TYPE_LABELS[item.type] ?? item.type}
              </span>
              {item.timeHint ? <span className="text-xs text-gray-400">{item.timeHint}</span> : null}
              <span className="font-semibold text-gray-900">{item.title}</span>
            </div>
            {item.note ? <p className="mt-1 text-xs text-gray-500">{item.note}</p> : null}
            {item.reason ? <p className="mt-1 text-xs text-brand-600">{item.reason}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/plan/day-cards.test.tsx
```
Expected: PASS。

- [ ] **Step 5: 实现列表页 `app/(authed)/plan/page.tsx` 与 `CreatePlanButton.tsx`**

`app/(authed)/plan/page.tsx`：

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { toPlanListItemView } from '@/lib/tripPlan/view'
import { CreatePlanButton } from './CreatePlanButton'

export const dynamic = 'force-dynamic'

export default async function PlanListPage() {
  const deps = await getTripPlanApiDeps()
  const session = await deps.getSession()
  if (!session?.user?.id) redirect('/auth/signin?callbackUrl=/plan')

  const plans = (await deps.repo.listPlans(session.user.id)).map(toPlanListItemView)

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">我的巡礼计划</h1>
        <CreatePlanButton />
      </div>
      {plans.length ? (
        <ul className="space-y-3">
          {plans.map((plan) => (
            <li key={plan.id}>
              <Link
                href={`/plan/${plan.id}`}
                className="block rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">{plan.title}</span>
                  <span className="text-xs text-gray-400">{plan.dayCount} 天</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">
          还没有计划。点击“新建计划”，告诉 AI 规划师你想去哪巡礼。
        </div>
      )}
    </div>
  )
}
```

`app/(authed)/plan/CreatePlanButton.tsx`：

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function CreatePlanButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/me/plans', { method: 'POST', body: JSON.stringify({}) })
      const body = (await res.json()) as { plan?: { id: string }; error?: string }
      if (!res.ok || !body.plan) {
        setError(body.error ?? '创建失败')
        return
      }
      router.push(`/plan/${body.plan.id}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error ? <span className="text-xs text-red-500">{error}</span> : null}
      <button
        type="button"
        onClick={create}
        disabled={pending}
        className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? '创建中…' : '新建计划'}
      </button>
    </div>
  )
}
```

- [ ] **Step 6: 实现规划器页 `app/(authed)/plan/[id]/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { toPlanView } from '@/lib/tripPlan/view'
import { PlanPlanner } from './ui'

export const dynamic = 'force-dynamic'

export default async function PlanDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const deps = await getTripPlanApiDeps()
  const session = await deps.getSession()
  if (!session?.user?.id) redirect(`/auth/signin?callbackUrl=/plan/${id}`)

  const plan = await deps.repo.getPlan(id)
  if (!plan) notFound()
  if (plan.userId !== session.user.id) notFound()

  return <PlanPlanner planId={id} initialPlan={toPlanView(plan)} />
}
```

- [ ] **Step 7: 实现 `app/(authed)/plan/[id]/ui.tsx`（对话 + SSE + 日程 + 地图联动）**

```tsx
'use client'

import { useMemo, useRef, useState } from 'react'
import RoutePreviewMap from '@/components/route/RoutePreviewMap'
import type { TripPlanView } from '@/lib/tripPlan/view'
import { DayCards } from './components/DayCards'

type ChatEntry = { role: 'user' | 'assistant'; text: string }
type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'plan_updated' }
  | { type: 'done' }
  | { type: 'error'; message: string }

export function PlanPlanner(props: { planId: string; initialPlan: TripPlanView }) {
  const [plan, setPlan] = useState(props.initialPlan)
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedDay, setSelectedDay] = useState(1)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const mapPoints = useMemo(() => {
    const day = plan.days.find((d) => d.dayIndex === selectedDay) ?? plan.days[0]
    if (!day) return []
    return day.items
      .filter((item) => item.point && item.point.lat != null && item.point.lng != null)
      .map((item, idx) => ({
        lat: item.point!.lat as number,
        lng: item.point!.lng as number,
        label: `${idx + 1}. ${item.title}`,
      }))
  }, [plan, selectedDay])

  async function refreshPlan() {
    const res = await fetch(`/api/me/plans/${props.planId}`)
    if (!res.ok) return
    const body = (await res.json()) as { plan?: TripPlanView }
    if (body.plan) setPlan(body.plan)
  }

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    setInput('')
    setBusy(true)
    setChat((prev) => [...prev, { role: 'user', text: message }])

    try {
      const res = await fetch(`/api/me/plans/${props.planId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setChat((prev) => [...prev, { role: 'assistant', text: body?.error ?? '请求失败，请稍后再试' }])
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          const line = frame.trim()
          if (!line.startsWith('data:')) continue
          let event: AgentEvent
          try {
            event = JSON.parse(line.slice(5)) as AgentEvent
          } catch {
            continue
          }
          if (event.type === 'text') {
            setChat((prev) => [...prev, { role: 'assistant', text: event.text }])
          } else if (event.type === 'plan_updated') {
            await refreshPlan()
          } else if (event.type === 'error') {
            setChat((prev) => [...prev, { role: 'assistant', text: `出错了：${event.message}` }])
          }
        }
      }
    } finally {
      setBusy(false)
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(320px,2fr)_3fr]">
      <section className="flex h-[70vh] flex-col rounded-2xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">{plan.title}</div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {chat.length === 0 ? (
            <p className="text-sm text-gray-400">
              试试：“帮我安排下个月中旬去京都，做京吹圣地巡礼的 3 天计划”
            </p>
          ) : null}
          {chat.map((entry, idx) => (
            <div
              key={idx}
              className={
                entry.role === 'user'
                  ? 'ml-auto max-w-[85%] rounded-2xl bg-brand-50 px-4 py-2 text-sm text-gray-900'
                  : 'max-w-[92%] whitespace-pre-wrap rounded-2xl bg-gray-50 px-4 py-2 text-sm text-gray-800'
              }
            >
              {entry.text}
            </div>
          ))}
          {busy ? <p className="text-xs text-gray-400">规划师思考中…</p> : null}
          <div ref={chatEndRef} />
        </div>
        <form
          className="flex gap-2 border-t border-gray-100 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="告诉规划师你的巡礼想法…"
            className="flex-1 rounded-full border border-gray-200 px-4 py-2 text-sm outline-none focus:border-brand-400"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            发送
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <RoutePreviewMap points={mapPoints} routeGeometry={null} className="h-64 w-full rounded-2xl" />
        <DayCards plan={plan} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
      </section>
    </div>
  )
}
```

注意：`RoutePreviewMap` 的导入方式（default / named）以 Task 13 移动后的实际导出为准，两处保持一致。

- [ ] **Step 8: 验证 + Commit**

```bash
npx vitest run tests/plan && npm run typecheck:app && npm run typecheck:tests
git add app/\(authed\)/plan tests/plan
git commit -m "feat(plan-agent): /plan pages with chat, day cards and map preview"
```

---

### Task 15: 信息架构改造（导航 + i18n + /me 聚合页）

**Files:**
- Modify: `lib/i18n/locales/zh.json`、`lib/i18n/locales/en.json`、`lib/i18n/locales/ja.json`
- Modify: `components/layout/Header.tsx`、`components/layout/HeaderPublic.tsx`、`components/layout/HeaderMobileDrawer.client.tsx`
- Create: `app/(authed)/me/page.tsx`

- [ ] **Step 1: i18n 文案**

`zh.json` 的 `header` 块：`posts` 值改为 `"热门攻略"`，`city` 值改为 `"热门城市"`，新增 `"plan": "计划"`、`"me": "我的"`。保留 `anime`/`resources`/`submit` 键（页面内仍在用）。

`en.json` 对应：`posts` → `"Top Guides"`，`city` → `"Top Cities"`，新增 `"plan": "Plan"`、`"me": "Me"`。

`ja.json` 对应：`posts` → `"人気ガイド"`，`city` → `"人気都市"`，新增 `"plan": "計画"`、`"me": "マイページ"`。

- [ ] **Step 2: 桌面导航 `components/layout/Header.tsx`**

把第 42-47 行的导航链接列表替换为（保留 admin 条件行不动）：

```tsx
          <Link href={prefixPath('/plan', locale)} className="hover:text-brand-600">{t('header.plan', locale)}</Link>
          <Link href={prefixPath('/map', locale)} className="hover:text-brand-600">{t('header.map', locale)}</Link>
          <Link href={prefixPath('/', locale)} className="hover:text-brand-600">{t('header.posts', locale)}</Link>
          <Link href={prefixPath('/city', locale)} className="hover:text-brand-600">{t('header.city', locale)}</Link>
```

在用户下拉菜单里（现有 `/me/favorites` 链接旁）加一条到 `/me` 的入口，文案 `t('header.me', locale)`。

- [ ] **Step 3: 同步 `HeaderPublic.tsx` 与 `HeaderMobileDrawer.client.tsx`**

打开这两个文件，找到与 Header.tsx 相同的导航链接列表，替换为 Step 2 的同一组四条链接（plan/map/posts/city，样式类名沿用各自文件原有的）。移动抽屉里额外保留 `resources` 与 `submit` 两条原有链接（移动端是这两个功能仅剩的入口），并新增 `plan` 在最上方。

- [ ] **Step 4: 新建 `/me` 聚合页 `app/(authed)/me/page.tsx`**

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'

const SECTIONS = [
  { href: '/plan', title: '我的巡礼计划', desc: 'AI 规划的多日巡礼行程' },
  { href: '/me/favorites', title: '我的收藏', desc: '收藏的点位与攻略' },
  { href: '/me/routebooks', title: '个人地图', desc: '手动整理的点位路书' },
  { href: '/submit', title: '投稿', desc: '分享你的巡礼攻略' },
  { href: '/me/settings', title: '设置', desc: '账号与偏好设置' },
]

export default async function MePage() {
  const session = await getServerAuthSession()
  if (!session?.user?.id) redirect('/auth/signin?callbackUrl=/me')

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-gray-900">我的</h1>
      <ul className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="block rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-sm"
            >
              <p className="font-semibold text-gray-900">{section.title}</p>
              <p className="mt-1 text-sm text-gray-500">{section.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: 修复受影响的测试**

```bash
npx vitest run tests/layout tests/home tests/i18n
```
若有断言旧导航文案（"首页"/"作品"/"城市"）的测试失败，把断言更新为新文案/新链接结构；不要为通过测试回退产品改动。

- [ ] **Step 6: 全量验证 + Commit**

```bash
npm run typecheck:app && npm test
git add lib/i18n components/layout app/\(authed\)/me tests
git commit -m "feat(ia): plan-first navigation and /me hub"
```

---

### Task 16: 端到端手工验收

**Files:** 无新文件。

- [ ] **Step 1: 全量自动化验证**

```bash
npm test && npm run typecheck && npm run lint
```
Expected: 全部通过（lint 脚本自带 `|| true`，看输出别只看退出码）。

- [ ] **Step 2: 启动 dev 并手工走查**

```bash
npm run dev
```

核对清单（逐项确认）：
1. 未登录访问 `/plan` → 跳转登录。
2. 登录后 `/plan` → 新建计划 → 进入规划器。
3. 输入「帮我安排 3 天京都京吹圣地巡礼」→ 对话区出现规划师回复，日程卡片出现 Day 1-3，每个点位条目有 reason，地图上出现当天点位标记与连线；切换 Day 地图联动。
4. 追加「第一天太赶了，减少两个点」→ 计划被修改并刷新。
5. 刷新页面 → 计划仍在（落库成功）；`/plan` 列表能看到该计划。
6. 同一天创建第 4 个计划 → 返回 429 文案。
7. 导航栏为「计划 | 地图 | 热门攻略 | 热门城市」，`/me` 聚合页各入口可达；移动端抽屉含 资源/投稿。
8. `/me/routebooks` 的路书详情页地图（RoutePreviewMap 移动后）仍正常渲染。

- [ ] **Step 3: 记录验收结果**

把走查结果（含 agent 实际输出质量的主观评价）写进 `docs/superpowers/plans/2026-08-31-plan-agent-m1.md` 末尾的「验收记录」小节并提交：

```bash
git add docs/superpowers/plans/2026-08-31-plan-agent-m1.md
git commit -m "docs(plan-agent): M1 acceptance notes"
```

---

## 自查记录（写计划时已核对）

- Spec 覆盖：M1 三项（数据模型 ✓ Task 2-6；/plan 骨架 + agent 一档 ✓ Task 7-14；IA 改造 ✓ Task 15）。M2/M3 内容（结构化组件、实体链接、导出、天气/美食）明确不在本计划。
- 类型一致性：`TripPlanRepo` 接口在 Task 3 定义，Task 4/5/9/11 全部按该签名引用；`toPlanView` 在 Task 5 定义、Task 9/14 复用；`PlanAgentEvent` 在 Task 11 定义、Task 12/14 复用（前端 `AgentEvent` 为同构本地类型，避免客户端 import 服务端模块）。
- 已知风险：`RoutePreviewMapProps` 的实际 props 名以移动后文件为准（Task 13 Step 2 强制先 grep）；Next 15 route params 的 Promise 形态以邻近路由为准（Task 6 Step 3 注明）。
