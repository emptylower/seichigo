# 计划 Agent M1 + 信息架构改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一句"帮我安排下月中旬京都京吹巡礼"能产出可保存、地图可视的多日计划（spec M1 验收线），同时完成导航语义改造（计划 | 地图 | 热门攻略 | 热门城市 | 我的）。

**Architecture:** 严格沿用本仓库领域模式——`lib/tripPlan/`（repo 接口 + Prisma/内存双实现 + deps 注入的 handlers）+ `app/api/me/plans` 薄路由；agent 是手写 OpenAI 兼容 tool-calls 循环（`createMessage` 注入以便单测），产出全部通过 `save_plan_days` 工具落到结构化 TripPlan 对象；作品简称解析走"站内库 → bgm.tv 官方 API → 问用户"三级管线，模型猜测只用于生成查询、永不直接落库。前端 `/plan` 左对话右计划，地图复用 `RoutePreviewMap`。地理聚类是本地确定性算法，LLM 只做选择与解释。

**Tech Stack:** Next.js 15 App Router、Prisma 6 (PostgreSQL)、`openai` SDK 指向 DeepSeek（`PLAN_AGENT_BASE_URL=https://api.deepseek.com`，模型 `PLAN_AGENT_MODEL=deepseek-v4-flash`，鉴权 `PLAN_AGENT_API_KEY`；三者均为环境变量，可整体切换任何 OpenAI 兼容供应商）、bgm.tv 公开搜索 API（免费、无需 key）、MapLibre（现有 `RoutePreviewMap`）、vitest（node 项目跑 `.test.ts`，jsdom 跑 `.test.tsx`）。

**DeepSeek 注意事项：** `deepseek-v4-flash` 是推理型模型，响应里带 `reasoning_content` 字段——回传历史与落库前必须剥掉（循环里只保留 `role/content/tool_calls`）；已用真实 key 验证过该模型的 function calling 可用（旧 `deepseek-chat` 别名已下线，不要使用）。

**Spec:** `docs/superpowers/specs/2026-08-31-plan-agent-ia-redesign-design.md`。本计划只覆盖 M1；M2（结构化对话组件/实体超链接/导出）、M3（天气/精选景点/美食/状态机提示）另立计划。

**对 spec 的一处简化（需用户知悉）:** spec 写的是 PlanConversation + PlanMessage 两张会话表；M1 每个计划只有一条会话，故只建 `TripPlanMessage`（挂 planId，存 OpenAI 兼容 ChatCompletionMessageParam 原文，可恢复续聊）。多会话需求出现时再加 conversation 维度。

**通用约定（每个任务都适用）:**
- 测试命令：`npx vitest run <file>`；类型检查：`npm run typecheck:app`（改了 tests 再跑 `npm run typecheck:tests`）。
- 提交信息末尾加：
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
- 所有新文件用仓库现行风格：无分号习惯跟随邻近文件、`@/` 路径别名、中文错误文案与现有 API 一致。

---

### Task 1: 安装 OpenAI 兼容 SDK

**Files:**
- Modify: `package.json`（由 npm 修改）

- [ ] **Step 1: 安装依赖**

```bash
npm install openai
```

- [ ] **Step 2: 验证安装**

```bash
node -e "import('openai').then(() => console.log('sdk ok'))"
```
Expected: 输出 `sdk ok`。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(plan-agent): add openai sdk for DeepSeek-compatible client"
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
  kind      String
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

export type TripPlanMessageKind = 'human' | 'assistant' | 'tool'

export type TripPlanMessage = {
  id: string
  planId: string
  kind: TripPlanMessageKind
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
  appendMessage(planId: string, kind: TripPlanMessageKind, content: Prisma.JsonValue): Promise<TripPlanMessage>
  listMessages(planId: string): Promise<TripPlanMessage[]>
  countHumanMessagesSince(userId: string, since: Date): Promise<number>
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
    await repo.appendMessage(plan.id, 'human', { role: 'user', content: 'hi' })
    await repo.appendMessage(plan.id, 'tool', { role: 'user', content: [] })
    await repo.appendMessage(plan.id, 'assistant', { role: 'assistant', content: [] })

    const since = new Date(Date.now() - 60_000)
    expect(await repo.countPlansCreatedSince('u1', since)).toBe(1)
    expect(await repo.countHumanMessagesSince('u1', since)).toBe(1)
    expect(await repo.countHumanMessagesSince('u2', since)).toBe(0)
    expect(await repo.listMessages(plan.id)).toHaveLength(3)
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
  TripPlanMessageKind,
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

  async appendMessage(planId: string, kind: TripPlanMessageKind, content: Prisma.JsonValue): Promise<TripPlanMessage> {
    const message: TripPlanMessage = {
      id: this.nextId('msg'),
      planId,
      kind,
      content,
      createdAt: new Date(),
    }
    this.messages.push(message)
    return message
  }

  async listMessages(planId: string): Promise<TripPlanMessage[]> {
    return this.messages.filter((m) => m.planId === planId)
  }

  async countHumanMessagesSince(userId: string, since: Date): Promise<number> {
    const planIds = new Set([...this.plans.values()].filter((p) => p.userId === userId).map((p) => p.id))
    return this.messages.filter((m) => planIds.has(m.planId) && m.kind === 'human' && m.createdAt >= since).length
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
import { Prisma as PrismaRuntime } from '@seichigo/prisma-client-runtime'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type {
  TripPlan,
  TripPlanDayInput,
  TripPlanItemType,
  TripPlanMessage,
  TripPlanMessageKind,
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
        ...(patch.preferences !== undefined ? { preferences: patch.preferences ?? PrismaRuntime.JsonNull } : {}),
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

  async appendMessage(planId: string, kind: TripPlanMessageKind, content: Prisma.JsonValue): Promise<TripPlanMessage> {
    const row = await prisma.tripPlanMessage.create({
      data: { planId, kind, content: content as Prisma.InputJsonValue },
    })
    return { id: row.id, planId: row.planId, kind: row.kind as TripPlanMessageKind, content: row.content, createdAt: row.createdAt }
  }

  async listMessages(planId: string): Promise<TripPlanMessage[]> {
    const rows = await prisma.tripPlanMessage.findMany({ where: { planId }, orderBy: { createdAt: 'asc' } })
    return rows.map((row) => ({
      id: row.id,
      planId: row.planId,
      kind: row.kind as TripPlanMessageKind,
      content: row.content,
      createdAt: row.createdAt,
    }))
  }

  async countHumanMessagesSince(userId: string, since: Date): Promise<number> {
    return prisma.tripPlanMessage.count({
      where: { kind: 'human', createdAt: { gte: since }, plan: { userId } },
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
import type { Prisma } from '@prisma/client'
import type { TripPlan, TripPlanItemType, TripPlanMessage, TripPlanStatus, TripPlanWithDays } from './repo'

export type TripPlanItemView = {
  id: string
  sortOrder: number
  type: TripPlanItemType
  pointId: string | null
  timeHint: string | null
  title: string
  note: string | null
  reason: string | null
  payload: Prisma.JsonValue | null
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
  status: TripPlanStatus
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
        payload: item.payload,
        point: item.point,
      })),
    })),
  }
}

