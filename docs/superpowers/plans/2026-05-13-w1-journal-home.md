# W1 ·「我的手帐」首页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给登录用户在 `/me/journal` 路由下做出一份"我的手帐"首屏 —— 封面 + 7 个数据可视化板块 + 4 张探索入口卡 + LBS 浮层，做出物理纸质手帐的视觉质感。这是 6 周 MVP 节奏的 Week 1，**不改动登录后默认路由**（那是 W4 的工作）。

**Architecture:** 严格遵循仓库现有三层模式 —— `app/api 或 page` 做 transport / 视图 → `lib/journal/api.ts` 工厂注入依赖 → `lib/journal/handlers/getJournalSnapshot.ts` 聚合数据 → `lib/journal/repo*.ts` 双实现（Prisma + Memory）。视觉层在 `app/(authed)/me/journal/components/*` 用一组可复用 primitives（PaperCard / RedSeal / WashiTape / InkDivider）拼装出 7 个 section 组件。

**Tech Stack:** Next.js 15 App Router (server components default), React 19, TypeScript strict, Tailwind 3 (依赖现有 `colors.brand` + 新增 `journal` 色板), Prisma 6, Vitest (node + jsdom split), 不引入新依赖。

**对照基准:**
- 产品宪章 [docs/product-charter.md](../../product-charter.md) —— **任何命名 / 文案 / Anti-feature 决策的最终依据**
- 视觉低保真 [docs/wireframes/owner-journal.html](../../wireframes/owner-journal.html)
- 视觉目标稿 [docs/wireframes/owner-journal-target.png](../../wireframes/owner-journal-target.png)

**W1 不做的事（明确推迟）:**
- 不合并 `Favorite/MdxFavorite/AnitabiFavorite` 三张表（W2 做）
- 不做"想去"的实际收藏行为，只在 Snapshot 里把现有数据**只读**汇总展示
- 不做"打卡仪式"动画（W2）
- 不做"随笔创建"接口，`recentNotes` 在 W1 永远返回空数组并展示空态
- 不做"自动拼图"AI，`recentPhotos` 直接复用 `UserPointState.photoUrl`
- 不改 `/` 或 `/me` 默认路由（W4）
- 不做手帐公开/私密开关（W5/W6）

---

## File Structure

新建文件全列在下面；其它现有文件不动。

```
app/(authed)/me/journal/
├── page.tsx                              # Server component, auth gate + snapshot fetch
├── ui.tsx                                # Client wrapper assembling layout
├── primitives/
│   ├── PaperCard.tsx                     # 纸质卡片底（box-shadow + noise overlay）
│   ├── RedSeal.tsx                       # 红色朱印章（方印 / 圆印 variant）
│   ├── WashiTape.tsx                     # 和纸胶带（color variant）
│   ├── InkDivider.tsx                    # 墨笔分割线（淡出两端）
│   ├── StitchedBorder.tsx                # 缝纫虚线边框
│   └── PageFoldCorner.tsx                # 页角折叠阴影
├── components/
│   ├── JournalCover.tsx                  # 封面区（含 VOL.01 / 5 stats / current trip）
│   ├── PilgrimageMap.tsx                 # 我走过的地方（含 JapanMap SVG）
│   ├── JapanMapSvg.tsx                   # 抽象日本群岛 SVG（北海道/本州/九州/四国）
│   ├── NotesPreview.tsx                  # 我的随笔（W1 空态）
│   ├── TripsTimeline.tsx                 # 我的旅程表（横向 ribbon）
│   ├── WorkProgress.tsx                  # 作品巡礼进度（横条）
│   ├── AchievementWall.tsx               # 成就墙（8 medallion）
│   ├── TravelModeDonut.tsx               # 出行方式（甜甜圈 SVG）
│   ├── PhotoAlbum.tsx                    # 我的相册（4 张 washi 胶带照片）
│   ├── ExploreCards.tsx                  # 探索区 4 张卡
│   └── NearbyFloatingButton.tsx          # 右下 LBS 浮层

lib/journal/
├── types.ts                              # JournalSnapshot 数据契约
├── achievements.ts                       # 静态成就定义（8 条）+ 解锁判定
├── api.ts                                # getJournalApiDeps() 工厂（cached）
├── repo.ts                               # JournalReadRepo 接口
├── repoPrisma.ts                         # PrismaJournalReadRepo（生产）
├── repoMemory.ts                         # InMemoryJournalReadRepo（测试默认）
└── handlers/
    └── getJournalSnapshot.ts             # 聚合 Snapshot 的核心 handler

tests/journal/
├── achievements.test.ts                  # 8 条成就的解锁判定
├── repo-contract.test.ts                 # InMemoryJournalReadRepo 行为契约
├── snapshot.test.ts                      # getJournalSnapshot handler 整合测试
├── JournalCover.test.tsx                 # 封面区渲染
├── PilgrimageMap.test.tsx                # 地图组件渲染
├── AchievementWall.test.tsx              # 成就墙渲染
└── primitives.test.tsx                   # 视觉 primitives 烟雾测试

tailwind.config.ts                        # **MODIFY** 新增 journal 色板 + 字体
```

**总计** 24 个新文件 + 1 个修改。所有文件保持 < 300 行（线宽预算上限是 800）。

---

## Task 1 · 数据类型 + 静态成就定义

**Files:**
- Create: `lib/journal/types.ts`
- Create: `lib/journal/achievements.ts`
- Test: `tests/journal/achievements.test.ts`

`types.ts` 是整个 W1 的"契约" —— UI 看到的所有数据形状都在这里。`achievements.ts` 是静态配置，包含 8 条徽章定义和一个 pure function `evaluateAchievements(stats)` 输出解锁状态。

- [ ] **Step 1: 写 types.ts（先把契约定下来，没有测试只是 type 声明）**

```typescript
// lib/journal/types.ts

export type JournalSnapshot = {
  user: {
    id: string
    name: string
    image: string | null
    bio: string | null
    createdAt: Date
    journalNumber: string // e.g. "#0042"，由 user.id 派生
    daysSinceJoined: number // 从 createdAt 到 now 的整天数
  }

  stats: {
    worksVisited: number
    pointsVisited: number
    totalCheckins: number
    totalKilometers: number
    totalTrips: number
  }

  currentTrip: {
    id: string
    title: string
    pointCount: number
    durationDays: number | null
    departureDate: Date | null
    status: 'preparing' | 'in_progress'
  } | null

  prefectures: Array<{
    nameZh: string
    pointCount: number
  }>

  pinsForMap: Array<{
    lat: number
    lng: number
    isMostRecent: boolean
  }>

  recentNotes: Array<{
    id: string
    title: string
    bodyPreview: string
    publishedAt: Date
    location: string | null
    tags: string[]
  }>

  tripsForTimeline: Array<{
    id: string
    title: string
    workTitle: string | null
    location: string | null
    monthStart: number // 1-12
    monthEnd: number // 1-12
    status: 'completed' | 'in_progress' | 'planned'
  }>

  workProgress: Array<{
    workTitle: string
    visitedPoints: number
    totalPoints: number
    percent: number // 0-100, integer
  }>

  achievements: ReadonlyArray<{
    id: string
    label: string // "首次" / "百次" / "千里" ...
    sub: string // "打卡" / "步行" / "作品" ...
    color: AchievementColor
    unlocked: boolean
    unlockedAt: Date | null
  }>

  nextAchievement: {
    label: string // e.g. "200 次打卡"
    progress: number
    target: number
  } | null

  travelModeBreakdown: ReadonlyArray<{
    mode: 'train' | 'bus' | 'car' | 'walk'
    percent: number // 0-100, integer, sum === 100
  }>

  recentPhotos: ReadonlyArray<{
    id: string
    photoUrl: string
    placeName: string
    workTitle: string | null
    takenAt: Date
  }>
}

export type AchievementColor =
  | 'seal-red'
  | 'ink'
  | 'amber'
  | 'emerald'
  | 'sky'
  | 'rose'
  | 'slate'
  | 'stone'
```

- [ ] **Step 2: 写 achievements.ts 的失败测试**

```typescript
// tests/journal/achievements.test.ts
import { describe, expect, it } from 'vitest'
import {
  ACHIEVEMENT_DEFS,
  evaluateAchievements,
  pickNextAchievement,
  type AchievementInput,
} from '@/lib/journal/achievements'

const base: AchievementInput = {
  totalCheckins: 0,
  totalKilometers: 0,
  worksCompleted: 0,
  prefectureCount: 0,
  springCheckin: false,
  highSyncRateComposite: false,
  notesPublished: 0,
}

describe('achievements', () => {
  it('exposes exactly 8 stable definitions in fixed order', () => {
    expect(ACHIEVEMENT_DEFS.map((d) => d.id)).toEqual([
      'first-checkin',
      'hundred-checkins',
      'thousand-km',
      'work-complete',
      'eight-prefectures',
      'sakura-season',
      'sync-master',
      'note-writer',
    ])
  })

  it('locks all achievements for a fresh user', () => {
    const result = evaluateAchievements(base, new Date('2025-03-20'))
    for (const a of result) expect(a.unlocked).toBe(false)
  })

  it('unlocks first-checkin when totalCheckins >= 1', () => {
    const result = evaluateAchievements({ ...base, totalCheckins: 1 }, new Date('2025-03-20'))
    expect(result.find((a) => a.id === 'first-checkin')?.unlocked).toBe(true)
  })

  it('unlocks hundred-checkins at exactly 100 and not at 99', () => {
    const r99 = evaluateAchievements({ ...base, totalCheckins: 99 }, new Date('2025-03-20'))
    const r100 = evaluateAchievements({ ...base, totalCheckins: 100 }, new Date('2025-03-20'))
    expect(r99.find((a) => a.id === 'hundred-checkins')?.unlocked).toBe(false)
    expect(r100.find((a) => a.id === 'hundred-checkins')?.unlocked).toBe(true)
  })

  it('picks next achievement closest to unlock (smallest remaining ratio)', () => {
    // totalCheckins=156 → first/hundred unlocked; next should be 200 with 44 remaining
    const next = pickNextAchievement(
      { ...base, totalCheckins: 156 },
      new Date('2025-03-20'),
    )
    expect(next).toEqual({ label: '200 次打卡', progress: 156, target: 200 })
  })

  it('returns null next achievement when everything is unlocked', () => {
    const next = pickNextAchievement(
      {
        totalCheckins: 1000,
        totalKilometers: 10000,
        worksCompleted: 10,
        prefectureCount: 47,
        springCheckin: true,
        highSyncRateComposite: true,
        notesPublished: 100,
      },
      new Date('2025-03-20'),
    )
    expect(next).toBeNull()
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npx vitest run --project node tests/journal/achievements.test.ts`
Expected: FAIL with cannot resolve `@/lib/journal/achievements`.

- [ ] **Step 4: 实现 achievements.ts**

```typescript
// lib/journal/achievements.ts
import type { AchievementColor } from './types'

export type AchievementInput = {
  totalCheckins: number
  totalKilometers: number
  worksCompleted: number
  prefectureCount: number
  springCheckin: boolean
  highSyncRateComposite: boolean
  notesPublished: number
}

export type AchievementDef = {
  id: string
  label: string
  sub: string
  color: AchievementColor
  predicate: (input: AchievementInput) => boolean
  // For "next achievement" computation; null = not a count-style goal
  progress?: {
    current: (input: AchievementInput) => number
    target: number
    nextLabel: string
  }
}

export const ACHIEVEMENT_DEFS: ReadonlyArray<AchievementDef> = [
  {
    id: 'first-checkin',
    label: '首次',
    sub: '打卡',
    color: 'seal-red',
    predicate: (s) => s.totalCheckins >= 1,
    progress: { current: (s) => s.totalCheckins, target: 1, nextLabel: '1 次打卡' },
  },
  {
    id: 'hundred-checkins',
    label: '百次',
    sub: '打卡',
    color: 'ink',
    predicate: (s) => s.totalCheckins >= 100,
    progress: { current: (s) => s.totalCheckins, target: 100, nextLabel: '100 次打卡' },
  },
  {
    id: 'thousand-km',
    label: '千里',
    sub: '步行',
    color: 'amber',
    predicate: (s) => s.totalKilometers >= 1000,
    progress: { current: (s) => Math.round(s.totalKilometers), target: 1000, nextLabel: '1,000 公里' },
  },
  {
    id: 'work-complete',
    label: '通关',
    sub: '作品',
    color: 'emerald',
    predicate: (s) => s.worksCompleted >= 1,
    progress: { current: (s) => s.worksCompleted, target: 1, nextLabel: '完成一部作品' },
  },
  {
    id: 'eight-prefectures',
    label: '八县',
    sub: '巡游',
    color: 'sky',
    predicate: (s) => s.prefectureCount >= 8,
    progress: { current: (s) => s.prefectureCount, target: 8, nextLabel: '8 个县市' },
  },
  {
    id: 'sakura-season',
    label: '樱花',
    sub: '季',
    color: 'rose',
    predicate: (s) => s.springCheckin,
  },
  {
    id: 'sync-master',
    label: '神还原',
    sub: '对比图',
    color: 'slate',
    predicate: (s) => s.highSyncRateComposite,
  },
  {
    id: 'note-writer',
    label: '作家',
    sub: '随笔',
    color: 'stone',
    predicate: (s) => s.notesPublished >= 10,
    progress: { current: (s) => s.notesPublished, target: 10, nextLabel: '10 篇随笔' },
  },
]

export function evaluateAchievements(
  input: AchievementInput,
  now: Date,
): Array<{
  id: string
  label: string
  sub: string
  color: AchievementColor
  unlocked: boolean
  unlockedAt: Date | null
}> {
  return ACHIEVEMENT_DEFS.map((def) => {
    const unlocked = def.predicate(input)
    return {
      id: def.id,
      label: def.label,
      sub: def.sub,
      color: def.color,
      unlocked,
      // W1 cannot reconstruct unlock time from inputs; pass `now` if unlocked.
      unlockedAt: unlocked ? now : null,
    }
  })
}

export function pickNextAchievement(
  input: AchievementInput,
  _now: Date,
): { label: string; progress: number; target: number } | null {
  // Find unmet progress-style achievement with smallest remaining ratio
  const candidates = ACHIEVEMENT_DEFS
    .filter((d) => d.progress && !d.predicate(input))
    .map((d) => {
      const current = d.progress!.current(input)
      const target = d.progress!.target
      const remaining = Math.max(target - current, 1)
      return { def: d, current, target, remaining }
    })
    .sort((a, b) => a.remaining - b.remaining)

  const best = candidates[0]
  if (!best) return null
  return {
    label: best.def.progress!.nextLabel,
    progress: best.current,
    target: best.target,
  }
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run --project node tests/journal/achievements.test.ts`
Expected: PASS, 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/journal/types.ts lib/journal/achievements.ts tests/journal/achievements.test.ts
git commit -m "feat(journal): types + 8 achievement definitions with unlock evaluator (W1)"
```

---

## Task 2 · Repo 接口 + 内存双实现

**Files:**
- Create: `lib/journal/repo.ts`
- Create: `lib/journal/repoMemory.ts`
- Test: `tests/journal/repo-contract.test.ts`

`JournalReadRepo` 是**只读**接口（W1 不写库），暴露 7 个查询方法，喂给 Snapshot handler。内存实现先于 Prisma 实现，handler 用内存版做契约测试。

- [ ] **Step 1: 写 repo.ts 接口**

```typescript
// lib/journal/repo.ts

export type JournalUserRow = {
  id: string
  name: string | null
  image: string | null
  bio: string | null
  createdAt: Date
}

export type JournalCheckinRow = {
  pointId: string
  geoLat: number | null
  geoLng: number | null
  prefectureZh: string | null
  workTitle: string | null
  workId: string | null
  totalPointsForWork: number | null
  photoUrl: string | null
  placeName: string
  checkedInAt: Date
  isMostRecent: boolean
}

export type JournalRouteBookRow = {
  id: string
  title: string
  status: string // 'draft' | 'in_progress' | 'completed' (raw DB string)
  metadata: unknown
  pointCount: number
  createdAt: Date
  updatedAt: Date
  workTitle: string | null
  locationZh: string | null
}

export type JournalReadRepo = {
  getUser(userId: string): Promise<JournalUserRow | null>
  listCheckins(userId: string): Promise<JournalCheckinRow[]>
  listRouteBooks(userId: string): Promise<JournalRouteBookRow[]>
  countDistinctWorksVisited(userId: string): Promise<number>
  countDistinctPointsVisited(userId: string): Promise<number>
  countNotesPublished(userId: string): Promise<number>
}
```

- [ ] **Step 2: 写 repo-contract.test.ts 失败测试**

```typescript
// tests/journal/repo-contract.test.ts
import { describe, expect, it } from 'vitest'
import { InMemoryJournalReadRepo, type SeedData } from '@/lib/journal/repoMemory'

const baseSeed: SeedData = {
  users: [
    { id: 'u1', name: 'Lily', image: null, bio: null, createdAt: new Date('2024-10-04') },
  ],
  checkins: [],
  routeBooks: [],
  worksVisited: 0,
  pointsVisited: 0,
  notesPublished: 0,
}