export type ChatEntryView = { role: 'user' | 'assistant'; text: string }

export function toChatView(messages: TripPlanMessage[]): ChatEntryView[] {
  const entries: ChatEntryView[] = []
  for (const message of messages) {
    const content = message.content as { role?: string; content?: unknown } | null
    if (message.kind === 'human' && typeof content?.content === 'string') {
      entries.push({ role: 'user', text: content.content })
    } else if (message.kind === 'assistant' && typeof content?.content === 'string' && content.content) {
      entries.push({ role: 'assistant', text: content.content })
    }
  }
  return entries
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
    expect(body.chat).toEqual([])

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
import { toChatView, toPlanView } from '@/lib/tripPlan/view'
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
      const chat = toChatView(await deps.repo.listMessages(planId))
      return NextResponse.json({ plan: toPlanView(auth.plan), chat })
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

  it('is input-order independent and assigns every point exactly once', () => {
    const shuffled = [KYOTO[1], UJI[2], KYOTO[0], UJI[0], UJI[1]]
    const a = clusterIntoDays([...UJI, ...KYOTO], 2)
    const b = clusterIntoDays(shuffled, 2)
    expect(a.map((c) => [...c.pointIds].sort())).toEqual(b.map((c) => [...c.pointIds].sort()))
    const all = a.flatMap((c) => c.pointIds).sort()
    expect(all).toEqual(['daikichiyama', 'kyoto-station', 'rokujizo', 'uji-bridge', 'uji-shrine'])
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

### Task 8: 点位查询器（PointFinder）+ bgm.tv 解析

**Files:**
- Create: `lib/planAgent/points.ts`
- Create: `lib/planAgent/pointsPrisma.ts`
- Create: `lib/planAgent/bgm.ts`

- [ ] **Step 1: 写接口 `lib/planAgent/points.ts`**

```typescript
export type BangumiHit = { id: number; titleZh: string | null; titleJaRaw: string | null; city: string | null }
export type AgentPoint = { id: string; name: string; nameZh: string | null; lat: number; lng: number; ep: string | null }
export type BgmSubject = { id: number; name: string; nameCn: string }

export interface PointFinder {
  searchBangumi(query: string, limit: number): Promise<BangumiHit[]>
  countPointsByBangumi(ids: number[]): Promise<Array<{ bangumiId: number; pointCount: number }>>
  listPoints(bangumiId: number, limit: number): Promise<AgentPoint[]>
  getPointsByIds(ids: string[]): Promise<Array<{ id: string; lat: number; lng: number }>>
}
```

- [ ] **Step 1.5: 写 `lib/planAgent/bgm.ts`（bgm.tv 公开搜索，作品简称解析的第二级）**

AnitabiPoint 的 `bangumiId` 就是 bgm.tv 的 subject id，所以 bgm.tv 的搜索结果可以直接对上站内点位库。

```typescript
import type { BgmSubject } from './points'

const BGM_UA = 'seichigo/1.0 (https://seichigo.com)'

export async function searchBgmSubjects(keyword: string, limit = 5): Promise<BgmSubject[]> {
  const url = `https://api.bgm.tv/search/subject/${encodeURIComponent(keyword)}?type=2&responseGroup=small&max_results=${limit}`
  const res = await fetch(url, { headers: { 'User-Agent': BGM_UA } })
  if (!res.ok) return []
  const body = (await res.json().catch(() => null)) as {
    list?: Array<{ id?: number; name?: string; name_cn?: string }>
  } | null
  if (!body?.list) return []
  return body.list
    .filter((s) => typeof s.id === 'number')
    .map((s) => ({ id: s.id as number, name: s.name ?? '', nameCn: s.name_cn ?? '' }))
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

  async countPointsByBangumi(ids: number[]): Promise<Array<{ bangumiId: number; pointCount: number }>> {
    const rows = await prisma.anitabiPoint.groupBy({
      by: ['bangumiId'],
      where: { bangumiId: { in: ids }, geoLat: { not: null }, geoLng: { not: null } },
      _count: { _all: true },
    })
    return rows.map((r) => ({ bangumiId: r.bangumiId, pointCount: r._count._all }))
  }

  async listPoints(bangumiId: number, limit: number): Promise<AgentPoint[]> {
    const rows = await prisma.anitabiPoint.findMany({
      where: { bangumiId, geoLat: { not: null }, geoLng: { not: null } },
      select: { id: true, name: true, nameZh: true, geoLat: true, geoLng: true, ep: true },
      orderBy: [{ density: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
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
git add lib/planAgent/points.ts lib/planAgent/pointsPrisma.ts lib/planAgent/bgm.ts
git commit -m "feat(plan-agent): point finder and bgm.tv nickname resolution"
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
  async countPointsByBangumi(ids) {
    return ids.includes(115908) ? [{ bangumiId: 115908, pointCount: 3 }] : []
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
    bgmSearch: async (keyword) =>
      keyword.includes('京吹') ? [{ id: 115908, name: '響け！ユーフォニアム', nameCn: '吹响！悠风号' }] : [],
    onPlanUpdated: () => {
      updated += 1
    },
  }
  return { deps, planId: plan.id, repo }
}

describe('PLAN_AGENT_TOOLS', () => {
  it('declares the eight M1 tools', () => {
    expect(PLAN_AGENT_TOOLS.map((t) => t.function.name).sort()).toEqual([
      'cluster_points',
      'estimate_transit',
      'list_points',
      'read_plan',
      'save_plan_days',
      'search_anime',
      'search_bangumi_tv',
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

  it('search_bangumi_tv resolves nicknames and flags in-site works', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'search_bangumi_tv', { keyword: '京吹' }))
    expect(out.candidates[0].id).toBe(115908)
    expect(out.candidates[0].hasPoints).toBe(true)
    expect(out.candidates[0].pointCount).toBe(3)

    const miss = JSON.parse(await executePlanTool(deps, 'search_bangumi_tv', { keyword: '完全未知作品' }))
    expect(miss.candidates).toEqual([])
    expect(miss.hint).toBeTruthy()
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

  it('estimate_transit suggests mode and minutes between two points', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'estimate_transit', { fromPointId: 'p-uji-bridge', toPointId: 'p-kyoto-sta' }),
    )
    expect(out.mode).toBe('transit')
    expect(out.durationMin).toBeGreaterThan(10)

    const walk = JSON.parse(
      await executePlanTool(deps, 'estimate_transit', { fromPointId: 'p-uji-bridge', toPointId: 'p-daikichi' }),
    )
    expect(walk.mode).toBe('walk')
  })

  it('save_plan_days rejects point items without pointId and normalizes day indexes', async () => {
    const { deps, repo, planId } = await makeDeps()
    const bad = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', title: '没有点位 id' }] }],
      }),
    )
    expect(bad.error).toBeTruthy()

    await executePlanTool(deps, 'save_plan_days', {
      days: [
        { dayIndex: 5, items: [{ type: 'free', title: 'b' }] },
        { dayIndex: 2, items: [{ type: 'free', title: 'a' }] },
      ],
    })
    const plan = await repo.getPlan(planId)
    expect(plan?.days.map((d) => d.dayIndex)).toEqual([1, 2])
    expect(plan?.days[0].items[0].title).toBe('a')
  })

  it('update_plan_meta rejects invalid dates', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'update_plan_meta', { startDate: 'not-a-date' }))
    expect(out.error).toBeTruthy()
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
import type OpenAI from 'openai'
import { clusterIntoDays, haversineKm } from './cluster'
import type { BgmSubject, PointFinder } from './points'
import { TRIP_PLAN_ITEM_TYPES, type TripPlanDayInput, type TripPlanItemType, type TripPlanRepo } from '@/lib/tripPlan/repo'
import { toPlanView } from '@/lib/tripPlan/view'

export type PlanAgentToolDeps = {
  planId: string
  repo: TripPlanRepo
  points: PointFinder
  bgmSearch?: (keyword: string) => Promise<BgmSubject[]>
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

function tool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): OpenAI.Chat.Completions.ChatCompletionTool {
  return { type: 'function', function: { name, description, parameters } }
}

export const PLAN_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  tool('search_anime', '按作品名（中文或日文，支持部分匹配）在站内点位库搜索圣地巡礼作品，返回 bangumiId。规划前必须先用它确定作品。', {
    type: 'object',
    properties: { query: { type: 'string', description: '作品名关键词，如“上低音号”' } },
    required: ['query'],
  }),
  tool('search_bangumi_tv', '站内搜不到时，用 Bangumi(bgm.tv) 官方数据库解析作品简称/别名，返回候选作品及其是否在站内有点位（hasPoints）。仍不确定时把候选列给用户确认，绝不自行断定。', {
    type: 'object',
    properties: { keyword: { type: 'string', description: '用户的原话说法，或你猜测的正式名称' } },
    required: ['keyword'],
  }),
  tool('list_points', '列出某作品的全部有坐标巡礼点位（含中文名、经纬度、出现集数）。', {
    type: 'object',
    properties: {
      bangumiId: { type: 'number', description: 'search_anime 返回的作品 id' },
      limit: { type: 'number', description: '最多返回条数，默认 60' },
    },
    required: ['bangumiId'],
  }),
  tool('cluster_points', '把一组点位按地理位置聚成 N 天，并给出每天内的顺路访问顺序。这是确定性算法，排天分组必须用它，不要自己凭感觉分。', {
    type: 'object',
    properties: {
      pointIds: { type: 'array', items: { type: 'string' }, description: '要安排的点位 id 列表' },
      dayCount: { type: 'number', description: '巡礼天数' },
    },
    required: ['pointIds', 'dayCount'],
  }),
  tool('estimate_transit', '估算两个点位之间的交通方式与耗时（本地启发式：≤1.5km 步行，其余公共交通）。写 transit 条目前必须用它，不要自己猜数字。', {
    type: 'object',
    properties: {
      fromPointId: { type: 'string' },
      toPointId: { type: 'string' },
    },
    required: ['fromPointId', 'toPointId'],
  }),
  tool('read_plan', '读取当前计划的完整结构（标题、天数、每日条目）。', { type: 'object', properties: {} }),
  tool('update_plan_meta', '更新计划元信息：标题、总天数、出发日期（ISO 日期字符串）、关联作品 id。', {
    type: 'object',
    properties: {
      title: { type: 'string' },
      dayCount: { type: 'number' },
      startDate: { type: 'string', description: 'ISO 日期，如 2026-09-15；传空字符串清除' },
      bangumiIds: { type: 'array', items: { type: 'number' } },
    },
  }),
  tool('save_plan_days', '整体保存每日行程（覆盖旧内容）。每天是一个按访问顺序排列的条目时间线：point 条目挂 pointId，点位之间插入 transit 条目说明交通方式。每个安排都写 reason。这是计划的唯一落库方式，规划结果必须通过它保存。', {
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
  }),
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
      case 'search_bangumi_tv': {
        const keyword = String(args.keyword ?? '').trim()
        if (!keyword) return JSON.stringify({ error: 'keyword 不能为空' })
        if (!deps.bgmSearch) return JSON.stringify({ error: 'bgm.tv 搜索当前不可用，请向用户询问作品官方名称' })
        const subjects = await deps.bgmSearch(keyword)
        if (!subjects.length) {
          return JSON.stringify({ candidates: [], hint: '未找到候选，请向用户询问作品官方名称，不要猜测' })
        }
        const counts = await deps.points.countPointsByBangumi(subjects.map((s) => s.id))
        const countById = new Map(counts.map((c) => [c.bangumiId, c.pointCount]))
        return JSON.stringify({
          candidates: subjects.map((s) => {
            const pointCount = countById.get(s.id) ?? 0
            return { ...s, pointCount, hasPoints: pointCount > 0 }
          }),
        })
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
      case 'estimate_transit': {
        const fromId = String(args.fromPointId ?? '')
        const toId = String(args.toPointId ?? '')
        const coords = await deps.points.getPointsByIds([fromId, toId])
        const from = coords.find((p) => p.id === fromId)
        const to = coords.find((p) => p.id === toId)
        if (!from || !to) return JSON.stringify({ error: '点位不存在或缺少坐标' })
        const km = haversineKm(from, to)
        const mode = km <= 1.5 ? 'walk' : 'transit'
        const durationMin =
          mode === 'walk' ? Math.max(3, Math.round((km / 4.5) * 60)) : Math.max(10, Math.round((km / 25) * 60) + 12)
        return JSON.stringify({ distanceKm: Math.round(km * 10) / 10, mode, durationMin })
      }
      case 'read_plan': {
        const plan = await deps.repo.getPlan(deps.planId)
        if (!plan) return JSON.stringify({ error: '计划不存在' })
        return JSON.stringify({ plan: toPlanView(plan) })
      }
      case 'update_plan_meta': {
        const patch: Parameters<TripPlanRepo['updateMeta']>[1] = {}
        if (typeof args.title === 'string' && args.title.trim()) patch.title = args.title.trim().slice(0, 80)
        if (Number.isFinite(Number(args.dayCount))) patch.dayCount = Math.min(30, Math.max(1, Math.floor(Number(args.dayCount))))
        if (typeof args.startDate === 'string') {
          if (!args.startDate.trim()) {
            patch.startDate = null
          } else {
            const parsed = new Date(args.startDate)
            if (Number.isNaN(parsed.getTime())) return JSON.stringify({ error: 'startDate 不是合法日期' })
            patch.startDate = parsed
          }
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
        if (days.length > 30) return JSON.stringify({ error: '天数过多（上限 30）' })
        for (const day of days) {
          if (day.items.length > 30) return JSON.stringify({ error: `Day ${day.dayIndex} 条目过多（上限 30）` })
          for (const item of day.items) {
            if (item.type === 'point' && !item.pointId) {
              return JSON.stringify({ error: 'point 条目必须带 pointId（来自 list_points）' })
            }
          }
        }
        days.sort((a, b) => a.dayIndex - b.dayIndex)
        days.forEach((day, i) => {
          day.dayIndex = i + 1
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
1. 确定作品：先用 search_anime 在站内搜；搜不到再用 search_bangumi_tv 解析简称/别名。你对简称的理解只能用来生成查询关键词，不能作为结论。两个工具都不确定时，把候选列给用户选，或请用户提供官方名称——绝不自行断定，绝不编造。
2. 用 list_points 拉取该作品的真实点位。你只能使用这些点位，绝不虚构任何巡礼点位。若 search_bangumi_tv 的候选 hasPoints 为 false，如实告诉用户站内暂无该作品点位。
3. 若用户没说清天数或日期，先用一句话问清（一次只问一个问题）。
4. 用 cluster_points 做按天分组和顺路排序，以它的结果为准安排每天的点位顺序。
5. 用 update_plan_meta 写入标题、天数、出发日期和作品 id；用 save_plan_days 保存每日行程。规划结果必须落到这两个工具里，只写在聊天文字里等于没做。
6. 保存后用简短的文字向用户总结：每天去哪、为什么这么排、有什么注意事项。

## 行程编排规则
- 每天条目按访问顺序排列；相邻点位间隔较远时插入 transit 条目。交通方式与耗时必须用 estimate_transit 估算，不要自己猜数字。
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
import type OpenAI from 'openai'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import type { PointFinder } from '@/lib/planAgent/points'

const finder: PointFinder = {
  async searchBangumi() {
    return [{ id: 115908, titleZh: '吹响吧！上低音号', titleJaRaw: null, city: '宇治' }]
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return [{ id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, ep: '1' }]
  },
  async getPointsByIds() {
    return [{ id: 'p1', lat: 34.8892, lng: 135.8075 }]
  },
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessage

function assistantMessage(partial: Partial<ChatMessage>): ChatMessage {
  return { role: 'assistant', content: null, refusal: null, ...partial } as ChatMessage
}

describe('runPlanAgent', () => {
  it('executes tool calls, persists messages, and emits events', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: ChatMessage[] = [
      assistantMessage({
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'save_plan_days',
              arguments: JSON.stringify({
                days: [{ dayIndex: 1, items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }] }],
              }),
            },
          },
        ] as ChatMessage['tool_calls'],
      }),
      assistantMessage({ content: '安排好了！Day1 去宇治桥。' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

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
    expect(persisted.map((m) => m.kind)).toEqual(['human', 'assistant', 'tool', 'assistant'])
  })

  it('stops at maxIterations and still emits done', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async () =>
      assistantMessage({
        tool_calls: [
          { id: 'call_x', type: 'function', function: { name: 'read_plan', arguments: '{}' } },
        ] as ChatMessage['tool_calls'],
      }),
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
import type OpenAI from 'openai'
import type { Prisma } from '@prisma/client'
import { executePlanTool, PLAN_AGENT_TOOLS, type PlanAgentToolDeps } from './tools'
import { PLAN_AGENT_SYSTEM_PROMPT } from './prompt'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'

export type PlanAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'plan_updated' }
  | { type: 'done' }
  | { type: 'error'; message: string }

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam

export type CreateMessageFn = (params: {
  messages: ChatMessageParam[]
  tools: OpenAI.Chat.Completions.ChatCompletionTool[]
}) => Promise<OpenAI.Chat.Completions.ChatCompletionMessage>

export type PlanAgentDeps = {
  createMessage: CreateMessageFn
  repo: TripPlanRepo
  planId: string
  toolDeps: PlanAgentToolDeps
  maxIterations?: number
  signal?: AbortSignal
}

const DEFAULT_MAX_ITERATIONS = 12

function isChatMessage(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'role' in value
}

export async function runPlanAgent(
  deps: PlanAgentDeps,
  userMessage: string,
  onEvent: (event: PlanAgentEvent) => void,
): Promise<void> {
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS

  const history = await deps.repo.listMessages(deps.planId)
  const messages: ChatMessageParam[] = [
    { role: 'system', content: PLAN_AGENT_SYSTEM_PROMPT },
    ...history
      .map((m) => m.content)
      .filter(isChatMessage)
      .map((m) => m as unknown as ChatMessageParam),
  ]

  const userParam: ChatMessageParam = { role: 'user', content: userMessage }
  messages.push(userParam)
  await deps.repo.appendMessage(deps.planId, 'human', userParam as unknown as Prisma.JsonValue)

  const toolDeps: PlanAgentToolDeps = {
    ...deps.toolDeps,
    onPlanUpdated: () => {
      deps.toolDeps.onPlanUpdated?.()
      onEvent({ type: 'plan_updated' })
    },
  }

  try {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (deps.signal?.aborted) break
      const response = await deps.createMessage({ messages, tools: PLAN_AGENT_TOOLS })

      if (typeof response.content === 'string' && response.content) {
        onEvent({ type: 'text', text: response.content })
      }

      // DeepSeek 推理模型响应带 reasoning_content，回传历史与落库前只保留协议字段
      const assistantParam = {
        role: 'assistant' as const,
        content: response.content ?? null,
        ...(response.tool_calls?.length ? { tool_calls: response.tool_calls } : {}),
      }
      messages.push(assistantParam as ChatMessageParam)
      await deps.repo.appendMessage(deps.planId, 'assistant', assistantParam as unknown as Prisma.JsonValue)

      const toolCalls = response.tool_calls ?? []
      if (!toolCalls.length) break

      for (const call of toolCalls) {
        if (call.type !== 'function') continue
        let input: unknown = {}
        try {
          input = JSON.parse(call.function.arguments || '{}')
        } catch {
          input = {}
        }
        const result = await executePlanTool(toolDeps, call.function.name, input)
        const toolParam: ChatMessageParam = { role: 'tool', tool_call_id: call.id, content: result }
        messages.push(toolParam)
        await deps.repo.appendMessage(deps.planId, 'tool', toolParam as unknown as Prisma.JsonValue)
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    onEvent({ type: 'error', message })
  }

  onEvent({ type: 'done' })
}
```

注意：openai SDK 新版本的 `tool_calls` 联合类型含 `custom` 变体，`call.type !== 'function'` 的守卫必须保留；若类型收窄报错，以安装版本的实际类型名为准调整（例如 `ChatCompletionMessageToolCall`）。

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
import OpenAI from 'openai'
import type { CreateMessageFn } from './loop'

const MODEL = process.env.PLAN_AGENT_MODEL || 'deepseek-v4-flash'
const BASE_URL = process.env.PLAN_AGENT_BASE_URL || 'https://api.deepseek.com'

let cachedClient: OpenAI | null = null

function getClient(): OpenAI {
  if (!cachedClient) {
    if (!process.env.PLAN_AGENT_API_KEY) {
      throw new Error('PLAN_AGENT_API_KEY 未配置')
    }
    cachedClient = new OpenAI({ apiKey: process.env.PLAN_AGENT_API_KEY, baseURL: BASE_URL })
  }
  return cachedClient
}

export const createChatCompletion: CreateMessageFn = async ({ messages, tools }) => {
  const completion = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 8000,
    messages,
    tools,
  })
  const message = completion.choices[0]?.message
  if (!message) throw new Error('模型未返回消息')
  return message
}
```

- [ ] **Step 2: 写 `app/api/me/plans/[id]/agent/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { startOfToday } from '@/lib/tripPlan/handlers/plans'
import { createChatCompletion } from '@/lib/planAgent/api'
import { searchBgmSubjects } from '@/lib/planAgent/bgm'
import { runPlanAgent, type PlanAgentEvent } from '@/lib/planAgent/loop'
import { PrismaPointFinder } from '@/lib/planAgent/pointsPrisma'

export const runtime = 'nodejs'

const DAILY_MESSAGE_LIMIT = 20

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const deps = await getTripPlanApiDeps()

  const session = await deps.getSession()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const plan = await deps.repo.getPlan(id)
  if (!plan) return NextResponse.json({ error: '计划不存在' }, { status: 404 })
  if (plan.userId !== userId) return NextResponse.json({ error: '无权访问' }, { status: 403 })

  const used = await deps.repo.countHumanMessagesSince(userId, startOfToday())
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
  const abort = new AbortController()
  req.signal.addEventListener('abort', () => abort.abort())

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PlanAgentEvent | { type: 'ready' }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // 客户端已断开，enqueue 会抛错；agent 循环会在下一轮 signal 检查时停下
        }
      }
      send({ type: 'ready' })
      try {
        await runPlanAgent(
          {
            createMessage: createChatCompletion,
            repo: deps.repo,
            planId: id,
            toolDeps: {
              planId: id,
              repo: deps.repo,
              points: new PrismaPointFinder(),
              bgmSearch: searchBgmSubjects,
            },
            signal: abort.signal,
          },
          message,
          send,
        )
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : '服务器错误' })
        send({ type: 'done' })
      }
      try {
        controller.close()
      } catch {
        // 已被 cancel
      }
    },
    cancel() {
      abort.abort()
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

- [ ] **Step 4: 在 `.env.local` 确认环境变量（不提交）**

`.env.local` 需要三个变量（本 worktree 已配好，只需确认存在）：`PLAN_AGENT_API_KEY`（DeepSeek key）、`PLAN_AGENT_BASE_URL=https://api.deepseek.com`、`PLAN_AGENT_MODEL=deepseek-v4-flash`。缺失时提醒用户提供，不要自己造。

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

（已核实：`RoutePreviewMap` 是命名导出——`export function RoutePreviewMap(...)`，统一用上面的命名导入。）

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
          payload: null,
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
          payload: null,
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
import { toChatView, toPlanView } from '@/lib/tripPlan/view'
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

  const chat = toChatView(await deps.repo.listMessages(id))
  return <PlanPlanner planId={id} initialPlan={toPlanView(plan)} initialChat={chat} />
}
```

- [ ] **Step 7: 实现 `app/(authed)/plan/[id]/ui.tsx`（对话 + SSE + 日程 + 地图联动）**

```tsx
'use client'

import { useMemo, useRef, useState } from 'react'
import { RoutePreviewMap } from '@/components/route/RoutePreviewMap'
import type { TripPlanView } from '@/lib/tripPlan/view'
import { DayCards } from './components/DayCards'

type ChatEntry = { role: 'user' | 'assistant'; text: string }
type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'plan_updated' }
  | { type: 'done' }
  | { type: 'error'; message: string }

export function PlanPlanner(props: { planId: string; initialPlan: TripPlanView; initialChat: ChatEntry[] }) {
  const [plan, setPlan] = useState(props.initialPlan)
  const [chat, setChat] = useState<ChatEntry[]>(props.initialChat)
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

（`RoutePreviewMap` 已确认是命名导出，见 Task 13。）

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
- Modify: `components/layout/prefixPath.ts`（`/plan` 加入非本地化前缀）
- Modify: `components/layout/Header.tsx`、`components/layout/HeaderPublic.tsx`、`components/layout/HeaderMobileDrawer.client.tsx`、`components/layout/HeaderAuthControls.client.tsx`
- Create: `app/(authed)/me/page.tsx`（复用 `components/me/MeSectionShell.tsx` 的导航惯例）

范围注记（已在 spec 变更记录确认）：「热门攻略」v1 指向 `/`——首页即攻略列表，已含热门内容与作品二级入口；独立 `/posts` 索引页与"按作品切换视图"属于 M2，本任务不做。

- [ ] **Step 1: i18n 文案**

`zh.json` 的 `header` 块：`posts` 值改为 `"热门攻略"`，`city` 值改为 `"热门城市"`，新增 `"plan": "计划"`、`"me": "我的"`。保留 `anime`/`resources`/`submit` 键（页面内仍在用）。

`en.json` 对应：`posts` → `"Top Guides"`，`city` → `"Top Cities"`，新增 `"plan": "Plan"`、`"me": "Me"`。

`ja.json` 对应：`posts` → `"人気ガイド"`，`city` → `"人気都市"`，新增 `"plan": "計画"`、`"me": "マイページ"`。

- [ ] **Step 2: 非本地化路由 + 桌面导航**

先打开 `components/layout/prefixPath.ts`，在 `NON_LOCALIZED_PREFIXES` 数组中加入 `'/plan'`（与 `/me` 同类：登录后功能页不做 locale 前缀）。否则 en/ja 下 `prefixPath('/plan', locale)` 会生成不存在的 `/en/plan`。

然后把 `components/layout/Header.tsx` 第 42-47 行的导航链接列表替换为（保留 admin 条件行不动）：

```tsx
          <Link href={prefixPath('/plan', locale)} className="hover:text-brand-600">{t('header.plan', locale)}</Link>
          <Link href={prefixPath('/map', locale)} className="hover:text-brand-600">{t('header.map', locale)}</Link>
          <Link href={prefixPath('/', locale)} className="hover:text-brand-600">{t('header.posts', locale)}</Link>
          <Link href={prefixPath('/city', locale)} className="hover:text-brand-600">{t('header.city', locale)}</Link>
          <Link href={prefixPath('/me', locale)} className="hover:text-brand-600">{t('header.me', locale)}</Link>
```

目标 IA 是五个一级入口（计划/地图/热门攻略/热门城市/我的），「我的」是一级导航项而不是藏在下拉里；未登录用户点击 `/me` 由页面重定向到登录。用户下拉菜单里现有 `/me/favorites` 链接保留。

- [ ] **Step 3: 同步 `HeaderPublic.tsx`、`HeaderMobileDrawer.client.tsx` 与 `HeaderAuthControls.client.tsx`**

打开这三个文件：
- `HeaderPublic.tsx` 与 `HeaderMobileDrawer.client.tsx`：找到与 Header.tsx 相同的导航链接列表，替换为 Step 2 的同一组五条链接（plan/map/posts/city/me，样式类名沿用各自文件原有的）。移动抽屉里额外保留 `resources` 与 `submit` 两条原有链接（移动端是这两个功能仅剩的入口），并新增 `plan` 在最上方。
- `HeaderAuthControls.client.tsx`：HeaderPublic 的账号入口实际由它渲染。检查其链接与 label 类型定义，把「我的收藏」入口补充/调整为指向 `/me` 的「我的」入口（保留收藏直达也可，但必须有 `/me`），涉及的 label 类型同步更新。

- [ ] **Step 4: 新建 `/me` 聚合页 `app/(authed)/me/page.tsx`**

先读 `components/me/MeSectionShell.tsx`——favorites/routebooks/settings 页共用这个 shell 导航。若 shell 内有 section 注册表，把「我的计划（/plan）」登记进去，保持子页导航一致；聚合页本身用下面的卡片实现（不套 shell，作为 /me 的落地页）：

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
若有断言旧导航文案（"首页"/"作品"/"城市"）的测试失败，把断言更新为新文案/新链接结构；不要为通过测试回退产品改动。另外为三种 locale 各加一条导航解析断言：`prefixPath('/plan', 'en')` 与 `prefixPath('/plan', 'ja')` 必须解析为 `/plan`（非本地化），防止回归。

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
Expected: 全部通过（lint 脚本自带 `|| true`，必须逐行看输出，不能只看退出码）。

- [ ] **Step 1.5: Cloudflare Worker 构建门禁**

```bash
npm run cf:build
```
Expected: OpenNext 构建成功。本仓库有 Worker 专用 Prisma loader 与 OpenNext 配置，普通 `next build` 验证不了 Worker 打包（`openai` SDK、SSE 流、`@seichigo/prisma-client-runtime` 条件导出都要过这一关）。有条件的话再跑 `npm run cf:preview` 做一次 SSE 冒烟（登录 → 发一条消息 → 确认 `data:` 帧逐段到达）。

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

## Codex 评审修订记录（2026-08-31）

Codex（gpt-5.6-sol）评审结论 CHANGES REQUIRED，20 条发现。逐条处置：

**已采纳并修入本计划：**
- 消息表 `role` 改为 `kind`（human/assistant/tool），配额只数 `kind='human'`——修复"工具回执被计入用户配额"（原 #5）；单日人类消息上限相应调为 20。
- `repoPrisma` 的 `Prisma.JsonNull` 改从 `@seichigo/prisma-client-runtime` 取值导入（编译级 BLOCKER，原 #2）。
- `/plan` 加入 `prefixPath.ts` 的 `NON_LOCALIZED_PREFIXES`，en/ja 导航不再指向不存在的 `/en/plan`（BLOCKER，原 #3），并加 locale 解析断言。
- 新增 `estimate_transit` 本地启发式工具，交通耗时不再由 LLM 猜数字（原 #7 的 M1 版本；真实 Directions 接入移 M2，spec 已加变更记录）。
- `save_plan_days`/`update_plan_meta` 输入硬化：非法日期拒绝、dayIndex 排序重编号、天数/条目上限 30、point 条目必须带 pointId（原 #8 核心项）。
- SSE 路由：`ready` 首帧、`req.signal`→AbortController→循环逐轮检查、`cancel()` 处理（原 #10 核心项）。
- 五个一级导航含「我的」；`HeaderAuthControls.client.tsx` 与 `MeSectionShell` 纳入 Task 15（原 #11）。
- 会话水合：GET 计划返回 `chat` 视图，规划器用 `initialChat` 初始化，刷新不丢对话（原 #12）。
- `listPoints` 按 `density desc nulls last, id asc` 确定性排序（原 #13 核心项）。
- `RoutePreviewMap` 统一命名导入（原 #14）。
- Task 16 增加 `npm run cf:build` 门禁与 cf:preview SSE 冒烟（原 #15）。
- 视图保留 `payload`、`status/type` 用共享联合类型（原 #16）；聚类测试加输入顺序无关与全点位覆盖断言、循环测试断言精确消息 kind 序列（原 #18 部分）；SDK 安装验证改用 `import()`（原 #19）。
- spec 状态改为已批准并补变更记录（原 #20）。

**明确不采纳（附理由）：**
- 原 #1"`claude-opus-5` 不是有效模型"：误报。Claude 5 家族（Opus 5 等）晚于评审模型的知识截点，`claude-opus-5` 是当前有效模型 ID；`PLAN_AGENT_MODEL` 环境变量保留作逃生门。
- 原 #4"/posts 独立索引页缺失"：改为 spec 范围修订——「热门攻略」v1 指向 `/`（首页即攻略列表），独立 /posts 与按作品切换视图移入 M2（spec 变更记录已载明，用户批准 spec 时的口径以变更记录为准）。
- 原 #6"配额原子化/竞态"：M1 接受 count→create 竞态（个人站流量级别，攻击面小；循环上限 12 轮 + max_tokens 8000 已兜成本）。原子化用量表列入 M2 待办。时区按 UTC 记账，文案不承诺自然日语义。
- 原 #9"replaceDays 乐观并发"：M1 单用户单计划串行使用为主，接受最后写入胜出；乐观并发（expectedUpdatedAt）列入 M2 待办。
- 原 #17"Postgres 契约测试/路由集成测试"：M1 以内存仓库契约 + cf:build + 手工走查覆盖，Postgres 契约套件列入 M2 待办（需要测试数据库基建，不在本期）。

## DeepSeek 供应商切换修订（2026-08-31，用户决策）

用户决定不用 Claude/GPT（成本 10-30 倍），改用 DeepSeek。本次修订：

- **SDK 换为 `openai`**（Task 1），客户端指向 `PLAN_AGENT_BASE_URL`（默认 `https://api.deepseek.com`），模型 `PLAN_AGENT_MODEL`（默认 `deepseek-v4-flash`），鉴权 `PLAN_AGENT_API_KEY`——三个环境变量整体可换任何 OpenAI 兼容供应商（Kimi/Qwen/GLM）。已用真实 key 验证 `deepseek-v4-flash` 的 function calling 可用；旧 `deepseek-chat` 别名已下线。
- **循环与消息持久化改为 OpenAI Chat Completions 协议**（Task 11/12）：assistant 带 `tool_calls`，工具回执是独立的 `role:'tool'` 消息（每条 kind='tool' 单独落库）；`reasoning_content` 在回传与落库前剥掉；system prompt 由循环注入为首条消息。
- **作品简称解析三级管线**（Task 8/9/10）：站内 `search_anime` → 新增 `search_bangumi_tv` 工具（bgm.tv 公开搜索 API，免费无 key，subject id 与 AnitabiPoint.bangumiId 同源，返回候选并标注 hasPoints）→ 仍不确定则要求用户确认官方名称。提示词明确"模型的简称理解只用于生成查询关键词，不得作为结论"——幻觉在结构上无害化，这是选用低价模型的前提。
- `toChatView` 适配字符串 content（Task 5）。

## 验收记录（2026-08-31，Task 16）

**自动化验证（Step 1 / 1.5）**
- `npm test`：254 文件全过，1702 passed / 2 skipped。`tests/map/firstViewCanary.test.ts` 初次失败系 worktree 缺未入库的 `.omx/specs/canary-map-first-view-slots.md`（从主 checkout 补齐后通过，该文件本就不进 git）。
- `npm run typecheck`：app + tests 均干净。
- `npm run lint`：**空转**——`eslint` 不在依赖里（主 checkout 同样如此，脚本靠 `|| true` 掩盖，属全仓预存状况）。建议后续单独补 eslint 依赖与配置。
- `npm run cf:build`：OpenNext Worker 打包成功（`openai` SDK、SSE 路由、prisma-client-runtime 条件导出均过关）。

**数据库修正（验收中发现并处理）**
- glm 的迁移只应用到了 `.env` 指向的本地 Postgres；而运行时（Next 优先读 `.env.local`）用的是 Neon 云库，缺 `TripPlan` 等 4 表。Neon 迁移账本本身干净齐平（无本地库那些 drift），已用标准 `prisma migrate deploy` 补应用 `20260831000000_add_trip_plan`，核验 `AnitabiPoint` 47,015 行无损、`TripPlan` 可用。
- 本地库的迁移史欠账（ghost 迁移、RouteBook 等表不在迁移史）仍属预存问题，待单独 baseline 修复。

**真实链路验收（Step 2，脚本化，真 Neon + 真 DeepSeek v4-flash + 真 bgm.tv）**
- 三轮对话驱动 `runPlanAgent`（临时脚本跑完即删）：
  1. 「帮我安排 3 天京都京吹圣地巡礼」→ agent 正确解析「京吹」为吹响吧！上低音号系列（站内 6 部作品），如实报点位规模，**主动向用户确认以哪一季为核心与出发日期**，不自行猜测——符合低幻觉设计。
  2. 「选 A（TV 第一季）、9/15 出发」→ 聚类分 3 天、逐段 `estimate_transit`、`save_plan_days` 落库：3 天 35 个真实点位，每条 point 带 reason（含集数出处），外地点位（名古屋/东京）正确剔除，Day1 市区轻量 → Day2 木幡/莵道 → Day3 宇治精华的编排合理。
  3. 「第一天太赶了，减少两个点」→ Day1 从 4 点减为 2 点并重新落库（断言 day1After < day1Before 通过），保留/砍点的取舍有解释。
- 事件流含 `ready`（HTTP 层）、`text`/`plan_updated`/`done` 序列正常；消息按 human/assistant/tool 分 kind 落库，刷新可水合。
- 未登录访问 `/plan` → 307 跳 `/auth/signin?callbackUrl=/plan` ✓；首页导航渲染出 计划/热门攻略/热门城市 与 `/plan`、`/me` 链接 ✓。

**主观质量评价**：输出编排、点位取舍与巡礼常识（莵道高不入校、大吉山备水、末班公交提醒）超出 M1 预期；`deepseek-v4-flash` 的 function calling 与中文表达质量满足上线要求。

**小瑕疵（不阻塞，记入 M2 待办）**
- agent 首次调用 `cluster_points` 传了短 id 导致空结果，自行用完整点位 id 重试成功——`cluster_points` 的参数描述可强调「必须用 list_points 返回的完整 id」。
- agent 口播的「60 个点位」是 `list_points` 默认 limit=60（按 density 取前 60），非全量数；如需展示总量可在工具回执附 totalCount。
- 浏览器端人工走查（UI 建计划、429 文案展示、/me 聚合页视觉、路书地图渲染）未做——逻辑均有单测覆盖（配额、DayCards、RoutePreviewMap 迁移后 102 项路书测试全绿），建议上线前人工点一遍。

**验收后修复（2026-08-31，Codex stop-time review）**
- 消息配额竞态修复：原实现 count→429→跑 agent，人类消息到循环里才落库，N 个并发请求可同时通过检查并发烧模型额度。改为 `TripPlanRepo.appendHumanMessageIfWithinQuota`——配额检查与人类消息落库在同一事务，Prisma 版用 `pg_advisory_xact_lock(hashtext(userId))` 按用户串行化（READ COMMITTED 下 insert+count 互不可见，必须加锁；lock 函数返回 void 需 `::text` 强转；事务 maxWait 放宽到 10s 让排队请求拿到干净 429）。`runPlanAgent` 增加 `userMessagePersisted` 跳过重复落库。已在真实 Neon 上验证：5 并发 vs limit=2，恰好 2 成功 3 拒绝，零报错。
- 计划创建配额（每日 3 个）的同类竞态仍按 M1 决策保留——创建空计划不消耗模型额度，原子化随 M2 用量表一并处理。

**验收后修复二（2026-08-31，Codex stop-time review）**
- 同计划并发消息串线修复：修好配额竞态后，同一计划仍可被并发请求同时驱动两个 `runPlanAgent` 循环，交错写同一份对话历史——既可能把 A 的回复插进 B 的对话，交错的 assistant/tool_calls 也会破坏 OpenAI 协议顺序，导致该计划后续每次调用都 400。修复：
  - `TripPlan` 加 `agentBusyUntil` 列（迁移 `20260831010000_add_trip_plan_agent_busy`），`appendHumanMessageIfWithinQuota` 升级为 `beginAgentRun`/`endAgentRun`：配额检查、按计划的互斥抢占（条件 `updateMany`）、人类消息落库三者在同一事务原子完成；`endAgentRun` 放在路由的 `finally` 里保证进程正常退出必释放。busy 位带 10 分钟 TTL，进程崩溃未清锁时到期自动可接管（真实 Neon 验证：故意设负 TTL 模拟崩溃后可立即被下一请求接管）。
  - 并发请求打到忙碌计划时返回 `409`（"这个计划正在规划中，等当前回复完成后再发送"），区别于配额耗尽的 `429`。
  - `sanitizeChatHistory`（`lib/planAgent/loop.ts`）在每次回放历史前清理悬空 `tool_calls`（配对回执缺失）与孤儿 `tool` 回执——即便未来出现其它导致历史交错/截断的路径（如手工改库、旧版本遗留脏数据），计划也不会永久卡死在 400。
  - 真实 Neon 验证：5 并发请求打同一计划，恰好 1 个 `ok`、4 个 `busy`；释放后可继续；配额检查照常在互斥之外独立生效。