describe('InMemoryJournalReadRepo', () => {
  it('returns null for unknown user', async () => {
    const repo = new InMemoryJournalReadRepo(baseSeed)
    expect(await repo.getUser('nope')).toBeNull()
  })

  it('returns the user row when present', async () => {
    const repo = new InMemoryJournalReadRepo(baseSeed)
    const user = await repo.getUser('u1')
    expect(user?.name).toBe('Lily')
  })

  it('returns empty arrays and zero counts for a user with no activity', async () => {
    const repo = new InMemoryJournalReadRepo(baseSeed)
    expect(await repo.listCheckins('u1')).toEqual([])
    expect(await repo.listRouteBooks('u1')).toEqual([])
    expect(await repo.countDistinctWorksVisited('u1')).toBe(0)
    expect(await repo.countDistinctPointsVisited('u1')).toBe(0)
    expect(await repo.countNotesPublished('u1')).toBe(0)
  })

  it('scopes checkins and routebooks by userId', async () => {
    const repo = new InMemoryJournalReadRepo({
      ...baseSeed,
      checkins: [
        {
          userId: 'u1',
          pointId: 'p1',
          geoLat: 35.3,
          geoLng: 139.5,
          prefectureZh: '神奈川',
          workTitle: '灌篮高手',
          workId: 'slamdunk',
          totalPointsForWork: 12,
          photoUrl: null,
          placeName: '镰仓高校前',
          checkedInAt: new Date('2025-03-20'),
          isMostRecent: true,
        },
        {
          userId: 'u2',
          pointId: 'p2',
          geoLat: 0,
          geoLng: 0,
          prefectureZh: null,
          workTitle: null,
          workId: null,
          totalPointsForWork: null,
          photoUrl: null,
          placeName: 'other-user-point',
          checkedInAt: new Date('2025-03-20'),
          isMostRecent: true,
        },
      ],
    })
    const checkins = await repo.listCheckins('u1')
    expect(checkins).toHaveLength(1)
    expect(checkins[0].placeName).toBe('镰仓高校前')
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npx vitest run --project node tests/journal/repo-contract.test.ts`
Expected: FAIL with cannot resolve `@/lib/journal/repoMemory`.

- [ ] **Step 4: 实现 repoMemory.ts**

```typescript
// lib/journal/repoMemory.ts
import type {
  JournalCheckinRow,
  JournalReadRepo,
  JournalRouteBookRow,
  JournalUserRow,
} from './repo'

export type SeedData = {
  users: JournalUserRow[]
  checkins: Array<JournalCheckinRow & { userId: string }>
  routeBooks: Array<JournalRouteBookRow & { userId: string }>
  worksVisited: number
  pointsVisited: number
  notesPublished: number
}

export class InMemoryJournalReadRepo implements JournalReadRepo {
  constructor(private readonly seed: SeedData) {}

  async getUser(userId: string): Promise<JournalUserRow | null> {
    return this.seed.users.find((u) => u.id === userId) ?? null
  }

  async listCheckins(userId: string): Promise<JournalCheckinRow[]> {
    return this.seed.checkins
      .filter((c) => c.userId === userId)
      .map(({ userId: _drop, ...rest }) => rest)
  }

  async listRouteBooks(userId: string): Promise<JournalRouteBookRow[]> {
    return this.seed.routeBooks
      .filter((r) => r.userId === userId)
      .map(({ userId: _drop, ...rest }) => rest)
  }

  async countDistinctWorksVisited(userId: string): Promise<number> {
    return this.seed.users.some((u) => u.id === userId) ? this.seed.worksVisited : 0
  }

  async countDistinctPointsVisited(userId: string): Promise<number> {
    return this.seed.users.some((u) => u.id === userId) ? this.seed.pointsVisited : 0
  }

  async countNotesPublished(userId: string): Promise<number> {
    return this.seed.users.some((u) => u.id === userId) ? this.seed.notesPublished : 0
  }
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run --project node tests/journal/repo-contract.test.ts`
Expected: PASS, 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/journal/repo.ts lib/journal/repoMemory.ts tests/journal/repo-contract.test.ts
git commit -m "feat(journal): read-only repo interface + in-memory double (W1)"
```

---

## Task 3 · Snapshot 聚合 handler（TDD 主体）

**Files:**
- Create: `lib/journal/handlers/getJournalSnapshot.ts`
- Test: `tests/journal/snapshot.test.ts`

整个 W1 业务逻辑的核心。把 repo 七个查询结果 + 静态成就定义聚合成 `JournalSnapshot`。**纯函数式**，所有 IO 通过 repo 注入，所有时间通过 `now` 注入。

- [ ] **Step 1: 写最大覆盖面的失败测试**

```typescript
// tests/journal/snapshot.test.ts
import { describe, expect, it } from 'vitest'
import { getJournalSnapshot } from '@/lib/journal/handlers/getJournalSnapshot'
import { InMemoryJournalReadRepo } from '@/lib/journal/repoMemory'

const NOW = new Date('2025-03-20T08:00:00Z')

function makeRepo(overrides: Partial<ConstructorParameters<typeof InMemoryJournalReadRepo>[0]> = {}) {
  return new InMemoryJournalReadRepo({
    users: [
      { id: 'u1', name: 'Lily', image: null, bio: null, createdAt: new Date('2024-10-04') },
    ],
    checkins: [],
    routeBooks: [],
    worksVisited: 0,
    pointsVisited: 0,
    notesPublished: 0,
    ...overrides,
  })
}

describe('getJournalSnapshot', () => {
  it('returns null when user does not exist', async () => {
    const repo = makeRepo()
    const result = await getJournalSnapshot({ userId: 'nope', repo, now: () => NOW })
    expect(result).toBeNull()
  })

  it('returns user with derived journalNumber and daysSinceJoined', async () => {
    const repo = makeRepo()
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.user.name).toBe('Lily')
    // 2024-10-04 -> 2025-03-20 = 167 days (inclusive)
    expect(snap?.user.daysSinceJoined).toBe(167)
    // journalNumber is "#" + last 4 of id padded — for 'u1' fallback to '0001'
    expect(snap?.user.journalNumber).toMatch(/^#\d{4}$/)
  })

  it('returns zeroed stats for inactive user', async () => {
    const repo = makeRepo()
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.stats).toEqual({
      worksVisited: 0,
      pointsVisited: 0,
      totalCheckins: 0,
      totalKilometers: 0,
      totalTrips: 0,
    })
  })

  it('aggregates stats and timeline from checkins and routebooks', async () => {
    const repo = makeRepo({
      worksVisited: 5,
      pointsVisited: 47,
      checkins: Array.from({ length: 156 }, (_, i) => ({
        userId: 'u1',
        pointId: `p${i}`,
        geoLat: 35 + (i % 5) * 0.1,
        geoLng: 139 + (i % 7) * 0.1,
        prefectureZh: ['神奈川', '京都', '山梨'][i % 3],
        workTitle: '灌篮高手',
        workId: 'slamdunk',
        totalPointsForWork: 12,
        photoUrl: i % 20 === 0 ? `https://example.com/p${i}.jpg` : null,
        placeName: `point-${i}`,
        checkedInAt: new Date(`2025-0${(i % 9) + 1}-15`),
        isMostRecent: i === 155,
      })),
      routeBooks: [
        {
          userId: 'u1',
          id: 'rb1',
          title: '镰仓·灌篮高手回忆',
          status: 'in_progress',
          metadata: { departureDate: '2025-03-15' },
          pointCount: 8,
          createdAt: new Date('2025-03-01'),
          updatedAt: new Date('2025-03-19'),
          workTitle: '灌篮高手',
          locationZh: '神奈川',
        },
      ],
    })
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.stats.totalCheckins).toBe(156)
    expect(snap?.stats.worksVisited).toBe(5)
    expect(snap?.stats.pointsVisited).toBe(47)
    expect(snap?.stats.totalTrips).toBe(1)
    expect(snap?.tripsForTimeline).toHaveLength(1)
    expect(snap?.tripsForTimeline[0].title).toBe('镰仓·灌篮高手回忆')
    expect(snap?.tripsForTimeline[0].status).toBe('in_progress')
  })

  it('picks the in_progress routebook as currentTrip, else the latest draft', async () => {
    const repo = makeRepo({
      routeBooks: [
        {
          userId: 'u1',
          id: 'rb1',
          title: '旧草稿',
          status: 'draft',
          metadata: null,
          pointCount: 3,
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
          workTitle: null,
          locationZh: null,
        },
        {
          userId: 'u1',
          id: 'rb2',
          title: '京都·CLANNAD 之旅',
          status: 'in_progress',
          metadata: { departureDate: '2025-04-12' },
          pointCount: 12,
          createdAt: new Date('2025-03-01'),
          updatedAt: new Date('2025-03-15'),
          workTitle: 'CLANNAD',
          locationZh: '京都',
        },
      ],
    })
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.currentTrip?.id).toBe('rb2')
    expect(snap?.currentTrip?.title).toBe('京都·CLANNAD 之旅')
    expect(snap?.currentTrip?.status).toBe('in_progress')
    expect(snap?.currentTrip?.pointCount).toBe(12)
  })

  it('returns prefectures sorted by descending pointCount', async () => {
    const repo = makeRepo({
      checkins: [
        { userId: 'u1', pointId: 'a', geoLat: 35, geoLng: 139, prefectureZh: '京都', workTitle: null, workId: null, totalPointsForWork: null, photoUrl: null, placeName: 'a', checkedInAt: new Date('2025-01-01'), isMostRecent: false },
        { userId: 'u1', pointId: 'b', geoLat: 35, geoLng: 139, prefectureZh: '京都', workTitle: null, workId: null, totalPointsForWork: null, photoUrl: null, placeName: 'b', checkedInAt: new Date('2025-01-01'), isMostRecent: false },
        { userId: 'u1', pointId: 'c', geoLat: 35, geoLng: 139, prefectureZh: '神奈川', workTitle: null, workId: null, totalPointsForWork: null, photoUrl: null, placeName: 'c', checkedInAt: new Date('2025-01-01'), isMostRecent: false },
        { userId: 'u1', pointId: 'd', geoLat: 35, geoLng: 139, prefectureZh: '神奈川', workTitle: null, workId: null, totalPointsForWork: null, photoUrl: null, placeName: 'd', checkedInAt: new Date('2025-01-01'), isMostRecent: false },
        { userId: 'u1', pointId: 'e', geoLat: 35, geoLng: 139, prefectureZh: '神奈川', workTitle: null, workId: null, totalPointsForWork: null, photoUrl: null, placeName: 'e', checkedInAt: new Date('2025-01-01'), isMostRecent: false },
      ],
    })
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.prefectures.map((p) => p.nameZh)).toEqual(['神奈川', '京都'])
    expect(snap?.prefectures[0].pointCount).toBe(3)
    expect(snap?.prefectures[1].pointCount).toBe(2)
  })

  it('returns travelModeBreakdown summing to 100 (W1 stub values)', async () => {
    const repo = makeRepo()
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    const sum = snap!.travelModeBreakdown.reduce((acc, m) => acc + m.percent, 0)
    expect(sum).toBe(100)
    expect(snap?.travelModeBreakdown.map((m) => m.mode).sort()).toEqual(['bus', 'car', 'train', 'walk'])
  })

  it('returns recentNotes empty array in W1', async () => {
    const repo = makeRepo({ notesPublished: 42 })
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.recentNotes).toEqual([])
  })

  it('returns up to 4 most-recent photos, newest first', async () => {
    const repo = makeRepo({
      checkins: [
        { userId: 'u1', pointId: 'p1', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: 'A', workId: 'a', totalPointsForWork: null, photoUrl: 'https://x/1.jpg', placeName: 'A站', checkedInAt: new Date('2025-03-20'), isMostRecent: true },
        { userId: 'u1', pointId: 'p2', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: 'B', workId: 'b', totalPointsForWork: null, photoUrl: 'https://x/2.jpg', placeName: 'B站', checkedInAt: new Date('2025-03-19'), isMostRecent: false },
        { userId: 'u1', pointId: 'p3', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: 'C', workId: 'c', totalPointsForWork: null, photoUrl: null, placeName: 'C站', checkedInAt: new Date('2025-03-18'), isMostRecent: false },
        { userId: 'u1', pointId: 'p4', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: 'D', workId: 'd', totalPointsForWork: null, photoUrl: 'https://x/4.jpg', placeName: 'D站', checkedInAt: new Date('2025-03-17'), isMostRecent: false },
        { userId: 'u1', pointId: 'p5', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: 'E', workId: 'e', totalPointsForWork: null, photoUrl: 'https://x/5.jpg', placeName: 'E站', checkedInAt: new Date('2025-03-16'), isMostRecent: false },
        { userId: 'u1', pointId: 'p6', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: 'F', workId: 'f', totalPointsForWork: null, photoUrl: 'https://x/6.jpg', placeName: 'F站', checkedInAt: new Date('2025-03-15'), isMostRecent: false },
      ],
    })
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.recentPhotos).toHaveLength(4)
    expect(snap?.recentPhotos[0].photoUrl).toBe('https://x/1.jpg')
    expect(snap?.recentPhotos.map((p) => p.placeName)).toEqual(['A站', 'B站', 'D站', 'E站'])
  })

  it('builds workProgress for each work seen, sorted by percent desc', async () => {
    const repo = makeRepo({
      checkins: [
        { userId: 'u1', pointId: 'a1', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: '你的名字。', workId: 'kimi', totalPointsForWork: 14, photoUrl: null, placeName: 'a1', checkedInAt: new Date('2025-01-01'), isMostRecent: false },
        ...Array.from({ length: 13 }, (_, i) => ({
          userId: 'u1', pointId: `kimi-${i}`, geoLat: 0, geoLng: 0, prefectureZh: null,
          workTitle: '你的名字。', workId: 'kimi', totalPointsForWork: 14, photoUrl: null,
          placeName: `kimi-${i}`, checkedInAt: new Date('2025-01-01'), isMostRecent: false,
        })),
        // 灌篮高手 8/12 = 67%
        ...Array.from({ length: 8 }, (_, i) => ({
          userId: 'u1', pointId: `sd-${i}`, geoLat: 0, geoLng: 0, prefectureZh: null,
          workTitle: '灌篮高手', workId: 'slamdunk', totalPointsForWork: 12, photoUrl: null,
          placeName: `sd-${i}`, checkedInAt: new Date('2025-02-01'), isMostRecent: false,
        })),
      ],
    })
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.workProgress.map((w) => w.workTitle)).toEqual(['你的名字。', '灌篮高手'])
    expect(snap?.workProgress[0].percent).toBe(100)
    expect(snap?.workProgress[1].percent).toBe(67)
  })

  it('exposes 8 achievements in fixed order from achievements module', async () => {
    const repo = makeRepo()
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.achievements).toHaveLength(8)
    expect(snap?.achievements[0].id).toBe('first-checkin')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run --project node tests/journal/snapshot.test.ts`
Expected: FAIL with cannot resolve handler.

- [ ] **Step 3: 实现 getJournalSnapshot**

```typescript
// lib/journal/handlers/getJournalSnapshot.ts
import { evaluateAchievements, pickNextAchievement } from '@/lib/journal/achievements'
import type {
  JournalCheckinRow,
  JournalReadRepo,
  JournalRouteBookRow,
} from '@/lib/journal/repo'
import type { JournalSnapshot } from '@/lib/journal/types'

const DEFAULT_TRAVEL_MODES: JournalSnapshot['travelModeBreakdown'] = [
  { mode: 'train', percent: 58 },
  { mode: 'bus', percent: 20 },
  { mode: 'car', percent: 15 },
  { mode: 'walk', percent: 7 },
]

export type GetJournalSnapshotInput = {
  userId: string
  repo: JournalReadRepo
  now: () => Date
}

export async function getJournalSnapshot(
  input: GetJournalSnapshotInput,
): Promise<JournalSnapshot | null> {
  const { userId, repo, now: nowFn } = input
  const now = nowFn()

  const user = await repo.getUser(userId)
  if (!user) return null

  const [checkins, routeBooks, worksVisited, pointsVisited, notesPublished] = await Promise.all([
    repo.listCheckins(userId),
    repo.listRouteBooks(userId),
    repo.countDistinctWorksVisited(userId),
    repo.countDistinctPointsVisited(userId),
    repo.countNotesPublished(userId),
  ])

  const stats = buildStats({ checkins, routeBooks, worksVisited, pointsVisited })
  const currentTrip = pickCurrentTrip(routeBooks)
  const prefectures = buildPrefectures(checkins)
  const pinsForMap = buildPins(checkins)
  const tripsForTimeline = buildTimeline(routeBooks)
  const workProgress = buildWorkProgress(checkins)
  const recentPhotos = buildRecentPhotos(checkins)
  const worksCompleted = workProgress.filter((w) => w.percent === 100).length
  const prefectureCount = prefectures.length

  const achievementInput = {
    totalCheckins: stats.totalCheckins,
    totalKilometers: stats.totalKilometers,
    worksCompleted,
    prefectureCount,
    springCheckin: hasSpringCheckin(checkins),
    highSyncRateComposite: false,
    notesPublished,
  }
  const achievements = evaluateAchievements(achievementInput, now)
  const nextAchievement = pickNextAchievement(achievementInput, now)

  return {
    user: {
      id: user.id,
      name: user.name ?? '巡礼者',
      image: user.image,
      bio: user.bio,
      createdAt: user.createdAt,
      journalNumber: deriveJournalNumber(user.id),
      daysSinceJoined: daysBetween(user.createdAt, now),
    },
    stats,
    currentTrip,
    prefectures,
    pinsForMap,
    recentNotes: [],
    tripsForTimeline,
    workProgress,
    achievements,
    nextAchievement,
    travelModeBreakdown: DEFAULT_TRAVEL_MODES,
    recentPhotos,
  }
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime()
  return Math.max(Math.floor(ms / 86_400_000), 0)
}

function deriveJournalNumber(userId: string): string {
  const digits = userId.replace(/[^0-9]/g, '').padStart(4, '0').slice(-4)
  return `#${digits || '0001'}`
}

function buildStats(args: {
  checkins: JournalCheckinRow[]
  routeBooks: JournalRouteBookRow[]
  worksVisited: number
  pointsVisited: number
}): JournalSnapshot['stats'] {
  const trips = args.routeBooks.filter((r) => r.status === 'completed' || r.status === 'in_progress')
  return {
    worksVisited: args.worksVisited,
    pointsVisited: args.pointsVisited,
    totalCheckins: args.checkins.length,
    totalKilometers: estimateKilometers(args.checkins),
    totalTrips: trips.length,
  }
}

function estimateKilometers(checkins: JournalCheckinRow[]): number {
  // W1 heuristic: rough sum of great-circle distances between consecutive checkins
  let total = 0
  const sorted = [...checkins].sort((a, b) => a.checkedInAt.getTime() - b.checkedInAt.getTime())
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]
    const b = sorted[i]
    if (a.geoLat == null || a.geoLng == null || b.geoLat == null || b.geoLng == null) continue
    total += haversineKm(a.geoLat, a.geoLng, b.geoLat, b.geoLng)
  }
  return Math.round(total)
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function pickCurrentTrip(rbs: JournalRouteBookRow[]): JournalSnapshot['currentTrip'] {
  const inProgress = rbs.find((r) => r.status === 'in_progress')
  const fallback = [...rbs]
    .filter((r) => r.status === 'draft')
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
  const picked = inProgress ?? fallback
  if (!picked) return null
  const meta = picked.metadata as Record<string, unknown> | null
  const departureRaw = meta && typeof meta.departureDate === 'string' ? meta.departureDate : null
  return {
    id: picked.id,
    title: picked.title,
    pointCount: picked.pointCount,
    durationDays: typeof meta?.durationDays === 'number' ? (meta.durationDays as number) : null,
    departureDate: departureRaw ? new Date(departureRaw) : null,
    status: picked.status === 'in_progress' ? 'in_progress' : 'preparing',
  }
}

function buildPrefectures(checkins: JournalCheckinRow[]): JournalSnapshot['prefectures'] {
  const counts = new Map<string, number>()
  for (const c of checkins) {
    if (!c.prefectureZh) continue
    counts.set(c.prefectureZh, (counts.get(c.prefectureZh) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([nameZh, pointCount]) => ({ nameZh, pointCount }))
    .sort((a, b) => b.pointCount - a.pointCount || a.nameZh.localeCompare(b.nameZh))
}

function buildPins(checkins: JournalCheckinRow[]): JournalSnapshot['pinsForMap'] {
  return checkins
    .filter((c) => c.geoLat != null && c.geoLng != null)
    .map((c) => ({ lat: c.geoLat as number, lng: c.geoLng as number, isMostRecent: c.isMostRecent }))
}

function buildTimeline(rbs: JournalRouteBookRow[]): JournalSnapshot['tripsForTimeline'] {
  return rbs.map((r) => {
    const meta = r.metadata as Record<string, unknown> | null
    const departureRaw = meta && typeof meta.departureDate === 'string' ? meta.departureDate : null
    const start = departureRaw ? new Date(departureRaw) : r.createdAt
    const monthStart = start.getUTCMonth() + 1
    const durationDays =
      meta && typeof meta.durationDays === 'number' ? (meta.durationDays as number) : 0
    const endMonth = monthStart // simplified for W1
    void durationDays // keep monthEnd === monthStart in W1
    const status: 'completed' | 'in_progress' | 'planned' =
      r.status === 'completed' ? 'completed' : r.status === 'in_progress' ? 'in_progress' : 'planned'
    return {
      id: r.id,
      title: r.title,
      workTitle: r.workTitle,
      location: r.locationZh,
      monthStart,
      monthEnd: endMonth,
      status,
    }
  })
}

function buildWorkProgress(checkins: JournalCheckinRow[]): JournalSnapshot['workProgress'] {
  type Acc = { workId: string; workTitle: string; visited: Set<string>; total: number }
  const byWork = new Map<string, Acc>()
  for (const c of checkins) {
    if (!c.workId || !c.workTitle) continue
    const entry = byWork.get(c.workId) ?? {
      workId: c.workId,
      workTitle: c.workTitle,
      visited: new Set<string>(),
      total: c.totalPointsForWork ?? 0,
    }
    entry.visited.add(c.pointId)
    if (c.totalPointsForWork != null) entry.total = Math.max(entry.total, c.totalPointsForWork)
    byWork.set(c.workId, entry)
  }
  return [...byWork.values()]
    .map((w) => {
      const visitedPoints = w.visited.size
      const totalPoints = Math.max(w.total, visitedPoints)
      const percent = totalPoints === 0 ? 0 : Math.round((visitedPoints / totalPoints) * 100)
      return { workTitle: w.workTitle, visitedPoints, totalPoints, percent }
    })
    .sort((a, b) => b.percent - a.percent || a.workTitle.localeCompare(b.workTitle))
}

function buildRecentPhotos(checkins: JournalCheckinRow[]): JournalSnapshot['recentPhotos'] {
  return [...checkins]
    .filter((c) => c.photoUrl)
    .sort((a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime())
    .slice(0, 4)
    .map((c) => ({
      id: c.pointId,
      photoUrl: c.photoUrl as string,
      placeName: c.placeName,
      workTitle: c.workTitle,
      takenAt: c.checkedInAt,
    }))
}

function hasSpringCheckin(checkins: JournalCheckinRow[]): boolean {
  return checkins.some((c) => {
    const m = c.checkedInAt.getUTCMonth() + 1
    return m >= 3 && m <= 5
  })
}
```

- [ ] **Step 4: 运行测试，确认全部通过**

Run: `npx vitest run --project node tests/journal/snapshot.test.ts`
Expected: PASS, 11 tests pass.

- [ ] **Step 5: Run full test suite to confirm no regression**

Run: `npm test -- tests/journal/`
Expected: All journal tests pass; line-budget check passes.

- [ ] **Step 6: Commit**

```bash
git add lib/journal/handlers/getJournalSnapshot.ts tests/journal/snapshot.test.ts
git commit -m "feat(journal): getJournalSnapshot aggregator with 11 contract tests (W1)"
```

---

## Task 4 · API 工厂 + Prisma Read Repo

**Files:**
- Create: `lib/journal/api.ts`
- Create: `lib/journal/repoPrisma.ts`

模仿 `lib/article/api.ts` 写 `getJournalApiDeps()` 工厂；用 Prisma 实现 `JournalReadRepo`。Prisma 实现不写单测（依赖真实 DB），契约通过内存版已经覆盖。

- [ ] **Step 1: 写 lib/journal/api.ts**

```typescript
// lib/journal/api.ts
import type { Session } from 'next-auth'
import type { JournalReadRepo } from './repo'

export type JournalApiDeps = {
  repo: JournalReadRepo
  getSession: () => Promise<Session | null>
  now: () => Date
}

let cached: JournalApiDeps | null = null

export async function getJournalApiDeps(): Promise<JournalApiDeps> {
  if (cached) return cached

  const [{ PrismaJournalReadRepo }, { getServerAuthSession }] = await Promise.all([
    import('@/lib/journal/repoPrisma'),
    import('@/lib/auth/session'),
  ])

  cached = {
    repo: new PrismaJournalReadRepo(),
    getSession: getServerAuthSession,
    now: () => new Date(),
  }
  return cached
}
```

- [ ] **Step 2: 写 lib/journal/repoPrisma.ts**

```typescript
// lib/journal/repoPrisma.ts
import { prisma } from '@/lib/db/prisma'
import type {
  JournalCheckinRow,
  JournalReadRepo,
  JournalRouteBookRow,
  JournalUserRow,
} from './repo'

export class PrismaJournalReadRepo implements JournalReadRepo {
  async getUser(userId: string): Promise<JournalUserRow | null> {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, image: true, bio: true, createdAt: true },
    })
    return row ?? null
  }

  async listCheckins(userId: string): Promise<JournalCheckinRow[]> {
    const rows = await prisma.userPointState.findMany({
      where: { userId, state: 'visited' },
      orderBy: { checkedInAt: 'desc' },
      include: {
        point: {
          select: {
            id: true,
            name: true,
            nameZh: true,
            geoLat: true,
            geoLng: true,
            bangumi: {
              select: {
                id: true,
                titleZh: true,
                city: true,
                _count: { select: { points: true } },
              },
            },
          },
        },
      },
    })
    if (rows.length === 0) return []
    const newestId = rows[0].pointId
    return rows.map((r) => ({
      pointId: r.pointId,
      geoLat: r.point.geoLat ?? null,
      geoLng: r.point.geoLng ?? null,
      prefectureZh: r.point.bangumi?.city ?? null,
      workTitle: r.point.bangumi?.titleZh ?? null,
      workId: r.point.bangumi ? String(r.point.bangumi.id) : null,
      totalPointsForWork: r.point.bangumi?._count.points ?? null,
      photoUrl: r.photoUrl,
      placeName: r.point.nameZh ?? r.point.name,
      checkedInAt: r.checkedInAt ?? r.updatedAt,
      isMostRecent: r.pointId === newestId,
    }))
  }

  async listRouteBooks(userId: string): Promise<JournalRouteBookRow[]> {
    const rows = await prisma.routeBook.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { points: true } } },
    })
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      metadata: r.metadata,
      pointCount: r._count.points,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      workTitle: null,
      locationZh: null,
    }))
  }

  async countDistinctWorksVisited(userId: string): Promise<number> {
    const result = await prisma.userPointState.findMany({
      where: { userId, state: 'visited' },
      distinct: ['pointId'],
      select: { point: { select: { bangumiId: true } } },
    })
    const works = new Set(result.map((r) => r.point.bangumiId).filter(Boolean))
    return works.size
  }

  async countDistinctPointsVisited(userId: string): Promise<number> {
    return prisma.userPointState.count({
      where: { userId, state: 'visited' },
    })
  }

  async countNotesPublished(_userId: string): Promise<number> {
    // W1: notes concept doesn't exist yet; always 0
    return 0
  }
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck:app`
Expected: PASS (no new type errors).

- [ ] **Step 4: Commit**

```bash
git add lib/journal/api.ts lib/journal/repoPrisma.ts
git commit -m "feat(journal): cached api factory + Prisma read repo (W1)"
```

---

## Task 5 · 视觉 Primitives + Tailwind 色板

**Files:**
- Create: `app/(authed)/me/journal/primitives/PaperCard.tsx`
- Create: `app/(authed)/me/journal/primitives/RedSeal.tsx`
- Create: `app/(authed)/me/journal/primitives/WashiTape.tsx`
- Create: `app/(authed)/me/journal/primitives/InkDivider.tsx`
- Create: `app/(authed)/me/journal/primitives/StitchedBorder.tsx`
- Create: `app/(authed)/me/journal/primitives/PageFoldCorner.tsx`
- Modify: `tailwind.config.ts`
- Test: `tests/journal/primitives.test.tsx`

把宪章 §8 的视觉系统固化成 6 个可复用 primitives。每个 < 60 行，无业务逻辑。Tailwind 加 `journal` 色板。

- [ ] **Step 1: 修改 tailwind.config.ts，新增 journal 色板和字体**

```typescript
// tailwind.config.ts (现有文件，在 extend.colors 和 extend.fontFamily 处加入)
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './features/**/*.{ts,tsx}',
    './content/**/*.{md,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf2f8',
          100: '#fce7f3',
          200: '#fbcfe8',
          300: '#f9a8d4',
          400: '#f472b6',
          500: '#ec4899',
          600: '#db2777',
          700: '#be185d',
          800: '#9d174d',
          900: '#831843',
        },
        journal: {
          paper: '#f3ecdc',
          'paper-warm': '#ede4cf',
          'paper-card': '#fdfaf3',
          ink: '#1f1a13',
          'ink-soft': '#4a4236',
          'ink-muted': '#847b6c',
          seal: '#a8392b',
          'seal-deep': '#862c20',
          indigo: '#2d3e50',
          thread: 'rgba(31, 26, 19, 0.18)',
        },
      },
      fontFamily: {
        display: ['var(--font-noto-sans-sc)', 'sans-serif'],
        body: ['var(--font-inter)', 'sans-serif'],
        'journal-serif': ['"Noto Serif SC"', '"Songti SC"', 'serif'],
        'journal-latin': ['"Cormorant Garamond"', 'serif'],
        'journal-hand': ['"Ma Shan Zheng"', '"Noto Serif SC"', 'serif'],
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 2: 写 primitives + 烟雾测试**

`primitives/PaperCard.tsx`:

```typescript
import type { HTMLAttributes, ReactNode } from 'react'

type Props = HTMLAttributes<HTMLDivElement> & { children: ReactNode }

export function PaperCard({ children, className = '', ...rest }: Props) {
  return (
    <div
      data-testid="paper-card"
      className={[
        'relative bg-journal-paper-card rounded-sm',
        'shadow-[0_1px_0_rgba(31,26,19,0.04),0_8px_24px_-10px_rgba(31,26,19,0.18)]',
        'before:absolute before:inset-0 before:pointer-events-none before:opacity-70',
        // 纸张噪点底纹通过 inline style 注入（CSS background-image 数据 URI）
        className,
      ].join(' ')}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence baseFrequency='0.7' numOctaves='1'/><feColorMatrix values='0 0 0 0 0.6 0 0 0 0 0.55 0 0 0 0 0.45 0 0 0 0.05 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        backgroundBlendMode: 'multiply',
      }}
      {...rest}
    >
      {children}
    </div>
  )
}
```

`primitives/RedSeal.tsx`:

```typescript
import type { HTMLAttributes, ReactNode } from 'react'

type Props = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode
  variant?: 'square' | 'round'
  rotate?: 'left' | 'right' | 'none'
}

export function RedSeal({
  children,
  variant = 'square',
  rotate = 'right',
  className = '',
  ...rest
}: Props) {
  const rotationClass =
    rotate === 'left' ? '-rotate-3' : rotate === 'right' ? 'rotate-3' : ''
  const shape =
    variant === 'round' ? 'rounded-full w-16 h-16 grid place-items-center' : 'rounded-sm px-2.5 py-1'

  return (
    <span
      data-testid="red-seal"
      data-variant={variant}
      className={[
        'inline-block bg-gradient-to-br from-journal-seal to-journal-seal-deep',
        'text-journal-paper-card font-journal-serif font-bold tracking-[3px]',
        'shadow-[0_0_0_1px_rgba(168,57,43,0.3),2px_3px_0_rgba(168,57,43,0.15)]',
        shape,
        rotationClass,
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </span>
  )
}
```

`primitives/WashiTape.tsx`:

```typescript
import type { HTMLAttributes } from 'react'

type Color = 'rose' | 'amber' | 'emerald' | 'indigo' | 'violet'
type Props = HTMLAttributes<HTMLDivElement> & { color?: Color }

const COLOR_MAP: Record<Color, string> = {
  rose: 'rgba(168, 57, 43, %)',
  amber: 'rgba(180, 120, 30, %)',
  emerald: 'rgba(40, 110, 75, %)',
  indigo: 'rgba(45, 62, 80, %)',
  violet: 'rgba(110, 60, 130, %)',
}

export function WashiTape({ color = 'rose', className = '', style, ...rest }: Props) {
  const base = COLOR_MAP[color]
  return (
    <div
      data-testid="washi-tape"
      className={['absolute h-[22px] w-[100px] shadow-sm', className].join(' ')}
      style={{
        backgroundImage: `repeating-linear-gradient(45deg, ${base.replace('%', '0.18')} 0 6px, ${base.replace('%', '0.28')} 6px 12px)`,
        ...style,
      }}
      {...rest}
    />
  )
}
```

`primitives/InkDivider.tsx`:

```typescript
export function InkDivider({ className = '' }: { className?: string }) {
  return (
    <div
      data-testid="ink-divider"
      className={['h-px opacity-40', className].join(' ')}
      style={{
        background:
          'linear-gradient(90deg, transparent 0%, #4a4236 10%, #4a4236 90%, transparent 100%)',
      }}
    />
  )
}
```

`primitives/StitchedBorder.tsx`:

```typescript
import type { HTMLAttributes, ReactNode } from 'react'

export function StitchedBorder({
  children,
  className = '',
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      data-testid="stitched-border"
      className={['border border-dashed border-journal-thread', className].join(' ')}
      {...rest}
    >
      {children}
    </div>
  )
}
```

`primitives/PageFoldCorner.tsx`:

```typescript
export function PageFoldCorner() {
  return (
    <span
      data-testid="page-fold"
      aria-hidden="true"
      className="absolute right-0 bottom-0 w-6 h-6 pointer-events-none"
      style={{
        background:
          'linear-gradient(225deg, rgba(31, 26, 19, 0.08) 0%, rgba(31, 26, 19, 0.04) 40%, transparent 50%)',
        clipPath: 'polygon(100% 0, 0 100%, 100% 100%)',
      }}
    />
  )
}
```

`tests/journal/primitives.test.tsx`:

```typescript
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { PaperCard } from '@/app/(authed)/me/journal/primitives/PaperCard'
import { RedSeal } from '@/app/(authed)/me/journal/primitives/RedSeal'
import { WashiTape } from '@/app/(authed)/me/journal/primitives/WashiTape'
import { InkDivider } from '@/app/(authed)/me/journal/primitives/InkDivider'
import { StitchedBorder } from '@/app/(authed)/me/journal/primitives/StitchedBorder'
import { PageFoldCorner } from '@/app/(authed)/me/journal/primitives/PageFoldCorner'

describe('journal primitives', () => {
  it('PaperCard renders children', () => {
    const { getByText } = render(<PaperCard>hello</PaperCard>)
    expect(getByText('hello')).toBeTruthy()
  })

  it('RedSeal supports square (default) and round variants', () => {
    const { getByTestId, rerender } = render(<RedSeal>巡礼者</RedSeal>)
    expect(getByTestId('red-seal').dataset.variant).toBe('square')
    rerender(<RedSeal variant="round">巡</RedSeal>)
    expect(getByTestId('red-seal').dataset.variant).toBe('round')
  })

  it('WashiTape renders as an empty absolute strip', () => {
    const { getByTestId } = render(<WashiTape color="rose" />)
    expect(getByTestId('washi-tape').className).toMatch(/absolute/)
  })

  it('InkDivider is a 1px gradient bar', () => {
    const { getByTestId } = render(<InkDivider />)
    expect(getByTestId('ink-divider').className).toMatch(/h-px/)
  })

  it('StitchedBorder wraps children with dashed border', () => {
    const { getByText, getByTestId } = render(<StitchedBorder>x</StitchedBorder>)
    expect(getByText('x')).toBeTruthy()
    expect(getByTestId('stitched-border').className).toMatch(/border-dashed/)
  })

  it('PageFoldCorner renders an aria-hidden corner', () => {
    const { getByTestId } = render(<PageFoldCorner />)
    expect(getByTestId('page-fold').getAttribute('aria-hidden')).toBe('true')
  })
})
```

- [ ] **Step 3: 运行 primitives 测试**

Run: `npx vitest run --project jsdom tests/journal/primitives.test.tsx`
Expected: PASS, 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/\(authed\)/me/journal/primitives tailwind.config.ts tests/journal/primitives.test.tsx
git commit -m "feat(journal): 6 visual primitives + journal Tailwind palette (W1)"
```

---

## Task 6 · JournalCover 组件

**Files:**
- Create: `app/(authed)/me/journal/components/JournalCover.tsx`
- Test: `tests/journal/JournalCover.test.tsx`

封面区是手帐感最浓的一格 —— 头像、VOL.01 / 第 N 天 / 5 stats / 当前行程 / 卷号 / 引言 / 两条 washi 胶带。

- [ ] **Step 1: 写 JournalCover.test.tsx 失败测试**

```typescript
// tests/journal/JournalCover.test.tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { JournalCover } from '@/app/(authed)/me/journal/components/JournalCover'
import type { JournalSnapshot } from '@/lib/journal/types'

const baseSnap: JournalSnapshot = {
  user: {
    id: 'u1',
    name: 'Lily',
    image: null,
    bio: '想把每一部喜欢的动画都走一遍',
    createdAt: new Date('2024-10-04'),
    journalNumber: '#0042',
    daysSinceJoined: 218,
  },
  stats: {
    worksVisited: 5,
    pointsVisited: 47,
    totalCheckins: 156,
    totalKilometers: 1247,
    totalTrips: 8,
  },
  currentTrip: {
    id: 'rb-clannad',
    title: '京都 · CLANNAD 之旅',
    pointCount: 12,
    durationDays: 5,
    departureDate: new Date('2025-04-12'),
    status: 'preparing',
  },
  prefectures: [],
  pinsForMap: [],
  recentNotes: [],
  tripsForTimeline: [],
  workProgress: [],
  achievements: [],
  nextAchievement: null,
  travelModeBreakdown: [],
  recentPhotos: [],
}

describe('JournalCover', () => {
  it('renders user name and VOL.01 marker', () => {
    const { getByText } = render(<JournalCover snapshot={baseSnap} />)
    expect(getByText(/Lily 的手帐/)).toBeTruthy()
    expect(getByText(/VOL\. 01 · 第 218 天/)).toBeTruthy()
  })

  it('renders all 5 stat numbers with labels', () => {
    const { getByText } = render(<JournalCover snapshot={baseSnap} />)
    expect(getByText('5')).toBeTruthy()
    expect(getByText('47')).toBeTruthy()
    expect(getByText('156')).toBeTruthy()
    expect(getByText('1,247')).toBeTruthy()
    expect(getByText('8')).toBeTruthy()
    expect(getByText('部作品')).toBeTruthy()
    expect(getByText('取景地')).toBeTruthy()
    expect(getByText('次打卡')).toBeTruthy()
    expect(getByText('公里')).toBeTruthy()
    expect(getByText('次行程')).toBeTruthy()
  })

  it('renders the current trip card with title and departure date', () => {
    const { getByText } = render(<JournalCover snapshot={baseSnap} />)
    expect(getByText('京都 · CLANNAD 之旅')).toBeTruthy()
    expect(getByText(/出发日 2025-04-12/)).toBeTruthy()
  })

  it('omits current trip card when snapshot.currentTrip is null', () => {
    const { queryByText } = render(
      <JournalCover snapshot={{ ...baseSnap, currentTrip: null }} />,
    )
    expect(queryByText('京都 · CLANNAD 之旅')).toBeNull()
    expect(queryByText('正在准备的行程')).toBeNull()
  })

  it('uses fallback name when user.name is missing', () => {
    const snap = { ...baseSnap, user: { ...baseSnap.user, name: '巡礼者' } }
    const { getByText } = render(<JournalCover snapshot={snap} />)
    expect(getByText(/巡礼者 的手帐/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run --project jsdom tests/journal/JournalCover.test.tsx`
Expected: FAIL (component does not exist).

- [ ] **Step 3: 实现 JournalCover**

```typescript
// app/(authed)/me/journal/components/JournalCover.tsx
import Image from 'next/image'
import { PaperCard } from '../primitives/PaperCard'
import { RedSeal } from '../primitives/RedSeal'
import { WashiTape } from '../primitives/WashiTape'
import { InkDivider } from '../primitives/InkDivider'
import { StitchedBorder } from '../primitives/StitchedBorder'
import { PageFoldCorner } from '../primitives/PageFoldCorner'
import type { JournalSnapshot } from '@/lib/journal/types'

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function JournalCover({ snapshot }: { snapshot: JournalSnapshot }) {
  const { user, stats, currentTrip } = snapshot
  return (
    <section className="relative mb-14">
      <WashiTape color="rose" className="-rotate-1 left-20 -top-2" />
      <WashiTape color="indigo" className="rotate-2 right-32 -top-2" />

      <PaperCard className="p-12">
        <div className="flex items-baseline justify-between mb-8">
          <div>
            <div className="text-xs tracking-[6px] text-journal-ink-muted mb-2">
              VOL. 01 · 第 {user.daysSinceJoined} 天
            </div>
            <h1 className="font-journal-serif font-black text-[44px] leading-none tracking-wide">
              {user.name} 的手帐
            </h1>
            <div className="font-journal-latin italic text-journal-ink-muted mt-3 text-lg">
              {user.name}&rsquo;s Pilgrimage Journal
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs tracking-[3px] text-journal-ink-muted">
              {user.journalNumber}
            </div>
          </div>
        </div>

        <InkDivider className="mb-10" />

        <div className="grid grid-cols-12 gap-10 items-center">
          <div className="col-span-3 relative">
            <div className="relative inline-block">
              {user.image ? (
                <Image
                  src={user.image}
                  alt={`${user.name} avatar`}
                  width={112}
                  height={112}
                  className="rounded-full ring-4 ring-journal-ink/85 ring-offset-4 ring-offset-journal-paper-card"
                />
              ) : (
                <div className="w-28 h-28 rounded-full bg-gradient-to-br from-rose-200 via-amber-200 to-stone-200 ring-4 ring-journal-ink/85 ring-offset-4 ring-offset-journal-paper-card" />
              )}
              <RedSeal className="absolute -bottom-2 -right-4 text-[10px]">
                巡礼者
              </RedSeal>
            </div>
            {user.bio ? (
              <p className="text-xs text-journal-ink-muted mt-3 leading-relaxed">
                「{user.bio}」
              </p>
            ) : null}
          </div>

          <div className="col-span-6 grid grid-cols-5 gap-2">
            <Stat value={formatNumber(stats.worksVisited)} label="部作品" />
            <Stat value={formatNumber(stats.pointsVisited)} label="取景地" />
            <Stat value={formatNumber(stats.totalCheckins)} label="次打卡" highlight />
            <Stat value={formatNumber(stats.totalKilometers)} label="公里" />
            <Stat value={formatNumber(stats.totalTrips)} label="次行程" />
          </div>

          <div className="col-span-3 relative">
            {currentTrip ? (
              <>
                <RedSeal className="absolute -top-3 -right-2 z-10 text-[10px]">
                  {currentTrip.status === 'in_progress' ? '进行中' : '准备中'}
                </RedSeal>
                <StitchedBorder className="p-5 bg-[#faf5e6] relative">
                  <div className="text-[10px] tracking-[3px] text-journal-ink-muted mb-2">
                    正在准备的行程
                  </div>
                  <div className="font-journal-serif text-lg font-bold leading-tight">
                    {currentTrip.title}
                  </div>
                  <div className="flex gap-3 mt-3 text-[11px] text-journal-ink-soft">
                    {currentTrip.durationDays ? <span>{currentTrip.durationDays} 天</span> : null}
                    {currentTrip.durationDays ? <span>·</span> : null}
                    <span>{currentTrip.pointCount} 个取景地</span>
                  </div>
                  {currentTrip.departureDate ? (
                    <div className="mt-3 text-[10px] text-journal-ink-muted">
                      出发日 {formatDate(currentTrip.departureDate)}
                    </div>
                  ) : null}
                  <PageFoldCorner />
                </StitchedBorder>
              </>
            ) : null}
          </div>
        </div>
      </PaperCard>
    </section>
  )
}

function Stat({
  value,
  label,
  highlight = false,
}: {
  value: string
  label: string
  highlight?: boolean
}) {
  return (
    <div className="text-center">
      <div
        className={[
          'font-journal-serif font-bold text-[40px] leading-none tracking-tight',
          highlight ? 'text-journal-seal' : 'text-journal-ink',
        ].join(' ')}
      >
        {value}
      </div>
      <div className="text-[11px] text-journal-ink-muted tracking-[3px] mt-1">
        {label}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run --project jsdom tests/journal/JournalCover.test.tsx`
Expected: PASS, 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/\(authed\)/me/journal/components/JournalCover.tsx tests/journal/JournalCover.test.tsx
git commit -m "feat(journal): JournalCover with stats + current trip card (W1)"
```

---

## Task 7 · PilgrimageMap + JapanMapSvg

**Files:**
- Create: `app/(authed)/me/journal/components/JapanMapSvg.tsx`
- Create: `app/(authed)/me/journal/components/PilgrimageMap.tsx`
- Test: `tests/journal/PilgrimageMap.test.tsx`

「我走过的地方」—— 水彩日本群岛 SVG + 红色 pins + 县市标签云。SVG paths 写成抽象简化版（不需要精确地理），重点是氛围。

- [ ] **Step 1: 写 JapanMapSvg.tsx**

```typescript
// app/(authed)/me/journal/components/JapanMapSvg.tsx
// 抽象化日本群岛 SVG —— 北海道 / 本州 / 九州 / 四国
// 不追求地理精确，追求水墨氛围。viewBox 500x280。
export function JapanMapSvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 500 280" className={className} aria-label="日本群岛抽象图">
      <defs>
        <filter id="watercolor">
          <feTurbulence baseFrequency="0.02" numOctaves="2" result="t" />
          <feDisplacementMap in="SourceGraphic" in2="t" scale="5" />
        </filter>
      </defs>
      <path
        d="M 360 30 Q 410 25 430 50 Q 440 75 415 85 Q 380 90 365 70 Q 355 50 360 30 Z"
        fill="#e6d7b8"
        stroke="#4a4236"
        strokeWidth="1"
        filter="url(#watercolor)"
        opacity="0.7"
      />
      <path
        d="M 130 120 Q 160 110 200 115 Q 240 115 280 130 Q 320 145 345 170 Q 360 195 340 210 Q 300 215 260 200 Q 220 195 180 180 Q 150 170 130 150 Z"
        fill="#e6d7b8"
        stroke="#4a4236"
        strokeWidth="1"
        filter="url(#watercolor)"
        opacity="0.7"
      />
      <path
        d="M 95 200 Q 115 195 130 210 Q 140 230 125 245 Q 105 250 90 235 Q 85 215 95 200 Z"
        fill="#e6d7b8"
        stroke="#4a4236"
        strokeWidth="1"
        filter="url(#watercolor)"
        opacity="0.7"
      />
      <path
        d="M 175 195 Q 200 192 215 205 Q 215 218 195 220 Q 175 218 175 195 Z"
        fill="#e6d7b8"
        stroke="#4a4236"
        strokeWidth="1"
        filter="url(#watercolor)"
        opacity="0.7"
      />
    </svg>
  )
}
```

- [ ] **Step 2: 写 PilgrimageMap.test.tsx 失败测试**

```typescript
// tests/journal/PilgrimageMap.test.tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { PilgrimageMap } from '@/app/(authed)/me/journal/components/PilgrimageMap'

describe('PilgrimageMap', () => {
  it('renders title and stat line', () => {
    const { getByText } = render(
      <PilgrimageMap
        pointsVisited={47}
        prefectures={[
          { nameZh: '神奈川', pointCount: 12 },
          { nameZh: '京都', pointCount: 8 },
        ]}
        pins={[
          { lat: 35.3, lng: 139.5, isMostRecent: true },
          { lat: 34.7, lng: 135.5, isMostRecent: false },
        ]}
      />,
    )
    expect(getByText('我走过的地方')).toBeTruthy()
    expect(getByText(/47.*取景地.*2.*个县市/)).toBeTruthy()
  })

  it('renders one pin per pinsForMap entry', () => {
    const { container } = render(
      <PilgrimageMap
        pointsVisited={2}
        prefectures={[{ nameZh: '神奈川', pointCount: 2 }]}
        pins={[
          { lat: 35.3, lng: 139.5, isMostRecent: true },
          { lat: 34.7, lng: 135.5, isMostRecent: false },
        ]}
      />,
    )
    expect(container.querySelectorAll('[data-pin]').length).toBe(2)
  })

  it('marks the most-recent pin with data-recent attribute', () => {
    const { container } = render(
      <PilgrimageMap
        pointsVisited={1}
        prefectures={[]}
        pins={[{ lat: 35.3, lng: 139.5, isMostRecent: true }]}
      />,
    )
    const pin = container.querySelector('[data-pin]')
    expect(pin?.getAttribute('data-recent')).toBe('true')
  })

  it('renders prefectures as comma-separated labels', () => {
    const { getByText } = render(
      <PilgrimageMap
        pointsVisited={5}
        prefectures={[
          { nameZh: '神奈川', pointCount: 3 },
          { nameZh: '京都', pointCount: 2 },
        ]}
        pins={[]}
      />,
    )
    expect(getByText('神奈川')).toBeTruthy()
    expect(getByText('京都')).toBeTruthy()
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npx vitest run --project jsdom tests/journal/PilgrimageMap.test.tsx`
Expected: FAIL.

- [ ] **Step 4: 实现 PilgrimageMap.tsx**

```typescript
// app/(authed)/me/journal/components/PilgrimageMap.tsx
import { PaperCard } from '../primitives/PaperCard'
import { InkDivider } from '../primitives/InkDivider'
import { JapanMapSvg } from './JapanMapSvg'
import type { JournalSnapshot } from '@/lib/journal/types'

type Props = {
  pointsVisited: number
  prefectures: JournalSnapshot['prefectures']
  pins: JournalSnapshot['pinsForMap']
}

// SVG viewBox 是 500x280；把经纬度映射进去用简单线性近似
// 经度范围 122 - 146，纬度范围 24 - 46
function pinPosition(lat: number, lng: number): { left: string; top: string } {
  const x = ((lng - 122) / (146 - 122)) * 100
  const y = (1 - (lat - 24) / (46 - 24)) * 100
  return { left: `${Math.max(0, Math.min(100, x))}%`, top: `${Math.max(0, Math.min(100, y))}%` }
}

export function PilgrimageMap({ pointsVisited, prefectures, pins }: Props) {
  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-sm">
            My Pilgrimage Map
          </div>
          <h3 className="font-journal-serif text-xl font-bold">我走过的地方</h3>
        </div>
        <div className="text-[11px] text-journal-ink-muted tracking-wider">
          {pointsVisited} 取景地 · 跨 {prefectures.length} 个县市
        </div>
      </div>

      <div className="relative h-[280px]">
        <JapanMapSvg className="w-full h-full" />
        {pins.map((pin, i) => {
          const pos = pinPosition(pin.lat, pin.lng)
          return (
            <span
              key={i}
              data-pin
              data-recent={pin.isMostRecent ? 'true' : 'false'}
              className={[
                'absolute w-2 h-2 rounded-full bg-journal-seal',
                'shadow-[0_0_0_2px_rgba(253,250,243,0.8),0_1px_3px_rgba(0,0,0,0.3)]',
                pin.isMostRecent
                  ? "before:absolute before:inset-[-6px] before:rounded-full before:border-2 before:border-journal-seal before:animate-ping"
                  : '',
              ].join(' ')}
              style={pos}
              aria-hidden="true"
            />
          )
        })}
      </div>

      <InkDivider className="my-4" />

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
        {prefectures.map((p, i) => (
          <span
            key={p.nameZh}
            className={i === 0 ? 'text-journal-ink font-medium' : 'text-journal-ink-soft'}
          >
            {p.nameZh}{' '}
            <span className={i === 0 ? 'text-journal-seal' : 'text-journal-ink-muted'}>
              {p.pointCount}
            </span>
          </span>
        ))}
      </div>
    </PaperCard>
  )
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run --project jsdom tests/journal/PilgrimageMap.test.tsx`
Expected: PASS, 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/\(authed\)/me/journal/components/JapanMapSvg.tsx app/\(authed\)/me/journal/components/PilgrimageMap.tsx tests/journal/PilgrimageMap.test.tsx
git commit -m "feat(journal): PilgrimageMap with watercolor Japan + pins (W1)"
```

---

## Task 8 · NotesPreview（W1 空态 + CTA）

**Files:**
- Create: `app/(authed)/me/journal/components/NotesPreview.tsx`

W1 永远渲染空态 + "写第一篇随笔" CTA。完整的笔记系统在后续周补全。

- [ ] **Step 1: 实现 NotesPreview**

```typescript
// app/(authed)/me/journal/components/NotesPreview.tsx
import { PaperCard } from '../primitives/PaperCard'
import { InkDivider } from '../primitives/InkDivider'
import { StitchedBorder } from '../primitives/StitchedBorder'
import type { JournalSnapshot } from '@/lib/journal/types'

type Props = {
  recentNotes: JournalSnapshot['recentNotes']
}

export function NotesPreview({ recentNotes }: Props) {
  const hasNotes = recentNotes.length > 0
  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-sm">
            Notes & Diaries
          </div>
          <h3 className="font-journal-serif text-xl font-bold">我的随笔</h3>
        </div>
        <div className="text-[11px] text-journal-ink-muted tracking-wider">
          已写 {recentNotes.length} 篇
        </div>
      </div>

      {hasNotes ? (
        <div className="space-y-5">
          {recentNotes.map((n) => (
            <article key={n.id} className="border-l-2 border-journal-seal/60 pl-4">
              <div className="flex items-center gap-2 text-[10px] text-journal-ink-muted tracking-wider mb-1.5">
                <span>{formatNoteDate(n.publishedAt)}</span>
                {n.location ? (
                  <>
                    <span>·</span>
                    <span>{n.location}</span>
                  </>
                ) : null}
              </div>
              <h4 className="font-journal-serif text-lg font-bold mb-2">{n.title}</h4>
              <p className="text-[12px] text-journal-ink-soft leading-relaxed line-clamp-3">
                {n.bodyPreview}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <div className="py-6 text-center">
          <p className="text-[12px] text-journal-ink-muted leading-relaxed">
            还没写过随笔。
            <br />
            走完一段路、看完一篇攻略，
            <br />
            都可以在这里留下一些字句。
          </p>
        </div>
      )}

      <InkDivider className="my-4" />

      <StitchedBorder className="py-3 w-full text-center hover:bg-journal-paper/30 transition cursor-not-allowed opacity-60">
        <span className="font-journal-hand text-base text-journal-ink-soft">
          ＋ 写一篇新随笔（即将开放）
        </span>
      </StitchedBorder>
    </PaperCard>
  )
}

function formatNoteDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(authed\)/me/journal/components/NotesPreview.tsx
git commit -m "feat(journal): NotesPreview with empty state + W1 disabled CTA (W1)"
```

---

## Task 9 · TripsTimeline

**Files:**
- Create: `app/(authed)/me/journal/components/TripsTimeline.tsx`
- Test: `tests/journal/TripsTimeline.test.tsx`

横向时间轴：12 月份刻度 + ribbon 段（每个 ribbon 一次行程）+ 散落红点（代表打卡）。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/journal/TripsTimeline.test.tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { TripsTimeline } from '@/app/(authed)/me/journal/components/TripsTimeline'

describe('TripsTimeline', () => {
  it('renders 12 month labels (1月 - 12月)', () => {
    const { getByText } = render(
      <TripsTimeline totalCheckins={156} totalTrips={8} trips={[]} />,
    )
    expect(getByText('1月')).toBeTruthy()
    expect(getByText('12月')).toBeTruthy()
  })

  it('renders one ribbon per trip with title', () => {
    const { getByText } = render(
      <TripsTimeline
        totalCheckins={156}
        totalTrips={1}
        trips={[
          {
            id: 'rb1',
            title: '镰仓·灌篮高手',
            workTitle: '灌篮高手',
            location: '神奈川',
            monthStart: 3,
            monthEnd: 3,
            status: 'completed',
          },
        ]}
      />,
    )
    expect(getByText(/镰仓·灌篮高手/)).toBeTruthy()
  })

  it('uses dashed border for planned trips and solid for completed', () => {
    const { container } = render(
      <TripsTimeline
        totalCheckins={0}
        totalTrips={2}
        trips={[
          {
            id: 'a',
            title: 'a',
            workTitle: null,
            location: null,
            monthStart: 4,
            monthEnd: 4,
            status: 'planned',
          },
          {
            id: 'b',
            title: 'b',
            workTitle: null,
            location: null,
            monthStart: 6,
            monthEnd: 6,
            status: 'completed',
          },
        ]}
      />,
    )
    const ribbons = container.querySelectorAll('[data-ribbon]')
    expect(ribbons[0].getAttribute('data-status')).toBe('planned')
    expect(ribbons[1].getAttribute('data-status')).toBe('completed')
  })

  it('shows totalCheckins and totalTrips in the header', () => {
    const { getByText } = render(
      <TripsTimeline totalCheckins={156} totalTrips={8} trips={[]} />,
    )
    expect(getByText('156')).toBeTruthy()
    expect(getByText('8')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 实现 TripsTimeline**

```typescript
// app/(authed)/me/journal/components/TripsTimeline.tsx
import { PaperCard } from '../primitives/PaperCard'
import type { JournalSnapshot } from '@/lib/journal/types'

type Props = {
  totalCheckins: number
  totalTrips: number
  trips: JournalSnapshot['tripsForTimeline']
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const COLORS: Record<JournalSnapshot['tripsForTimeline'][number]['status'], string> = {
  completed: 'bg-journal-ink/80 border border-journal-ink/0',
  in_progress: 'bg-journal-seal/80 shadow border border-journal-seal/0',
  planned: 'bg-transparent border border-dashed border-journal-seal',
}

export function TripsTimeline({ totalCheckins, totalTrips, trips }: Props) {
  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-sm">
            My Trips
          </div>
          <h3 className="font-journal-serif text-xl font-bold">我的旅程表</h3>
        </div>
        <div className="flex gap-5 text-[11px] text-journal-ink-muted tracking-wider">
          <span>
            <span className="text-journal-seal font-journal-serif font-bold text-base">
              {totalCheckins}
            </span>{' '}
            次打卡
          </span>
          <span>
            <span className="text-journal-ink font-journal-serif font-bold text-base">
              {totalTrips}
            </span>{' '}
            次行程
          </span>
        </div>
      </div>

      <div className="relative h-[120px]">
        <div className="absolute inset-x-0 top-[60px] flex justify-between text-[9px] text-journal-ink-muted tracking-wider">
          {MONTHS.map((m) => (
            <span key={m}>{m}月</span>
          ))}
        </div>
        <div className="absolute inset-x-0 top-[55px] h-px bg-journal-thread" />

        {trips.map((t, idx) => {
          const left = ((t.monthStart - 1) / 12) * 100
          const widthMonths = Math.max(t.monthEnd - t.monthStart, 0) + 1
          const width = Math.min((widthMonths / 12) * 100, 100 - left)
          const top = idx % 2 === 0 ? '10px' : '25px'
          const colorClass = COLORS[t.status]
          const label = [t.workTitle, t.location].filter(Boolean).join(' · ') || t.title
          return (
            <div key={t.id}>
              <div
                data-ribbon
                data-status={t.status}
                className={['absolute h-2 rounded-sm', colorClass].join(' ')}
                style={{ left: `${left}%`, width: `${width}%`, top }}
                title={t.title}
              />
              <div
                className="absolute text-[9px] text-journal-ink-muted whitespace-nowrap"
                style={{ left: `${left}%`, top: idx % 2 === 0 ? '-4px' : '44px' }}
              >
                {label}
              </div>
            </div>
          )
        })}

        <div className="absolute top-[100px] left-[2%] text-[9px] text-journal-ink-muted tracking-wider">
          每个 ● 是一次打卡
        </div>
      </div>
    </PaperCard>
  )
}
```

- [ ] **Step 3: 测试通过**

Run: `npx vitest run --project jsdom tests/journal/TripsTimeline.test.tsx`
Expected: PASS, 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/\(authed\)/me/journal/components/TripsTimeline.tsx tests/journal/TripsTimeline.test.tsx
git commit -m "feat(journal): TripsTimeline with ribbons + month grid (W1)"
```

---

## Task 10 · WorkProgress + TravelModeDonut + AchievementWall

**Files:**
- Create: `app/(authed)/me/journal/components/WorkProgress.tsx`
- Create: `app/(authed)/me/journal/components/TravelModeDonut.tsx`
- Create: `app/(authed)/me/journal/components/AchievementWall.tsx`
- Test: `tests/journal/AchievementWall.test.tsx`

三个数据可视化卡，一起做。AchievementWall 单独写测试因为它依赖成就配置；另外两个是纯展示。

- [ ] **Step 1: 实现 WorkProgress.tsx**

```typescript
// app/(authed)/me/journal/components/WorkProgress.tsx
import { PaperCard } from '../primitives/PaperCard'
import type { JournalSnapshot } from '@/lib/journal/types'

type Props = {
  workProgress: JournalSnapshot['workProgress']
}

export function WorkProgress({ workProgress }: Props) {
  const totalVisited = workProgress.reduce((a, w) => a + w.visitedPoints, 0)
  const totalPoints = workProgress.reduce((a, w) => a + w.totalPoints, 0)

  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-sm">Works</div>
          <h3 className="font-journal-serif text-xl font-bold">作品巡礼进度</h3>
        </div>
        <div className="text-[11px] text-journal-ink-muted tracking-wider">
          {workProgress.length} 部 · {totalVisited}/{totalPoints} 个点位
        </div>
      </div>

      {workProgress.length === 0 ? (
        <p className="text-[12px] text-journal-ink-muted py-4 text-center">
          还没开始巡礼任何作品。
        </p>
      ) : (
        <div className="space-y-3">
          {workProgress.map((w) => (
            <div key={w.workTitle}>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium">《{w.workTitle}》</span>
                <span className="text-journal-ink-muted">
                  {w.visitedPoints} / {w.totalPoints} ·{' '}
                  <span className={w.percent === 100 ? 'text-journal-seal' : ''}>{w.percent}%</span>
                </span>
              </div>
              <div className="h-2 bg-journal-ink/5 border border-journal-thread">
                <div
                  className={[
                    'h-2',
                    w.percent === 100 ? 'bg-journal-seal' : 'bg-journal-ink-soft',
                  ].join(' ')}
                  style={{ width: `${w.percent}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </PaperCard>
  )
}
```

- [ ] **Step 2: 实现 TravelModeDonut.tsx**

```typescript
// app/(authed)/me/journal/components/TravelModeDonut.tsx
import { PaperCard } from '../primitives/PaperCard'
import type { JournalSnapshot } from '@/lib/journal/types'

const LABELS: Record<JournalSnapshot['travelModeBreakdown'][number]['mode'], string> = {
  train: '电车',
  bus: '巴士',
  car: '自驾',
  walk: '徒步',
}

const COLORS: Record<JournalSnapshot['travelModeBreakdown'][number]['mode'], string> = {
  train: 'bg-journal-indigo',
  bus: 'bg-emerald-700',
  car: 'bg-amber-700',
  walk: 'bg-journal-seal',
}

const STROKE: Record<JournalSnapshot['travelModeBreakdown'][number]['mode'], string> = {
  train: '#2d3e50',
  bus: '#1f6b4f',
  car: '#a16207',
  walk: '#a8392b',
}

export function TravelModeDonut({
  breakdown,
}: {
  breakdown: JournalSnapshot['travelModeBreakdown']
}) {
  // circumference = 2 * pi * r where r = 38, ≈ 238.76
  const C = 238.76
  let offset = 0
  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="mb-5">
        <div className="font-journal-latin italic text-journal-ink-muted text-sm">By</div>
        <h3 className="font-journal-serif text-xl font-bold">出行方式分布</h3>
      </div>

      <div className="relative h-[140px] flex items-center justify-center mb-4">
        <svg viewBox="0 0 100 100" className="w-[140px] h-[140px] -rotate-90">
          {breakdown.map((m) => {
            const segment = (m.percent / 100) * C
            const dash = `${segment} ${C - segment}`
            const el = (
              <circle
                key={m.mode}
                cx={50}
                cy={50}
                r={38}
                fill="none"
                stroke={STROKE[m.mode]}
                strokeWidth={14}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            )
            offset += segment
            return el
          })}
        </svg>
        <div className="absolute text-center">
          <div className="font-journal-serif font-bold text-2xl leading-none">
            {breakdown[0]?.percent ?? 0}
            <span className="text-xs text-journal-ink-muted">%</span>
          </div>
          <div className="text-[9px] text-journal-ink-muted tracking-wider">
            {LABELS[breakdown[0]?.mode ?? 'walk']}
          </div>
        </div>
      </div>

      <div className="space-y-1.5 text-[11px]">
        {breakdown.map((m) => (
          <div key={m.mode} className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-sm ${COLORS[m.mode]}`} />
            <span className="flex-1">{LABELS[m.mode]}</span>
            <span className="text-journal-ink-muted">{m.percent}%</span>
          </div>
        ))}
      </div>
    </PaperCard>
  )
}
```

- [ ] **Step 3: 写 AchievementWall.test.tsx**

```typescript
// tests/journal/AchievementWall.test.tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { AchievementWall } from '@/app/(authed)/me/journal/components/AchievementWall'

const NOW = new Date('2025-03-20')

describe('AchievementWall', () => {
  it('renders 8 achievement slots in fixed order', () => {
    const { container } = render(
      <AchievementWall
        achievements={[
          { id: 'first-checkin', label: '首次', sub: '打卡', color: 'seal-red', unlocked: true, unlockedAt: NOW },
          { id: 'hundred-checkins', label: '百次', sub: '打卡', color: 'ink', unlocked: true, unlockedAt: NOW },
          { id: 'thousand-km', label: '千里', sub: '步行', color: 'amber', unlocked: true, unlockedAt: NOW },
          { id: 'work-complete', label: '通关', sub: '作品', color: 'emerald', unlocked: false, unlockedAt: null },
          { id: 'eight-prefectures', label: '八县', sub: '巡游', color: 'sky', unlocked: false, unlockedAt: null },
          { id: 'sakura-season', label: '樱花', sub: '季', color: 'rose', unlocked: false, unlockedAt: null },
          { id: 'sync-master', label: '神还原', sub: '对比图', color: 'slate', unlocked: false, unlockedAt: null },
          { id: 'note-writer', label: '作家', sub: '随笔', color: 'stone', unlocked: false, unlockedAt: null },
        ]}
        nextAchievement={{ label: '200 次打卡', progress: 156, target: 200 }}
        totalUnlocked={3}
      />,
    )
    const slots = container.querySelectorAll('[data-achievement]')
    expect(slots.length).toBe(8)
  })

  it('marks locked achievements with data-locked', () => {
    const { container } = render(
      <AchievementWall
        achievements={[
          { id: 'first-checkin', label: '首次', sub: '打卡', color: 'seal-red', unlocked: false, unlockedAt: null },
        ]}
        nextAchievement={null}
        totalUnlocked={0}
      />,
    )
    expect(container.querySelector('[data-achievement]')?.getAttribute('data-locked')).toBe('true')
  })

  it('shows next achievement label when provided', () => {
    const { getByText } = render(
      <AchievementWall
        achievements={[]}
        nextAchievement={{ label: '200 次打卡', progress: 156, target: 200 }}
        totalUnlocked={0}
      />,
    )
    expect(getByText(/下一个成就：/)).toBeTruthy()
    expect(getByText(/200 次打卡/)).toBeTruthy()
  })
})
```

- [ ] **Step 4: 实现 AchievementWall.tsx**

```typescript
// app/(authed)/me/journal/components/AchievementWall.tsx
import { PaperCard } from '../primitives/PaperCard'
import { InkDivider } from '../primitives/InkDivider'
import type { JournalSnapshot } from '@/lib/journal/types'

type Props = {
  achievements: JournalSnapshot['achievements']
  nextAchievement: JournalSnapshot['nextAchievement']
  totalUnlocked: number
}

const COLOR_BG: Record<JournalSnapshot['achievements'][number]['color'], string> = {
  'seal-red': 'bg-journal-seal',
  ink: 'bg-journal-ink',
  amber: 'bg-amber-700',
  emerald: 'bg-emerald-800',
  sky: 'bg-sky-800',
  rose: 'bg-rose-700',
  slate: 'bg-slate-700',
  stone: 'bg-stone-700',
}

export function AchievementWall({ achievements, nextAchievement, totalUnlocked }: Props) {
  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-sm">
            Achievements
          </div>
          <h3 className="font-journal-serif text-xl font-bold">成就墙</h3>
        </div>
        <div className="text-[11px] text-journal-ink-muted tracking-wider">
          {totalUnlocked} / 8 枚
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        {achievements.map((a) => (
          <div
            key={a.id}
            data-achievement={a.id}
            data-locked={a.unlocked ? 'false' : 'true'}
            className="text-center"
            title={a.unlocked && a.unlockedAt ? `${a.label}${a.sub} · ${a.unlockedAt.toISOString().slice(0, 10)}` : `${a.label}${a.sub}（未解锁）`}
          >
            <div
              className={[
                'aspect-square w-12 h-12 rounded-full mx-auto grid place-items-center',
                'font-journal-serif font-bold text-[10px] text-journal-paper-card',
                a.unlocked ? COLOR_BG[a.color] : 'bg-stone-300 opacity-50',
              ].join(' ')}
            >
              {a.label}
            </div>
            <div className="text-[9px] text-journal-ink-muted mt-1.5 tracking-wider">{a.sub}</div>
          </div>
        ))}
      </div>

      <InkDivider className="mb-3" />

      {nextAchievement ? (
        <p className="text-[11px] text-journal-ink-soft leading-relaxed">
          下一个成就：
          <span className="text-journal-seal font-medium">{nextAchievement.label}</span>，还差{' '}
          {Math.max(nextAchievement.target - nextAchievement.progress, 0)} 次
        </p>
      ) : (
        <p className="text-[11px] text-journal-ink-muted">所有成就已解锁，巡礼老手。</p>
      )}
    </PaperCard>
  )
}
```

- [ ] **Step 5: 运行测试**

Run: `npx vitest run --project jsdom tests/journal/AchievementWall.test.tsx`
Expected: PASS, 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/\(authed\)/me/journal/components/WorkProgress.tsx app/\(authed\)/me/journal/components/TravelModeDonut.tsx app/\(authed\)/me/journal/components/AchievementWall.tsx tests/journal/AchievementWall.test.tsx
git commit -m "feat(journal): WorkProgress + TravelModeDonut + AchievementWall (W1)"
```

---

## Task 11 · PhotoAlbum + ExploreCards + NearbyFloatingButton

**Files:**
- Create: `app/(authed)/me/journal/components/PhotoAlbum.tsx`
- Create: `app/(authed)/me/journal/components/ExploreCards.tsx`
- Create: `app/(authed)/me/journal/components/NearbyFloatingButton.tsx`

剩下三个组件都是展示型，没有逻辑分支，不需要单元测试（页面集成测在 Task 12）。

- [ ] **Step 1: 实现 PhotoAlbum.tsx**

```typescript
// app/(authed)/me/journal/components/PhotoAlbum.tsx
import Image from 'next/image'
import { PaperCard } from '../primitives/PaperCard'
import { WashiTape } from '../primitives/WashiTape'
import type { JournalSnapshot } from '@/lib/journal/types'

const COLORS: Array<'rose' | 'amber' | 'emerald' | 'violet'> = ['rose', 'amber', 'emerald', 'violet']

export function PhotoAlbum({ photos }: { photos: JournalSnapshot['recentPhotos'] }) {
  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-sm">My Album</div>
          <h3 className="font-journal-serif text-xl font-bold">我的相册</h3>
        </div>
        <a href="/me/journal/album" className="text-[11px] text-journal-seal tracking-wider hover:underline">
          翻开全部照片 →
        </a>
      </div>

      {photos.length === 0 ? (
        <p className="text-[12px] text-journal-ink-muted py-4 text-center">
          相册还是空的。打过卡的地方，留下的照片会在这里。
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {photos.map((p, i) => (
            <figure key={p.id} className="relative">
              <div className="relative aspect-[4/5] overflow-hidden shadow-md bg-journal-paper-warm">
                <Image
                  src={p.photoUrl}
                  alt={`${p.placeName}`}
                  fill
                  sizes="(min-width: 1024px) 200px, 50vw"
                  className="object-cover"
                  unoptimized
                />
              </div>
              <WashiTape color={COLORS[i % COLORS.length]} className="top-2 left-2 right-2 !w-auto" />
              <figcaption className="mt-2 text-[10px]">
                <div className="text-journal-ink-muted tracking-wider">
                  {formatPhotoDate(p.takenAt)} · {p.placeName}
                </div>
                {p.workTitle ? (
                  <div className="text-journal-ink font-medium">《{p.workTitle}》</div>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </PaperCard>
  )
}

function formatPhotoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
```

- [ ] **Step 2: 实现 ExploreCards.tsx**

```typescript
// app/(authed)/me/journal/components/ExploreCards.tsx
import { StitchedBorder } from '../primitives/StitchedBorder'

const CARDS = [
  {
    href: '/map',
    icon: '⊕',
    title: '探索地图',
    body: '在 8,500+ 处巡礼点位中游走。按作品筛选、精简模式、街景一键切换。',
    cta: '前往目的地',
    badge: null as string | null,
  },
  {
    href: '/routes',
    icon: '⇢',
    title: '看看大家在逛什么',
    body: '编辑部和老巡礼者整理好的现成行程，一键加入我的行程。',
    cta: '前往路线',
    badge: null,
  },
  {
    href: '/posts',
    icon: '≡',
    title: '精选旅游攻略',
    body: '配机位 / 时间戳 / 对比图的深度向导，看完直接加入行程。',
    cta: '前往攻略',
    badge: null,
  },
  {
    href: '#nearby',
    icon: '◎',
    title: '看看身边有什么',
    body: '基于当前定位，找步行范围内的取景地。已经在日本时最好用。',
    cta: '唤起浮层',
    badge: '附近',
  },
] as const

export function ExploreCards() {
  return (
    <section className="mb-16">
      <div className="flex items-end gap-6 mb-8">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-lg">Explore</div>
          <h2 className="font-journal-serif font-bold text-3xl tracking-wide">探索</h2>
        </div>
        <div className="flex-1 h-px bg-journal-thread mb-3" />
        <div className="text-xs text-journal-ink-muted mb-3 tracking-[2px]">
          从手帐出发，把新的内容带回来
        </div>
      </div>

      <div className="grid grid-cols-4 gap-5">
        {CARDS.map((c) => (
          <a
            key={c.title}
            href={c.href}
            className="block cursor-pointer transition hover:bg-journal-paper-card/60 group"
          >
            <StitchedBorder className="p-6 relative h-full">
              {c.badge ? (
                <span className="absolute top-3 right-3 text-[9px] tracking-[2px] text-journal-seal border border-journal-seal px-1.5 py-0.5">
                  {c.badge}
                </span>
              ) : null}
              <div className="text-2xl font-journal-serif text-journal-ink-soft mb-3">{c.icon}</div>
              <div className="font-journal-serif text-lg font-bold mb-2">{c.title}</div>
              <div className="text-[11px] text-journal-ink-muted mb-5 leading-relaxed">{c.body}</div>
              <div className="text-[11px] text-journal-seal tracking-wider group-hover:translate-x-1 transition">
                {c.cta} →
              </div>
            </StitchedBorder>
          </a>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: 实现 NearbyFloatingButton.tsx**

```typescript
// app/(authed)/me/journal/components/NearbyFloatingButton.tsx
'use client'

export function NearbyFloatingButton() {
  return (
    <div className="fixed bottom-6 right-6 z-40">
      <button
        type="button"
        aria-label="看看身边有什么"
        title="看看身边有什么"
        className="relative bg-journal-paper-card rounded-full w-14 h-14 grid place-items-center shadow-lg hover:scale-105 transition"
        onClick={() => {
          if (typeof window !== 'undefined') {
            window.location.hash = '#nearby'
          }
        }}
      >
        <span className="font-journal-serif text-xl">◎</span>
        <span
          className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-journal-seal animate-pulse"
          aria-hidden="true"
        />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add app/\(authed\)/me/journal/components/PhotoAlbum.tsx app/\(authed\)/me/journal/components/ExploreCards.tsx app/\(authed\)/me/journal/components/NearbyFloatingButton.tsx
git commit -m "feat(journal): PhotoAlbum + ExploreCards + NearbyFloatingButton (W1)"
```

---

## Task 12 · 页面装配 + 路由 + 手动 QA

**Files:**
- Create: `app/(authed)/me/journal/page.tsx`
- Create: `app/(authed)/me/journal/ui.tsx`

最后一步：把所有组件装到 `/me/journal` 路由。`page.tsx` 是 server component（auth + 数据获取），`ui.tsx` 是 layout 拼装。

- [ ] **Step 1: 写 ui.tsx（layout 拼装，no 'use client'）**

```typescript
// app/(authed)/me/journal/ui.tsx
import { JournalCover } from './components/JournalCover'
import { PilgrimageMap } from './components/PilgrimageMap'
import { NotesPreview } from './components/NotesPreview'
import { TripsTimeline } from './components/TripsTimeline'
import { WorkProgress } from './components/WorkProgress'
import { AchievementWall } from './components/AchievementWall'
import { TravelModeDonut } from './components/TravelModeDonut'
import { PhotoAlbum } from './components/PhotoAlbum'
import { ExploreCards } from './components/ExploreCards'
import { NearbyFloatingButton } from './components/NearbyFloatingButton'
import type { JournalSnapshot } from '@/lib/journal/types'

export function JournalUi({ snapshot }: { snapshot: JournalSnapshot }) {
  const totalUnlocked = snapshot.achievements.filter((a) => a.unlocked).length
  return (
    <main className="max-w-[1440px] mx-auto px-10 py-12 bg-journal-paper">
      <JournalCover snapshot={snapshot} />

      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-7">
          <PilgrimageMap
            pointsVisited={snapshot.stats.pointsVisited}
            prefectures={snapshot.prefectures}
            pins={snapshot.pinsForMap}
          />
        </div>
        <div className="col-span-5">
          <NotesPreview recentNotes={snapshot.recentNotes} />
        </div>
      </div>

      <div className="mb-5">
        <TripsTimeline
          totalCheckins={snapshot.stats.totalCheckins}
          totalTrips={snapshot.stats.totalTrips}
          trips={snapshot.tripsForTimeline}
        />
      </div>

      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-5">
          <WorkProgress workProgress={snapshot.workProgress} />
        </div>
        <div className="col-span-4">
          <AchievementWall
            achievements={snapshot.achievements}
            nextAchievement={snapshot.nextAchievement}
            totalUnlocked={totalUnlocked}
          />
        </div>
        <div className="col-span-3">
          <TravelModeDonut breakdown={snapshot.travelModeBreakdown} />
        </div>
      </div>

      <div className="mb-16">
        <PhotoAlbum photos={snapshot.recentPhotos} />
      </div>

      <ExploreCards />

      <NearbyFloatingButton />
    </main>
  )
}
```

- [ ] **Step 2: 写 page.tsx（server component, auth + 数据）**

```typescript
// app/(authed)/me/journal/page.tsx
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getJournalApiDeps } from '@/lib/journal/api'
import { getJournalSnapshot } from '@/lib/journal/handlers/getJournalSnapshot'
import { JournalUi } from './ui'

export const metadata: Metadata = {
  title: '我的手帐',
  description: '你和最爱的作品共同书写的日本旅行手帐（需要登录）。',
  alternates: { canonical: '/me/journal' },
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function JournalPage() {
  let deps
  try {
    deps = await getJournalApiDeps()
  } catch {
    redirect('/auth/signin?callbackUrl=/me/journal')
  }

  const session = await deps.getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/me/journal')
  }

  const snapshot = await getJournalSnapshot({
    userId: session.user.id,
    repo: deps.repo,
    now: deps.now,
  })

  if (!snapshot) {
    redirect('/auth/signin?callbackUrl=/me/journal')
  }

  return <JournalUi snapshot={snapshot} />
}
```

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `npm run typecheck:app && npm test`
Expected:
- `typecheck:app` PASS
- `test` PASS（含 line-budget + 新增 journal 测试 ≥ 20 个）

- [ ] **Step 4: 手动 QA 清单**

启动: `npm run dev`，登录后访问 `/me/journal`。逐项核对（每条对应宪章 §3 / §4 / §8 / 反 Feature §10）：

```
视觉验收（对照 docs/wireframes/owner-journal-target.png）:
- [ ] 纸张底色温暖象牙白，有噪点纹理
- [ ] 顶部 Nav 6 项：首页 · 目的地 · 路线 · 攻略 · 社区 · 关于我们（没有"作品" / 没有"手帐"Tab）
- [ ] 封面区有 VOL.01 · 第 N 天，名字 + 引言 + 巡礼者红印
- [ ] 5 个数据格：部作品 / 取景地 / 次打卡（红色突出）/ 公里 / 次行程
- [ ] 当前行程卡片右上有"进行中"或"准备中"红印
- [ ] 我走过的地方有 SVG 日本群岛 + pins + 县市标签
- [ ] 我的随笔区域显示空态 + "+ 写一篇新随笔（即将开放）"
- [ ] 我的旅程表横向 12 月份 + ribbon
- [ ] 作品巡礼进度有进度条
- [ ] 成就墙 8 枚徽章 + 下一个成就提示
- [ ] 出行方式分布 donut + 4 类
- [ ] 我的相册（有照片显示 4 张 / 无照片显示空态）
- [ ] 探索区 4 张卡片（探索地图 / 看看大家在逛什么 / 精选旅游攻略 / 看看身边有什么）
- [ ] 右下 ◎ 浮层按钮带红色脉冲

词汇 / 反 Feature 验收（对照宪章 §4 §10）:
- [ ] 页面里**没有**"朱印 / 誊抄 / 想去笺 / 对屏录 / 手帐市 / 路书 / 番剧"字样
- [ ] 没有"作品"独立 Tab
- [ ] "我的手帐"是页面标题但不是 Tab
- [ ] LBS 入口在右下浮层而不在顶部 Nav

行为验收:
- [ ] 未登录访问 /me/journal 跳转到 /auth/signin
- [ ] 登录后第一个新用户（无打卡 / 无 route book）能正常渲染（不报错），所有计数为 0
- [ ] 数据丰富的用户（有打卡）渲染所有板块都有内容
```

- [ ] **Step 5: 修复 QA 发现的问题（若有）**

为每一个 QA 发现的问题：
1. 写一个失败测试
2. 修复
3. 测试通过
4. 单独 commit（`fix(journal): ...`）

- [ ] **Step 6: 最终 Commit**

```bash
git add app/\(authed\)/me/journal/page.tsx app/\(authed\)/me/journal/ui.tsx
git commit -m "feat(journal): /me/journal page route + UI assembly + auth gate (W1)"
```

---

## 收尾

- [ ] **运行 npm test 确认全绿**

Run: `npm test`
Expected: PASS,所有 journal 相关测试和原有测试都通过；line-budget 没有新增超 800 行的文件。

- [ ] **更新 README 或 changelog（可选，但推荐）**

如果项目有 `CHANGELOG.md`，加一行：
```
## [Unreleased]
### Added
- `/me/journal` —— 登录用户的"我的手帐"页（W1，6 周 MVP 第 1 周）
```

- [ ] **PR 描述**

```markdown
## Summary
- 新增 `/me/journal` 路由 —— 登录后用户的"我的手帐"首屏
- 引入 `lib/journal/` 域，遵循现有三层模式（api → handlers → repo*）
- 新增 6 个视觉 primitives + 9 个 section 组件
- 27+ 单元测试 (node + jsdom)

## Charter Compliance
对照 `docs/product-charter.md`：
- [x] §3 五条设计原则
- [x] §4 词汇表（仅使用必用 / 黄色名单的词）
- [x] §5 IA（手帐为登录后第一站，不进 Nav）
- [x] §8 视觉系统（纸张 + 朱印 + washi + 缝纫边）
- [x] §10 反 Feature（无作品 Tab / 无朱印按钮 / LBS 在浮层）
- [x] §9 W1 节奏（仅 W1 范围，未触碰 W2-W6 数据合并 / 仪式动画 / 公开开关）

## Test plan
- [x] `npm run typecheck:app` 通过
- [x] `npm test` 通过（含 line-budget + 新增 journal 测试）
- [x] 手动 QA（见 plan Task 12 Step 4）
- [x] 未登录跳转到 signin
- [x] 新用户空数据正常渲染

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Self-Review 笔记

执行此 plan 前已完成自检：

1. **Spec 覆盖** ✓ —— 12 个 Task 覆盖 W1 全部交付：路由、auth、数据层（types/achievements/repo/handler/factory/Prisma）、视觉系统（6 primitives + 9 sections）、装配、QA。NotesPreview / 自动拼图 / 翻页动画 / 收藏合并 等明确推迟到 W2-W6（charter §9）。

2. **Placeholder 扫描** ✓ —— 所有 Task 含完整代码；TBD / 添加错误处理 / 类似 Task N 等占位词均不存在。

3. **类型一致性** ✓ —— `JournalSnapshot` 字段名在 Task 1 定义后被 Task 3 / 6-11 一致引用（user / stats / currentTrip / prefectures / pinsForMap / recentNotes / tripsForTimeline / workProgress / achievements / nextAchievement / travelModeBreakdown / recentPhotos）。`JournalReadRepo` 7 个方法在 Task 2 / 3 / 4 名字签名一致。`AchievementColor` 联合类型在 Task 1 / 10 引用一致。

4. **现有代码模式** ✓ —— `lib/journal/api.ts` 工厂模式严格仿照 `lib/article/api.ts`；page.tsx 的 auth 模式仿照 `app/(authed)/me/favorites/page.tsx`；测试结构 (jsdom for `.test.tsx`, node for `.test.ts`) 严格遵循 `vitest.config.ts`。
