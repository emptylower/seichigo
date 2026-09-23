# 我的地图升级为按天行程本 — 实施计划（2026-09-23）

> **执行者须知**：本计划面向零上下文的执行者（opencode）。设计依据是 `docs/superpowers/specs/2026-09-23-routebook-day-planner-design.md`，有冲突以本计划为准，本计划没写的以设计稿为准。按批次（B1 → B4）执行，每批内按任务顺序；每个任务：先写测试 → 跑失败 → 实现 → 跑通过 → `git commit`。不要在一个 commit 里塞多个任务。
>
> **硬约束**
> - 分支 `feat/routebook-day-planner`，工作目录就是本仓库根。**不要 `git push`，不要 `git merge`，不要切分支。**
> - 不要碰 `features/map/**`、`components/map/**`、`lib/planAgent/**`（只读引用，不改）、`prisma/migrations/` 里已有目录。
> - 任何文件 ≤ 750 行（`npm test` 会先跑行数预算检查）；**不要**往 `line-budget.allowlist.json` 加条目，超了就拆文件。
> - 不要 `as any` / `@ts-ignore`。
> - 不要新建 Prisma client，只用 `@/lib/db/prisma`。`$transaction` 回调里**只能用 `tx`**，不能再调 `prisma.*`（Workers 上连接池大小为 1，会死锁）；批量插入用 `createMany`。
> - **绝对不要运行 `prisma migrate dev`、`npm run db:migrate:dev`、`prisma migrate reset`、`prisma db push`**（开发库缺两条历史迁移，这些命令会提议 reset 并清空数据）。迁移只按任务 1 写的方式生成与应用。
> - 每个新建的 `app/api/**/route.ts` 都要 `export const runtime = 'nodejs'`。
> - API 路由文件只做薄壳：鉴权/参数/业务全在 `lib/routeBook/handlers/*.ts`。
> - 用户可见文案是中文；错误响应 `{ error: '中文' , reason?: '机器可读' }` + 明确 status。
> - 不参考、不复制任何 AGPL 项目代码（TREK / T-T）；算法自己写。
>
> **完成标准（每批都要）**：`npm run typecheck:app && npm run typecheck:tests && npm test` 全绿；汇报改动文件清单 + 测试输出摘要（中文，简短）。

**Goal**：把「我的地图」（RouteBook）从一条平铺点位链升级为按天的行程本，承接 `/plan` agent 生成的按天计划，并补齐 TREK 级别的规划交互（拖拽/优化/住宿/备注/段间交通/移动端/导出/导航深链）。

**Architecture**：`RouteBookPoint` 表被 `RouteBookItem`（挂在 `RouteBookDay` 下，`dayId=null` 为未安排）取代；新增 `RouteBookPlace`（自定义点）、`RouteBookLodging`（住宿区间）、`RouteLegCache`（Directions 缓存）。服务端沿用 `api.ts` 工厂 → `handlers/*.ts` → `repo.ts` 接口 + `repoPrisma.ts`/`repoMemory.ts` 双实现。前端三栏布局不变，左栏重写为按天时间线。

**Tech Stack**：Next.js 15 App Router、Prisma（Postgres/Neon）、Zod、Vitest（`.test.ts` node / `.test.tsx` jsdom）、`@dnd-kit/{core,sortable,utilities}`、MapLibre（已有）、`fast-xml-parser`（B4 新增）。

---

## 0. 现状（已核实，不用再查）

- 路线本域：`lib/routeBook/{repo.ts,repoPrisma.ts,repoMemory.ts,api.ts,exportStore.ts,exportStorePrisma.ts,exportStoreMemory.ts}`，handlers 在 `lib/routeBook/handlers/{routebooks.ts,routebookPoints.ts,routeGeometry.ts}`；路由 `app/api/me/routebooks/route.ts`、`app/api/me/routebooks/[id]/{route.ts,points/route.ts,directions/route.ts,route-geometry/route.ts}`。
- `RouteBookRepo` 接口（`lib/routeBook/repo.ts`）现有方法：`create/update/delete/getById/listByUser/addPoint/removePoint/reorderPoints/movePointToZone/isPointInAnyRouteBook/listPointRefsByUser`。其中 **`isPointInAnyRouteBook` 与 `listPointRefsByUser` 被 `lib/userPointState/stateResolver.ts` 和点位池同步依赖，签名必须保留**。`listByUser` 返回 `firstPointImage`（取第一个点位的图，`resolveAnitabiAssetUrl`）。
- `RouteBookApiDeps = { repo, pointPoolRepo, getSession, now }`（`lib/routeBook/api.ts`）。点位池仓储 `PointPoolRepo`（`lib/pointPool/repo.ts`）的方法是 `upsert(userId, pointId)` 与 `delete(userId, pointId)`（不是 remove）。
- **`/api/me/routebooks/[id]/points` 除了规划页还被公共巡礼地图调用**：`features/map/anitabi/useMapInteractionActions.tsx:683` 与 `:739` POST `{ pointId }`（该文件禁改，且已在行数豁免表里）。所以这个接口必须保留为兼容壳（任务 4）。
- `AnitabiPoint` 的坐标字段是 `geoLat` / `geoLng`（`Float?`，可为 null）。
- 现有前端点位池拖拽 id 是 `pool:<poolItemId>`（不是 pointId）。
- 老的 `tests/routeBook/utils.test.ts`（537 行）测的是将被删除的 sorted/unsorted 工具函数，任务 8 要重写它；`tests/userPointState/{state-resolver,handlers}.test.ts` 调用 `repo.addPoint` 且构造 `new InMemoryRouteBookRepo({ pointBangumiMap })`，任务 2/4 要改这些测试并保留 `pointBangumiMap` 选项。
- `app/api/me/routebooks/route.ts:4` 与 `[id]/route.ts:4` import `SortedZoneLimitError`，任务 4 要改。
- `lib/routeBook/handlers/routeGeometry.ts` 还服务 `/api/me/plans/[id]/route-geometry`（/plan 的地图）并调 Mapbox 多点路线，**v1 不动它**。
- agent 保存的每条 item 都带 `payload.schedule = { start: 'HH:mm', end: 'HH:mm', confidence: 'explicit' | 'inferred' | ... }`（`lib/planAgent/schedule.ts:281`），`timeHint` 经常是模糊文本或缺失。
- `lib/directions/googleClient.ts:143–149` 注明：**日本境内 `mode=transit` 的 Google Directions 一律 ZERO_RESULTS**（Google 在日本没有公交数据授权），只有 walking / driving 可用。
- `/plan` 的地图与路线本共用 `components/route/RoutePreviewMap.tsx`（716 行，接收单条 `routeGeometry` LineString，标记是命令式创建的 DOM）；`PlannerMapStage.tsx` 只是它的壳；`app/(authed)/plan/[id]/components/{DayMap,DayMapExpanded}.tsx` 也用它，改它时 /plan 行为不能变。
- Prisma 现有模型 `RouteBook { id userId title status metadata createdAt updatedAt }`、`RouteBookPoint { id routeBookId pointId sortOrder zone createdAt }`（`prisma/schema.prisma` 约 872–905 行）。`UserPointPool` 是用户全局点位池，不动。
- 迁移目录命名 `YYYYMMDDHHMMSS_snake_name/migration.sql`，最新是 `20260911090000_add_agent_run_started_at`。
- `/plan` 导出：`lib/tripPlan/handlers/exportRouteBook.ts`（`createExportRouteBookHandler(deps).POST(planId)`），依赖 `RouteBookExportStore { findBySourcePlanId, createWithPoints }`；路由 `app/api/me/plans/[id]/export-routebook/route.ts`；测试 `tests/tripPlan/exportRouteBook.test.ts`（用 `MemoryTripPlanRepo` + `MemoryRouteBookExportStore`）。**现状 bug**：它写 `zone: "Day N"`，而 `repoPrisma.getById` 只保留 `sorted|unsorted`，导出后路线本为空。
- TripPlan 类型（`lib/tripPlan/repo.ts`）：`TripPlanItemType = 'point' | 'transit' | 'meal' | 'lodging' | 'attraction' | 'free'`；`TripPlanItem { id dayId sortOrder type pointId timeHint title note reason payload point }`；`TripPlanDay { dayIndex date citySlug summary items }`；`TripPlan { startDate dayCount ... }`。
- agent 的外部地点载荷 `payload.place`：`{ placeId, name, lat, lng, address?, ... }`，合法性用 `validateExternalPlacePayload(value)`（`lib/googlePlaces/places.ts:442`，返回 `null` 表示合法；lat/lng 可能是字符串，取值时 `Number()`）。交通载荷 `payload.transport`：`{ mode: 'walk'|'transit'|..., durationMin, distanceKm, mapsUrl, transfers, provider, estimated, source, note, legs }`。
- 直线估算：`lib/planAgent/enrich/heuristicTransit.ts` 导出 `computeHeuristicTransitCore(from, to) → { mode:'walk'|'transit', durationMin, distanceKm, mapsUrl }`（≤1.5km 步行 4.5km/h，否则 25km/h+12min）。可以 import 使用，不要改它。
- Google Directions：`lib/directions/googleClient.ts` 导出 `fetchGoogleDirections`、`isWithinJapan(lat,lng)`、`decodePolyline`、`readOverviewPolyline`、`parseRouteLegs`、`GoogleTravelMode = 'walking'|'transit'|'driving'`；deps 工厂 `lib/directions/api.ts`（`apiKey` 来自 `GOOGLE_DIRECTIONS_API_KEY || GOOGLE_MAPS_API_KEY`）。
- 地理编码：`lib/share/geocode.ts` 的 `fetchMapTilerAddresses`（反向地理编码）；正向搜索需新加（B2）。
- 前端详情页：`app/(authed)/me/routebooks/[id]/{page.tsx,ui.tsx,types.ts,utils.ts}`，`components/{PlannerMapStage,PlannerRoutePanel,PlannerPointPoolPanel,PointCard,DroppablePanel,RouteBookImmersiveMode,TransitGuidance,MobilePointPoolSheet,RouteBookPlannerHeader,RouteBookSelector,...}.tsx`，`hooks/{useRouteBookDetail.tsx(587 行),useRouteGeometry.ts}`。`ui.tsx` 桌面为 `lg:grid-cols-[420px_minmax(0,1fr)_420px]` 三栏；移动端为「路线 / 点位池」两 tab + 底部「开始导航」按钮。
- 拖拽 id 约定在 `types.ts`：`SORTED_DND_PREFIX='sorted:'`、`UNSORTED_DND_PREFIX='unsorted:'`、`POOL_DND_PREFIX='pool:'`；`DRAG_SAFE_CONTROL_PROPS` 用于阻止按钮触发拖拽。
- 沉浸模式 `RouteBookImmersiveMode` props：`{ routeBookTitle, sorted: PointRecord[], checkedInPointIds, getPointPreview, onCheckInSuccess, onUndoCheckIn, onClose }`，内部按 `sorted` 顺序逐点导航。
- `/plan` 的保存按钮在 `app/(authed)/plan/[id]/components/DayCards.tsx:433–456`（文件已 742 行），POST `/api/me/plans/${planId}/export-routebook`，成功后只把状态设为 `saved`，再点一次才 `router.push('/me/routebooks/<id>')`；页面没有 toast 机制；文案 key `day.saveToMyMap` / `day.savedViewMap` / `day.saveFailed`（`lib/i18n/locales/{zh,en,ja}.json`）。
- 测试基础：`tests/routeBook/*.test.ts`、`tests/tripPlan/*.test.ts`；`tests/setup.ts` 有 DOM shim；命令 `npx vitest run tests/routeBook`。

---

## B1 骨架

> 派发顺序：B1-后端（任务 1–7）先做完并提交；再派 B1-前端（任务 8–12）。两者不要同时改同一文件。

### 任务 1：Prisma 模型与迁移

**Files**：Modify `prisma/schema.prisma`；Create `prisma/migrations/20260923100000_routebook_days/migration.sql`。

- [ ] 在 `model RouteBook` 增加：

```prisma
  startDate DateTime?
  dayCount  Int       @default(1)
  days      RouteBookDay[]
  items     RouteBookItem[]
  places    RouteBookPlace[]
  lodgings  RouteBookLodging[]
```

- [ ] 新增四个模型（放在 `RouteBookPoint` 之后）：

```prisma
model RouteBookDay {
  id                String          @id @default(cuid())
  routeBookId       String
  dayIndex          Int
  date              DateTime?
  title             String?
  defaultTravelMode String          @default("transit")
  routeBook         RouteBook       @relation(fields: [routeBookId], references: [id], onDelete: Cascade)
  items             RouteBookItem[]

  @@unique([routeBookId, dayIndex])
}

model RouteBookItem {
  id          String         @id @default(cuid())
  routeBookId String
  dayId       String?
  sortOrder   Int
  kind        String
  pointId     String?
  placeId     String?
  title       String?
  note        String?
  timeStart   String?
  timeEnd     String?
  locked      Boolean        @default(false)
  icon        String?
  color       String?
  legMode     String?
  payload     Json?
  createdAt   DateTime       @default(now())
  routeBook   RouteBook      @relation(fields: [routeBookId], references: [id], onDelete: Cascade)
  day         RouteBookDay?  @relation(fields: [dayId], references: [id], onDelete: SetNull)
  point       AnitabiPoint?  @relation(fields: [pointId], references: [id], onDelete: Cascade)
  place       RouteBookPlace? @relation(fields: [placeId], references: [id], onDelete: Cascade)

  @@index([routeBookId, dayId])
  @@index([pointId])
}

model RouteBookPlace {
  id          String             @id @default(cuid())
  routeBookId String
  kind        String
  title       String
  address     String?
  lat         Float
  lng         Float
  note        String?
  createdAt   DateTime           @default(now())
  routeBook   RouteBook          @relation(fields: [routeBookId], references: [id], onDelete: Cascade)
  items       RouteBookItem[]
  lodgings    RouteBookLodging[]

  @@index([routeBookId])
}

model RouteBookLodging {
  id           String         @id @default(cuid())
  routeBookId  String
  placeId      String
  fromDayIndex Int
  toDayIndex   Int
  checkIn      String?
  checkOut     String?
  note         String?
  routeBook    RouteBook      @relation(fields: [routeBookId], references: [id], onDelete: Cascade)
  place        RouteBookPlace @relation(fields: [placeId], references: [id], onDelete: Cascade)

  @@index([routeBookId])
}

model RouteLegCache {
  key       String   @id
  payload   Json
  expiresAt DateTime

  @@index([expiresAt])
}
```

  `AnitabiPoint` 模型上要加反向关系字段 `routeBookItems RouteBookItem[]`（找到 `model AnitabiPoint`，在它现有的 `routeBookPoints RouteBookPoint[]` 旁边加）。

- [ ] 迁移 SQL（建表 + 搬数据，一个文件）。**DDL 部分不要手写**，用 Prisma 生成后再把下面的「数据搬运」段追加到文件末尾：

```bash
git show HEAD:prisma/schema.prisma > /tmp/old.prisma
mkdir -p prisma/migrations/20260923100000_routebook_days
npx prisma migrate diff --from-schema-datamodel /tmp/old.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20260923100000_routebook_days/migration.sql
```

  生成的 DDL 应与下面这份等价（用它核对生成结果，缺索引/外键就以生成的为准）：

```sql
ALTER TABLE "RouteBook" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "RouteBook" ADD COLUMN "dayCount" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "RouteBookDay" (
  "id" TEXT NOT NULL, "routeBookId" TEXT NOT NULL, "dayIndex" INTEGER NOT NULL,
  "date" TIMESTAMP(3), "title" TEXT, "defaultTravelMode" TEXT NOT NULL DEFAULT 'transit',
  CONSTRAINT "RouteBookDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RouteBookDay_routeBookId_dayIndex_key" ON "RouteBookDay"("routeBookId","dayIndex");
ALTER TABLE "RouteBookDay" ADD CONSTRAINT "RouteBookDay_routeBookId_fkey" FOREIGN KEY ("routeBookId") REFERENCES "RouteBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RouteBookPlace" (
  "id" TEXT NOT NULL, "routeBookId" TEXT NOT NULL, "kind" TEXT NOT NULL, "title" TEXT NOT NULL,
  "address" TEXT, "lat" DOUBLE PRECISION NOT NULL, "lng" DOUBLE PRECISION NOT NULL, "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RouteBookPlace_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RouteBookPlace_routeBookId_idx" ON "RouteBookPlace"("routeBookId");
ALTER TABLE "RouteBookPlace" ADD CONSTRAINT "RouteBookPlace_routeBookId_fkey" FOREIGN KEY ("routeBookId") REFERENCES "RouteBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RouteBookItem" (
  "id" TEXT NOT NULL, "routeBookId" TEXT NOT NULL, "dayId" TEXT, "sortOrder" INTEGER NOT NULL,
  "kind" TEXT NOT NULL, "pointId" TEXT, "placeId" TEXT, "title" TEXT, "note" TEXT,
  "timeStart" TEXT, "timeEnd" TEXT, "locked" BOOLEAN NOT NULL DEFAULT false,
  "icon" TEXT, "color" TEXT, "legMode" TEXT, "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RouteBookItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RouteBookItem_routeBookId_dayId_idx" ON "RouteBookItem"("routeBookId","dayId");
CREATE INDEX "RouteBookItem_pointId_idx" ON "RouteBookItem"("pointId");
ALTER TABLE "RouteBookItem" ADD CONSTRAINT "RouteBookItem_routeBookId_fkey" FOREIGN KEY ("routeBookId") REFERENCES "RouteBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouteBookItem" ADD CONSTRAINT "RouteBookItem_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "RouteBookDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RouteBookItem" ADD CONSTRAINT "RouteBookItem_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "AnitabiPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouteBookItem" ADD CONSTRAINT "RouteBookItem_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "RouteBookPlace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RouteBookLodging" (
  "id" TEXT NOT NULL, "routeBookId" TEXT NOT NULL, "placeId" TEXT NOT NULL,
  "fromDayIndex" INTEGER NOT NULL, "toDayIndex" INTEGER NOT NULL,
  "checkIn" TEXT, "checkOut" TEXT, "note" TEXT,
  CONSTRAINT "RouteBookLodging_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RouteBookLodging_routeBookId_idx" ON "RouteBookLodging"("routeBookId");
ALTER TABLE "RouteBookLodging" ADD CONSTRAINT "RouteBookLodging_routeBookId_fkey" FOREIGN KEY ("routeBookId") REFERENCES "RouteBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouteBookLodging" ADD CONSTRAINT "RouteBookLodging_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "RouteBookPlace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RouteLegCache" (
  "key" TEXT NOT NULL, "payload" JSONB NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RouteLegCache_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RouteLegCache_expiresAt_idx" ON "RouteLegCache"("expiresAt");

-- ===== 数据搬运（手写，追加在生成的 DDL 之后）=====
-- 1) startDate 回填（metadata.startDate 可解析时）
UPDATE "RouteBook" SET "startDate" = ("metadata"->>'startDate')::timestamp
WHERE "metadata" ? 'startDate' AND ("metadata"->>'startDate') ~ '^\d{4}-\d{2}-\d{2}';

-- 2) 旧导出写过 zone='Day N' 的本：dayCount = max(N)
UPDATE "RouteBook" rb SET "dayCount" = GREATEST(1, sub.maxn)
FROM (
  SELECT "routeBookId", MAX(substring("zone" from '^Day (\d+)$')::int) AS maxn
  FROM "RouteBookPoint" WHERE "zone" ~ '^Day \d+$' GROUP BY "routeBookId"
) sub WHERE sub."routeBookId" = rb."id";

-- 3) 每本建 Day 1..dayCount，date 由 startDate 派生
INSERT INTO "RouteBookDay" ("id","routeBookId","dayIndex","date")
SELECT 'rbd_' || md5(rb."id" || ':' || g.n), rb."id", g.n,
       CASE WHEN rb."startDate" IS NULL THEN NULL ELSE rb."startDate" + ((g.n - 1) || ' days')::interval END
FROM "RouteBook" rb CROSS JOIN LATERAL generate_series(1, rb."dayCount") AS g(n);

-- 4) sorted → Day 1；'Day N' → Day N；其余(unsorted) → 未安排。每天 sortOrder 重编
INSERT INTO "RouteBookItem" ("id","routeBookId","dayId","sortOrder","kind","pointId","createdAt")
SELECT 'rbi_' || md5(p."id"), p."routeBookId", d."id",
       (row_number() OVER (PARTITION BY p."routeBookId", d."id" ORDER BY p."sortOrder", p."createdAt")) - 1,
       'point', p."pointId", p."createdAt"
FROM "RouteBookPoint" p
LEFT JOIN "RouteBookDay" d ON d."routeBookId" = p."routeBookId"
  AND d."dayIndex" = CASE WHEN p."zone" = 'sorted' THEN 1
                          WHEN p."zone" ~ '^Day \d+$' THEN substring(p."zone" from '^Day (\d+)$')::int
                          ELSE NULL END;
```

  注意最后一段：`unsorted` 行 `d."id"` 为 NULL → `dayId=NULL`，`row_number` 按 `(routeBookId, NULL)` 分区同样有效。**不要**在这次迁移里 drop `RouteBookPoint`。

- [ ] 应用到开发库并登记（`.env` 的 `DATABASE_URL` 是开发库）：

```bash
npx prisma db execute --file prisma/migrations/20260923100000_routebook_days/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20260923100000_routebook_days
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code   # 期望 exit 0：库与 schema 一致
npx prisma generate
```

  再用 SQL 核对搬运结果（`npx prisma db execute --stdin` 或任何 psql）：`SELECT count(*) FROM "RouteBookPoint"` 应等于 `SELECT count(*) FROM "RouteBookItem"`；`SELECT count(*) FROM "RouteBookItem" WHERE "dayId" IS NULL` 应等于 `... "RouteBookPoint" WHERE zone NOT IN ('sorted') AND zone !~ '^Day \d+$'`。把这几个数字写进汇报。

- [ ] **回滚说明**（写进 commit message body）：本迁移只加表加列不删旧表；若 B1 代码回滚，新表里用户新写的数据不会回到 `RouteBookPoint`。生产 `migrate deploy` 前需先建 Neon 分支快照（由负责人操作，不在本计划内）。
- [ ] Commit：`feat(routebook): 按天行程本数据模型与迁移`

### 任务 2：仓储接口与内存实现

**Files**：Modify `lib/routeBook/repo.ts`；Rewrite `lib/routeBook/repoMemory.ts`；Test `tests/routeBook/repoMemory.test.ts`（新建）。

- [ ] `repo.ts` 改为（保留 `RouteBookStatus`、`RouteBook`、`RouteBookListItem`、`RouteBookUpdateInput`、`RouteBookListFilters`、`RouteBookPointListFilters`、`RouteBookPointRef` 原样；删除 `RouteBookZone`、`RouteBookPoint`、`RouteBookWithPoints`、`SortedZoneLimitError`）：

```ts
export const DAY_ITEM_LIMIT = 25
export const PLACE_LIMIT = 50
export const DAY_COUNT_MAX = 30

export type TravelMode = 'transit' | 'walking' | 'driving'
export type ItemKind = 'point' | 'place' | 'note' | 'transit'
export type PlaceKind = 'lodging' | 'station' | 'restaurant' | 'other'

export type RouteBookDay = { id: string; routeBookId: string; dayIndex: number; date: Date | null; title: string | null; defaultTravelMode: TravelMode }
export type RouteBookItem = {
  id: string; routeBookId: string; dayId: string | null; sortOrder: number; kind: ItemKind
  pointId: string | null; placeId: string | null; title: string | null; note: string | null
  timeStart: string | null; timeEnd: string | null; locked: boolean
  icon: string | null; color: string | null; legMode: TravelMode | null
  payload: Prisma.JsonValue | null; createdAt: Date
}
export type RouteBookPlace = { id: string; routeBookId: string; kind: PlaceKind; title: string; address: string | null; lat: number; lng: number; note: string | null; createdAt: Date }
export type RouteBookLodging = { id: string; routeBookId: string; placeId: string; fromDayIndex: number; toDayIndex: number; checkIn: string | null; checkOut: string | null; note: string | null }

export type RouteBook = { /* 原字段 */ startDate: Date | null; dayCount: number }
export type RouteBookDetail = RouteBook & { days: RouteBookDay[]; items: RouteBookItem[]; places: RouteBookPlace[]; lodgings: RouteBookLodging[] }

export type RouteBookUpdateInput = { title?: string; status?: RouteBookStatus; metadata?: Prisma.JsonValue | null; startDate?: Date | null; dayCount?: number }

export type ItemCreateInput = { dayId: string | null; kind: ItemKind; pointId?: string; placeId?: string; title?: string; note?: string; timeStart?: string; index?: number }
export type ItemUpdateInput = { title?: string | null; note?: string | null; timeStart?: string | null; timeEnd?: string | null; locked?: boolean; icon?: string | null; color?: string | null; legMode?: TravelMode | null }
export type PlaceInput = { kind: PlaceKind; title: string; address?: string | null; lat: number; lng: number; note?: string | null }
export type LodgingInput = { placeId: string; fromDayIndex: number; toDayIndex: number; checkIn?: string | null; checkOut?: string | null; note?: string | null }

export class RouteBookRuleError extends Error {
  constructor(readonly reason: 'day_limit' | 'place_limit' | 'anchor_order' | 'day_not_empty' | 'lodging_overlap' | 'stale' | 'not_found' | 'invalid', message: string) { super(message); this.name = 'RouteBookRuleError' }
}

export interface RouteBookRepo {
  create(userId: string, title: string, status: RouteBookStatus, opts?: { startDate?: Date | null; dayCount?: number }): Promise<RouteBook>   // 自动建 Day 1..dayCount
  update(id: string, userId: string, data: RouteBookUpdateInput, expectedUpdatedAt?: Date): Promise<RouteBook | null>  // dayCount 增大时补建天；startDate 变化时重算各天 date；expectedUpdatedAt 不匹配抛 stale
  delete(id: string, userId: string): Promise<RouteBook | null>
  getById(id: string, userId: string): Promise<RouteBookDetail | null>
  listByUser(userId: string, filters?: RouteBookListFilters): Promise<RouteBookListItem[]>

  insertDay(routeBookId: string, userId: string, afterDayIndex: number): Promise<RouteBookDay>
  updateDay(routeBookId: string, userId: string, dayId: string, data: { title?: string | null; defaultTravelMode?: TravelMode }): Promise<RouteBookDay | null>
  deleteDay(routeBookId: string, userId: string, dayId: string): Promise<boolean>        // 非空抛 day_not_empty；最后一天不允许删（invalid）
  reorderDays(routeBookId: string, userId: string, orderedDayIds: string[]): Promise<RouteBookDay[]>

  createItem(routeBookId: string, userId: string, input: ItemCreateInput): Promise<RouteBookItem>
  updateItem(routeBookId: string, userId: string, itemId: string, data: ItemUpdateInput): Promise<RouteBookItem | null>
  deleteItem(routeBookId: string, userId: string, itemId: string): Promise<boolean>
  reorderItems(routeBookId: string, userId: string, dayId: string | null, orderedItemIds: string[]): Promise<RouteBookItem[]>  // 返回全部 items
  replaceDayOrder(routeBookId: string, userId: string, dayId: string, orderedItemIds: string[]): Promise<RouteBookItem[]>   // optimize 写回用，不做锚校验（optimize 自己保证）

  createPlace(routeBookId: string, userId: string, input: PlaceInput): Promise<RouteBookPlace>
  updatePlace(routeBookId: string, userId: string, placeId: string, input: Partial<PlaceInput>): Promise<RouteBookPlace | null>
  deletePlace(routeBookId: string, userId: string, placeId: string): Promise<boolean>   // 级联删 items/lodgings

  createLodging(routeBookId: string, userId: string, input: LodgingInput): Promise<RouteBookLodging>
  updateLodging(routeBookId: string, userId: string, lodgingId: string, input: Partial<LodgingInput>): Promise<RouteBookLodging | null>
  deleteLodging(routeBookId: string, userId: string, lodgingId: string): Promise<boolean>

  isPointInAnyRouteBook(userId: string, pointId: string): Promise<boolean>         // 查 items kind=point
  listPointRefsByUser(userId: string, filters?: RouteBookPointListFilters): Promise<RouteBookPointRef[]>
}
```

  接口补充：`reorderItems(routeBookId, userId, dayId, orderedItemIds, expectedUpdatedAt?: Date)`；所有写方法返回值里能拿到最新的 `RouteBook.updatedAt`（`reorderItems`/`replaceDayOrder` 返回 `{ items, updatedAt }`，其它返回对象上附 `bookUpdatedAt`）。内存实现构造函数继续接受 `{ now, idFactory, pointBangumiMap }`（`tests/userPointState/*.test.ts` 在用）。

  规则实现细节（Memory 与 Prisma 两边必须一致，全部抽到 `lib/routeBook/rules.ts` 共用）：
  - **时间锚定义**：`locked === true && timeStart != null` 的条目才是锚。只有 `timeStart` 不是锚（只显示，不约束）。
  - **锚顺序校验 `assertAnchorOrder(dayItems)`**：按 `sortOrder` 取全部锚，其 `timeStart` 必须非递减，否则抛 `anchor_order`（消息：`「${later.title}」(${later.timeStart}) 必须排在「${earlier.title}」(${earlier.timeStart}) 之后`；title 取 item.title，point/place 没有 title 时用 `点位`/`地点`）。`reorderItems`、`replaceDayOrder`、`updateItem`（改 `timeStart`/`locked` 时）都要跑它。
  - **每天上限 `assertDayLimit`**：只统计 `kind ∈ {point, place}`（note/transit 不算），上限 25；`dayId=null` 的「未安排」不限。
  - `reorderItems`：`orderedItemIds` 必须全部属于本行程本（否则 `invalid`）；集合必须恰好等于「目标天现有条目 ∪ 移入条目」——目标天现有条目一个都不能少，否则 `invalid`（400「列表与当前条目不一致，请刷新」）；不在目标天的条目视为移入（要校验其 `dayId` 所属天属于本行程本）。写入后目标天与源天各自 `sortOrder` 从 0 重编，然后跑 `normalizeTransitItems`（见下）。`expectedUpdatedAt` 传了且不等于库中值 → `stale`。
  - **交通条目附着规则 `normalizeTransitItems(dayItems)`**：`kind=transit` 的条目通过 `payload.transitBetween = { prevItemId, nextItemId }` 记录它连接的两条（导入与创建时写入）。每次某天条目顺序变化后：把每个 transit 条目移到 `prevItemId` 条目的紧后面；若 `prevItemId` 条目不在这一天了，则删除该 transit 条目。`buildDayStops`（任务 7）只有在 transit 条目紧后面的有坐标条目恰好是 `nextItemId` 时才采用它的 agent 数据，否则该段按普通段重算，且返回 `staleTransitItemIds` 供 UI 标「已失效」。
  - `createItem`：`index` 缺省末尾；受 25 上限；`kind=point` 且同一 `pointId` 已在**同一天**（或同在未安排）→ 返回已有条目（幂等）；不同天允许重复（地图徽标显示 `1·3`）。`kind=point` 时 `pointId` 必须存在于 `AnitabiPoint`（Prisma 用 `findUnique` 先查，不存在 → `invalid` 400「点位不存在」，不要让 P2003 变成 500；内存版用注入的 `pointBangumiMap`/一个 `knownPointIds` 集合模拟）。`kind=place` 时 `placeId` 必须属于本行程本。`dayId` 非空时必须属于本行程本。
  - `insertDay(afterDayIndex)`：`afterDayIndex` ∈ [0, dayCount]；新天 `dayIndex = afterDayIndex+1`，其后各天 +1；lodging：`fromDayIndex > afterDayIndex` 则 from+1；`toDayIndex > afterDayIndex` 则 to+1；`dayCount+1`（上限 30 → `invalid`）。
  - `deleteDay(dayId)`（下标 `del`）：非空（有任何条目）→ `day_not_empty`；只剩一天 → `invalid`。其后各天 -1；lodging：`from > del` 则 from-1；`to >= del` 则 to-1；结果 `to < from` 的整条删除。
  - `reorderDays`：只重编 `dayIndex`（并按 `startDate` 重算 `date`），lodging 不动。
  - `update` 里 `startDate` 变化 → 所有天 `date = startDate + (dayIndex-1) 天`（UTC 00:00）；`startDate=null` → 各天 `date=null`。`dayCount` 只允许增大（补建空天），减小 → `invalid`。`expectedUpdatedAt` 不匹配 → `stale`。
  - **`updatedAt` 统一推进**：days/items/places/lodgings 的任何写入都在同一事务里 `UPDATE RouteBook SET updatedAt = now` 并返回它。Prisma 的乐观锁写法：`tx.routeBook.updateMany({ where: { id, userId, updatedAt: expected }, data: { updatedAt: now } })`，`count === 0` → `stale`。
  - `deletePlace` 级联删 `items.placeId` 与 `lodgings.placeId`（Prisma 靠 onDelete Cascade，内存版手动）。`createPlace` 超过 50 → `place_limit`。
  - **住宿区间语义**：`fromDayIndex` = 入住日，`toDayIndex` = 退房日；住的夜晚是 `[from, to-1]`；`from == to` 表示「当天不过夜但以此为锚」（允许）。`createLodging`/`updateLodging`：`from <= to`；与同本其它区间的**夜晚集合**不相交，否则 `lodging_overlap`（`[1,3]` 与 `[3,5]` 允许——3 号退房 3 号入住）；`placeId` 必须是本行程本 `kind=lodging` 的自定义点，否则 `invalid`。
  - `listByUser.firstPointImage`：取 `dayIndex` 最小的天里 `sortOrder` 最小的 `point` 条目的图；没有则 null。

- [ ] `repoMemory.ts` 用 Map 实现以上全部；`tests/routeBook/repoMemory.test.ts` 覆盖：创建自动建天、insertDay/deleteDay 对 lodging 下标的影响（含 `to<from` 被删）、reorderDays 不动 lodging、reorderItems 天内/跨天/未安排↔天/25 上限只数 point+place/锚顺序只看 locked/列表缺条目 400/跨本 dayId 拒绝、transit 附着与失效删除、createItem 同天幂等跨天允许、deletePlace 级联、lodging 夜晚重叠与背靠背允许、update 的 startDate 重算与 stale、updatedAt 每次写入推进。
- [ ] `npx vitest run tests/routeBook/repoMemory.test.ts` 通过。Commit：`feat(routebook): 行程本仓储接口与内存实现`

### 任务 3：Prisma 实现

**Files**：Rewrite `lib/routeBook/repoPrisma.ts`（超 750 行就拆成 `repoPrisma.ts` + `repoPrismaItems.ts` + `repoPrismaDays.ts`，主类组合调用）。

- [ ] 所有写操作用 `prisma.$transaction`；`getById` 一次 `findFirst` + `include: { days: { orderBy: { dayIndex: 'asc' } }, items: { orderBy: [{ dayId: 'asc' }, { sortOrder: 'asc' }] }, places: true, lodgings: true }`，`items` 里 `point` 关系不 include（前端仍走现有点位预览接口）。
- [ ] 规则与内存版完全一致（把校验函数抽到 `lib/routeBook/rules.ts` 共用：`assertAnchorOrder(items)`、`assertDayLimit(count)`、`assertLodgingNoOverlap(list, candidate)`、`shiftLodgingsForInsert/Delete`、`computeDayDate(startDate, dayIndex)`），两边都 import `rules.ts`。
- [ ] `tests/routeBook/rules.test.ts` 覆盖 `rules.ts` 的每个函数（锚顺序、25 只数 point/place、lodging 夜晚重叠、insert/delete 下标平移含 `to<from` 删除、`computeDayDate`、`normalizeTransitItems`）。
- [ ] `tests/routeBook/repoPrisma.test.ts`：仿照 `tests/tripPlan/repoPrismaReplaceDays.test.ts` 用 mock 的 `prisma.$transaction`/`tx` 验证 `reorderItems` 的乐观锁 `updateMany` 参数与 `count===0` → stale，以及 `createItem` 对不存在 pointId 返回 `invalid`。
- [ ] 本任务结束时 `npx vitest run tests/routeBook` 通过即可；`typecheck:app` 要到任务 4 才恢复。Commit：`feat(routebook): 行程本 Prisma 仓储`

### 任务 4：Handlers 与路由

**Files**：Create `lib/routeBook/handlers/{items.ts,days.ts,places.ts,lodgings.ts,optimize.ts,schemas.ts,errors.ts}`；Modify `lib/routeBook/handlers/routebooks.ts`、`lib/routeBook/api.ts`；Rewrite `lib/routeBook/handlers/routebookPoints.ts` 与 `app/api/me/routebooks/[id]/points/route.ts` 为兼容壳（见下）；Modify `app/api/me/routebooks/route.ts` 与 `app/api/me/routebooks/[id]/route.ts`（去掉 `SortedZoneLimitError` import，错误映射改用 `errors.ts`）；Modify `tests/userPointState/state-resolver.test.ts` 与 `tests/userPointState/handlers.test.ts`（`repo.addPoint(...)` 改为 `repo.createItem(bookId, userId, { dayId: null, kind: 'point', pointId })`，断言不变）；Create 路由 `app/api/me/routebooks/[id]/{days/route.ts,days/reorder/route.ts,days/[dayId]/route.ts,days/[dayId]/optimize/route.ts,items/route.ts,items/reorder/route.ts,items/[itemId]/route.ts,places/route.ts,places/[placeId]/route.ts,lodgings/route.ts,lodgings/[lodgingId]/route.ts}`；Delete `tests/routeBook/point-pool-sync.test.ts`，Create `tests/routeBook/handlers.test.ts`。

- [ ] **`/points` 兼容壳**（公共地图 `features/map/anitabi/useMapInteractionActions.tsx` 在调，禁改那边）：`POST { pointId }` → `repo.createItem(id, userId, { dayId: null, kind: 'point', pointId })` + 点位池 `delete`，返回 `{ ok: true, item }`（HTTP 200）；`DELETE { pointId }` → 删除本行程本里该 `pointId` 的全部条目 + 若 `isPointInAnyRouteBook` 为 false 则池 `upsert`，返回 `{ ok: true }`；其它 op（reorder/move）一律 410 `{ error: '接口已升级，请刷新页面' }`。两个用例进 `handlers.test.ts`。

- [ ] `schemas.ts`（Zod）：

```ts
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式应为 HH:mm')
export const travelModeSchema = z.enum(['transit', 'walking', 'driving'])
export const itemKindSchema = z.enum(['point', 'place', 'note', 'transit'])
export const placeKindSchema = z.enum(['lodging', 'station', 'restaurant', 'other'])
export const noteIconSchema = z.enum(['info','clock','train','utensils','ticket','camera','shopping-bag','alert','star','bookmark'])
export const noteColorSchema = z.enum(['gray','pink','amber','green','sky','violet'])
export const createItemSchema = z.object({
  dayId: z.string().min(1).nullable(), kind: itemKindSchema,
  pointId: z.string().min(1).optional(), placeId: z.string().min(1).optional(),
  title: z.string().trim().max(120).optional(), note: z.string().max(2000).optional(),
  timeStart: hhmm.optional(), index: z.number().int().min(0).optional(),
}).superRefine((v, ctx) => {
  if (v.kind === 'point' && !v.pointId) ctx.addIssue({ code: 'custom', message: '点位条目缺少 pointId' })
  if (v.kind === 'place' && !v.placeId) ctx.addIssue({ code: 'custom', message: '自定义点条目缺少 placeId' })
  if ((v.kind === 'note' || v.kind === 'transit') && !v.title) ctx.addIssue({ code: 'custom', message: '标题不能为空' })
})
export const updateItemSchema = z.object({
  title: z.string().trim().max(120).nullable().optional(), note: z.string().max(2000).nullable().optional(),
  timeStart: hhmm.nullable().optional(), timeEnd: hhmm.nullable().optional(), locked: z.boolean().optional(),
  icon: noteIconSchema.nullable().optional(), color: noteColorSchema.nullable().optional(),
  legMode: travelModeSchema.nullable().optional(),
}).refine((v) => !(v.timeStart && v.timeEnd) || v.timeEnd >= v.timeStart, { message: '结束时间不能早于开始时间' })
export const reorderItemsSchema = z.object({ dayId: z.string().min(1).nullable(), orderedItemIds: z.array(z.string().min(1)).max(500), updatedAt: z.string().datetime().optional() })  // 未安排区不限数量，上限只是防滥用
export const insertDaySchema = z.object({ afterDayIndex: z.number().int().min(0).max(DAY_COUNT_MAX) })
export const updateDaySchema = z.object({ title: z.string().trim().max(60).nullable().optional(), defaultTravelMode: travelModeSchema.optional() })
export const reorderDaysSchema = z.object({ orderedDayIds: z.array(z.string().min(1)).min(1) })
export const placeSchema = z.object({ kind: placeKindSchema, title: z.string().trim().min(1).max(120), address: z.string().max(300).nullable().optional(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), note: z.string().max(2000).nullable().optional() })
export const lodgingSchema = z.object({ placeId: z.string().min(1), fromDayIndex: z.number().int().min(1), toDayIndex: z.number().int().min(1), checkIn: hhmm.nullable().optional(), checkOut: hhmm.nullable().optional(), note: z.string().max(2000).nullable().optional() }).refine((v) => v.toDayIndex >= v.fromDayIndex, { message: '退房日不能早于入住日' })
```

- [ ] `errors.ts`：`routeBookErrorResponse(err)`——`RouteBookRuleError` 映射：`day_limit`→400「这一天最多 25 条」、`place_limit`→400「自定义点最多 50 个」、`anchor_order`→409（`error` 用 err.message，`reason:'anchor_order'`）、`day_not_empty`→400「先清空这一天再删除」、`lodging_overlap`→400「住宿日期与已有住宿重叠」、`stale`→409「行程已在别处修改，请刷新」`reason:'stale'`、`not_found`→404「行程不存在」、`invalid`→400 err.message；Prisma `P2021/P2022`→503「数据库结构未更新」；`DATABASE_URL` 缺失→503「数据库未配置」；其它→500「服务器错误」。所有新路由的 `catch` 都用它。
- [ ] 每个 handler 文件导出 `createXxxHandlers(deps: RouteBookApiDeps)`，方法签名与现有 `routebooks.ts` 一致（`(req: Request, ctx: { params: Promise<{ id: string; ... }> })`）。鉴权：无 session → 401「请先登录」；`repo.getById` 为 null → 404。
- [ ] `routebooks.ts`：`GET /[id]` 返回 `{ ok: true, routeBook: RouteBookDetail }`（含 days/items/places/lodgings，日期用 ISO 字符串）；`PATCH /[id]` 增加 `startDate: z.string().datetime().nullable().optional()`、`dayCount: z.number().int().min(1).max(30).optional()`、`updatedAt: z.string().datetime().optional()`，把 `updatedAt` 传给 `repo.update` 作乐观锁；`POST /` 增加可选 `startDate`、`dayCount`。
- [ ] `items.ts` 的 `POST` 在 `kind=point` 时沿用原点位池同步语义：加入行程本后调用 `deps.pointPoolRepo.remove(userId, pointId)`（看 `lib/pointPool/repo.ts` 实际方法名）；`DELETE` 点位条目后若 `repo.isPointInAnyRouteBook` 为 false 则 `pointPoolRepo.upsert(userId, pointId)`。这是 `tests/routeBook/point-pool-sync.test.ts` 原来验证的行为，迁到 `handlers.test.ts` 里继续验证。
- [ ] `optimize.ts` handler：`POST /days/[dayId]/optimize`——读 detail，收集该天全部条目；`point`/`place` 且有坐标的参与优化（point 坐标用 `deps.pointCoords(pointIds)`——在 `RouteBookApiDeps` 新增 `pointCoords: (pointIds: string[]) => Promise<Map<string, { lat: number; lng: number }>>`，Prisma 实现 `findMany({ where: { id: { in } }, select: { id, geoLat, geoLng } })`，null 坐标的不进 Map），其它条目（note、transit、无坐标点位）视为 `fixed`（保持下标）；锚点由当天 lodging 决定（任务 5 的 `resolveDayAnchors`），调 `optimizeDay`，再跑 `assertAnchorOrder`（不通过 → 409，不写回），`repo.replaceDayOrder` 写回（它内部跑 `normalizeTransitItems`），返回 `{ ok: true, before, after, distanceBeforeM, distanceAfterM, updatedAt }`。
- [ ] `tests/routeBook/handlers.test.ts`（用 `InMemoryRouteBookRepo` + `InMemoryPointPoolRepo` + `pointCoords` 假实现）覆盖：401、404（含别人的行程本——仓储按 userId 过滤，所以是 404 不是 403）；items 增删改；reorder 天内、跨天、未安排↔天、25 上限 400、锚顺序 409 与消息文本、列表缺条目 400；`/points` 兼容壳两个用例与点位池同步；days 插入/删除/重排；places 级联；lodgings 重叠；PATCH 乐观锁 409；optimize 返回顺序且写回、锁定项不动。
- [ ] 出口：`npm run typecheck:tests && npx vitest run tests/routeBook tests/tripPlan tests/userPointState` 通过；`npm run typecheck:app` **允许**只在 `app/(authed)/me/routebooks/[id]/**` 下报错（旧前端要到任务 8–11 才换），其它路径不得有错。Commit：`feat(routebook): 按天条目/天/自定义点/住宿 handlers 与路由`

### 任务 5：优化算法

**Files**：Create `lib/routeBook/optimize.ts`、`lib/routeBook/anchors.ts`；Test `tests/routeBook/optimize.test.ts`。

- [ ] `optimize.ts`：

```ts
export type OptimizePoint = { id: string; lat: number; lng: number; fixed: boolean }
export type LatLng = { lat: number; lng: number }
export type Anchors = { start?: LatLng; end?: LatLng }

export function haversineM(a: LatLng, b: LatLng): number  // 地球半径 6371000

/** 返回新顺序的 id 列表；fixed 项保持原下标，free 项按优化后顺序填入其余下标 */
export function optimizeDay(points: OptimizePoint[], anchors: Anchors): string[]
export function routeDistanceM(points: LatLng[], anchors: Anchors): number   // start→p0→…→pn→end 总长
```

  `fixed` 由调用方决定：锚（`locked && timeStart`）、无坐标条目、note、transit 都传 `fixed:true`（无坐标的用 `lat:NaN` 也行，算法不读 fixed 项的坐标）。

  算法：
  1. `free = points.filter(!fixed)`；`free.length < 2` → 返回原顺序。
  2. 最近邻：起点 = `anchors.start`，没有则 `free[0]`；每步选未访问中距当前最近者。
  3. 2-opt：对序列 `seq`（前面虚拟接 start、后面虚拟接 end，若存在），反复对所有 `i<j` 尝试反转 `seq[i..j]`，若总长减小则接受；直到一轮无改进或迭代 200 轮。
  4. 回填：结果数组长度 = points.length；先把 fixed 项放回其原下标，再把优化后的 free 序列按顺序填入空位。
- [ ] `anchors.ts`：`resolveDayAnchors(dayIndex, lodgings, places): Anchors`——同一天可能涉及两个 lodging（换酒店日）：`start` = 满足 `to == d`（今天退房）或 `from < d < to`（住中）的 lodging；`end` = 满足 `from == d`（今天入住）或 `from < d < to` 的 lodging；`from == to == d` 的同时作为 start 与 end。都没有 → `{}`。坐标取 `places` 里对应 `placeId`。
- [ ] 测试：固定项下标不变；有 start=end 锚时结果首元素是离锚最近的自由点；2-opt 后 `routeDistanceM` ≤ 最近邻结果；单点/全固定原样返回；一个已知交叉的 4 点方形用例（顺序 A,C,B,D 会被修正为 A,B,C,D 或其逆）；`resolveDayAnchors`：入住日只有 end、退房日只有 start、住中 start=end、换酒店日 start/end 来自不同 lodging、`from==to` 同为两者、无住宿空对象。
- [ ] Commit：`feat(routebook): 当天顺序优化（最近邻 + 2-opt，住宿锚点）`

### 任务 6：agent 导入重写

**Files**：Rewrite `lib/tripPlan/handlers/exportRouteBook.ts`；Rewrite `lib/routeBook/exportStore.ts`、`exportStorePrisma.ts`、`exportStoreMemory.ts`；Rewrite `tests/tripPlan/exportRouteBook.test.ts`。

- [ ] `exportStore.ts`：

```ts
export type ExportDay = { dayIndex: number; date: Date | null; title: string | null }
export type ExportPlace = { tempId: string; kind: PlaceKind; title: string; address: string | null; lat: number; lng: number }
export type ExportItem = { id: string; dayIndex: number; sortOrder: number; kind: ItemKind; pointId?: string; placeTempId?: string; title?: string; note?: string; timeStart?: string; timeEnd?: string; locked?: boolean; payload?: Prisma.InputJsonValue }   // id 由映射层用 crypto.randomUUID() 预生成，transit 的 payload.transitBetween 才能引用相邻条目
export type ExportLodging = { placeTempId: string; fromDayIndex: number; toDayIndex: number }
export type RouteBookExportCreateInput = { userId: string; title: string; status: RouteBookStatus; metadata: Prisma.InputJsonValue; startDate: Date | null; dayCount: number; days: ExportDay[]; places: ExportPlace[]; items: ExportItem[]; lodgings: ExportLodging[] }
export interface RouteBookExportStore { findBySourcePlanId(userId, sourcePlanId): Promise<{ id: string } | null>; createFromPlan(input: RouteBookExportCreateInput): Promise<{ id: string }> }
```

  Prisma 实现在一个事务里（只用 `tx`，逐类 `createMany`）：建 book → 建 days（`createMany` 后 `findMany` 拿 id 映射 dayIndex→dayId）→ 建 places（tempId 直接作为 `id` 使用，映射层用 `crypto.randomUUID()` 生成）→ 建 items（`id` 用预生成值，`placeId=placeTempId`）→ 建 lodgings。
- [ ] `exportRouteBook.ts` 把 `TripPlanWithDays` 转成 `RouteBookExportCreateInput`，映射规则（写成纯函数 `buildExportInput(plan): { input, counts }` 放在 `lib/tripPlan/exportMapping.ts` 方便测试）：
  - `point`（有 `pointId`）→ `kind:'point'`；无 `pointId` 跳过。
  - `meal` / `attraction`：`validateExternalPlacePayload(item.payload?.place) === null` → 建 place（meal→`restaurant`，attraction→`other`；title 取 `place.name`，address 取 `place.address ?? null`）+ `kind:'place'`；否则 → `kind:'note'`，`title` 取 item.title，计入 `degradedToNote`。
  - `transit` → `kind:'transit'`，`title` 取 item.title 或 `交通`，`payload` = 原 payload 加 `transitBetween: { prevItemId, nextItemId }`（同一天里它前后最近的 point/place 条目的预生成 id；找不到任一侧 → 该 transit 降级为 `note`，计入 `degradedToNote`）。
  - `lodging`：有合法 `payload.place` → place(`lodging`)；同一 `place.placeId` 在连续天（dayIndex 相邻）出现的合并为一个区间：`fromDayIndex = 首个出现天`，`toDayIndex = min(末个出现天 + 1, dayCount)`（agent 的 lodging 条目表示「这晚住这」，退房是次日）；不建 item。无合法 place → `kind:'note'`，计入 `degradedToNote`。
  - `free` → `kind:'note'`。
  - 时间：优先 `payload.schedule.start/end`（`HH:mm`，校验格式），其次 `timeHint` 匹配 `/^([01]?\d|2[0-3]):([0-5]\d)/` 规范成 `HH:mm`；都没有则不设。**`locked` 只在 `payload.schedule.confidence === 'explicit'` 时为 true**，其余 false（否则整份导入全是锚，优化什么都动不了）。
  - `note`：`[item.note, item.reason].filter(Boolean).join('\n')` 或 undefined。
  - days：按 `dayIndex` 升序，`date` 取 `TripPlanDay.date`，`title` 取 `summary` 前 60 字或 null；`dayCount = max(dayIndex)`（至少 1）；`startDate = plan.startDate`。
  - `counts = { days, points, places, notes, transits, lodgings, degradedToNote }`。
  - 没有任何 item 可导 → 400「计划还没有可导出的条目」。
  - 响应：`{ ok: true, routeBookId, created: true, counts }`；已存在 → `{ ok: true, routeBookId, created: false }`。
- [ ] 测试（改写现有文件）：六种 type 各一例并断言映射；lodging 连续三晚 → `[1,4]`（dayCount=4）或 `[1,3]`（dayCount=3 时封顶）、中间换酒店拆两个背靠背区间；无坐标 meal 降级 note 且计数；时间来源三种（schedule explicit → locked、schedule inferred → 不锁、只有 timeHint）；transit 的 `transitBetween` 指向正确 id、缺邻居降级；重复导入幂等；401/403/404 保留。
- [ ] Commit：`feat(plan): 计划按天导入行程本（点位/自定义点/备注/交通/住宿）`

### 任务 7：段与交通（B1 只做 heuristic + 结构，Google 在 B2 接）

**Files**：Create `lib/routeBook/legs.ts`、`lib/routeBook/handlers/legs.ts`、`app/api/me/routebooks/[id]/days/[dayId]/legs/route.ts`；Test `tests/routeBook/legs.test.ts`。

- [ ] `legs.ts`：

```ts
export type LegSource = 'google' | 'agent' | 'heuristic'
export type Leg = { fromId: string; toId: string; mode: TravelMode; durationSec: number; distanceM: number; polyline: [number, number][] | null; source: LegSource }
export type LegStop = { id: string; lat: number; lng: number; legMode: TravelMode | null }
/** 组装当天停靠序列：住宿首尾按 resolveDayAnchors 规则（id 用 'lodging:start' / 'lodging:end'），中间是有坐标的 point/place 条目；
 *  transit 条目不进序列：只有当它 payload.transitBetween.prevItemId 是序列里它前一站、nextItemId 是后一站时，才把 payload.transport 登记到 agentLegs（key = nextItemId）；否则记入 staleTransitItemIds */
export function buildDayStops(day, items, places, lodgings, pointCoords): { stops: LegStop[]; agentLegs: Map<string /* toId */, Prisma.JsonValue /* payload.transport */>; staleTransitItemIds: string[] }
export type LegResolver = (from: LatLng, to: LatLng, mode: TravelMode) => Promise<Omit<Leg, 'fromId' | 'toId' | 'mode'> | null>
export async function resolveDayLegs(stops, agentLegs, defaultMode: TravelMode, resolver: LegResolver): Promise<Leg[]>
```

  - `resolveDayLegs`：对相邻 `stops[i]→stops[i+1]`：若 `agentLegs.has(to.id)` → 用 agent payload（`durationSec = durationMin*60`，`distanceM = distanceKm*1000`，mode 由 payload.mode 映射 `walk→walking`、`transit→transit`、其它→`driving`，`polyline:null`，`source:'agent'`）；否则 `mode = to.legMode ?? defaultMode`，调 `resolver`；返回 null 时估算（`source:'heuristic'`，`polyline:null`）：`walking`/`transit` 用 `computeHeuristicTransitCore`（它自己按距离选 walk/transit，结果 mode 以它为准）；`driving` 用 `haversineM / (30km/h)`，最少 5 分钟。
  - handler 响应加 `staleTransitItemIds`。B1 的 handler 传入的 `resolver` 恒返回 null（全部 heuristic）；B2 接 Google + 缓存。
- [ ] 测试：住宿首尾三种情况 + 换酒店日；transit 条目接管、错位时进 stale；legMode 覆盖默认；resolver 为 null 时 heuristic（三种 mode）；note 条目被跳过。
- [ ] Commit：`feat(routebook): 当天段序列与交通估算`

### 任务 8：前端类型与数据层（B1-前端从这里开始）

**Files**：Rewrite `app/(authed)/me/routebooks/[id]/types.ts`、`utils.ts`、`tests/routeBook/utils.test.ts`（旧测试测的是被删函数，整体重写为新函数的测试）；Create `hooks/useTripData.ts`、`hooks/useTripDnd.ts`、`hooks/useDayLegs.ts`；Delete `hooks/useRouteBookDetail.tsx`（把点位预览拉取 `getPointPreview`、打卡状态、标题编辑等仍需要的逻辑搬到 `useTripData.ts`，不要丢功能）。还引用旧类型、需要在任务 9–11 里删除或改造的组件：`RouteBookHeader.tsx`、`CollapsiblePointPool.tsx`、`TransitGuidance.tsx`（其"下一站交通"能力被连接行取代，沉浸模式若还用它则只改类型）、`PointCard.tsx`（去掉 `zone`）、`RouteBookPlannerHeader.tsx`、`RouteListPanel.tsx`、`RouteSidebar.tsx`——任务 11 结束前 `grep -rn "zone\|RouteBookZone\|getSortedPoints\|SORTED_LIMIT" app/\(authed\)/me/routebooks` 必须为空。

- [ ] `types.ts`：删除 zone 相关；新增与 `lib/routeBook/repo.ts` 同名的前端 DTO（`Date` → ISO string）：`DayRecord`、`ItemRecord`、`PlaceRecord`、`LodgingRecord`、`RouteBookDetail = { id title status metadata startDate dayCount createdAt updatedAt days items places lodgings }`；拖拽 id 前缀改为 `ITEM_DND_PREFIX='item:'`、`POOL_DND_PREFIX='pool:'`、`MARKER_DND_PREFIX='marker:'`、`DAY_DROP_PREFIX='day:'`（`day:<dayId>` 或 `day:unassigned`）。保留 `PointPreview`、`STATUS_*`、`DRAG_SAFE_CONTROL_PROPS`、`NAV_MODE_*`、`PREVIEW_*` 常量。
- [ ] `utils.ts`：删除 sorted/unsorted 相关函数；新增纯函数（都要有 `tests/routeBook/uiUtils.test.ts`，node 项目）：
  - `groupItemsByDay(items, days): { byDay: Map<dayId, ItemRecord[]>; unassigned: ItemRecord[] }`（各自按 sortOrder）
  - `applyReorderLocal(items, targetDayId, orderedItemIds): ItemRecord[]`（乐观更新，与服务端重编规则一致）
  - `dayLabel(day, index): string`（`Day N` + 有日期时 ` · M/D 周X`）
  - `itemDisplayTitle(item, preview, places): string`
  - `sequenceForImmersive(items, dayId): ItemRecord[]`（当天 point/place 按序）
  - `pickTodayDayId(days, now): string | null`（有日期匹配今天则返回，否则第一天）
- [ ] `useTripData.ts`：`GET /api/me/routebooks/[id]` 装载；暴露 `detail`、`reload`、`patchBook`、`addItem(dayId, {kind,...}, index?)`、`updateItem`、`deleteItem`、`reorder(targetDayId, orderedIds)`、`optimizeDay(dayId)`、`insertDay/deleteDay/reorderDays`、`createPlace/updatePlace/deletePlace`、`createLodging/updateLodging/deleteLodging`，每个都是乐观更新 + 失败回滚 + 中文 toast（沿用页面现有 toast 方式；没有就用简单的 `useState` 消息条）；撤销环：`undoStack: { label: string; revert: () => Promise<void> }[]` 最多 10 条，`reorder/addItem/deleteItem/optimizeDay` 入栈；`undo()` 弹栈执行。另包含从旧 hook 搬来的：点位预览缓存 `getPointPreview(pointId)`、打卡集合、标题编辑、行程本列表。
- [ ] `useTripDnd.ts`：`sensors`（Pointer + Touch(delay 200) + Keyboard）；`onDragEnd(event)` 解析 `active.id`/`over.id`：`item:` 拖到 `item:`（同天或跨天，计算插入下标）、拖到 `day:`（末尾）；`pool:` / `marker:` 拖入 → 先 `addItem` 到目标位置。返回 `{ sensors, activeDragId, handleDragStart, handleDragEnd, handleDragCancel }`。
- [ ] `useDayLegs.ts`：`GET /days/[dayId]/legs`，按 `dayId + items 顺序签名` 缓存；`enabled` 参数（路线开关关闭时不拉）。
- [ ] `npm run typecheck:app` 此时前端组件还引用旧类型会报错，任务 9–11 修完再跑。Commit：`refactor(routebook): 行程本前端类型与数据 hook`

### 任务 9：左栏日程侧栏

**Files**：Create `components/DayPlanSidebar.tsx`（编排，≤ 300 行）、`components/DayBlock.tsx`（单天：标题行 + 时间线 + 底部工具条）、`components/TimelineItem.tsx`（四种卡片）、`components/LegConnector.tsx`（连接行；B1 只显示，不可点）、`components/UnassignedBlock.tsx`；Delete `components/PlannerRoutePanel.tsx`、`components/RouteListPanel.tsx`、`components/RouteSidebar.tsx`（确认无其它引用后删）。

- [ ] `DayPlanSidebar` props：`{ detail, selectedDayId, onSelectDay, getPointPreview, legsByDay, routeVisible, onToggleRoute, onOptimize, onUndo, undoLabel, onAddItem..., onUpdateItem, onDeleteItem, onInsertDay, onDeleteDay }`。工具栏：撤销（`undoLabel` 为空则禁用）、全部展开/折叠、「+ 添加一天」（B1 用简单按钮，B2 换成天顺序弹窗）。导出按钮 B4 再加。
- [ ] `DayBlock`：`useDroppable({ id: 'day:'+dayId })` + `SortableContext(items ids)`；折叠状态 `localStorage['routebook-day-expanded-'+routeBookId]`（JSON 对象 `{ [dayId]: boolean }`，读写都 try/catch）；标题行：`dayLabel`、「N 站 · 约 X 小时」（X 由 legs 时长 + 每站默认 40 分钟估）、住宿徽标（B2）、点击选中；底部工具条（仅选中天且有 ≥ 2 有坐标条目）：路线开关、优化、打开导航（B1 只有 Google，复用 `utils.buildGoogleDirectionsUrl`）、当天默认方式三选（写 `PATCH /days/[dayId]`）。
- [ ] `TimelineItem`：`useSortable({ id: 'item:'+item.id, disabled: item.kind === 'transit' })`；四种样式：point（缩略图 + 名 + 作品名，沿用 `PointCard.tsx` 视觉）、place（kind 图标 + 名 + 地址）、note（图标/颜色）、transit（线路/时长，无手柄，浅底；在 `staleTransitItemIds` 里的显示「已失效」灰字）；时间徽章（有 `timeStart` 就显示；`locked` 时加锁形并加深）；悬停操作：设时间（inline `<input type="time">`，**保存时同时 `locked: true`**——用户手动设的时间就是锚）、锁定/解锁、删除、移到…（下拉列出各天 + 未安排，调 `reorder`）。
- [ ] `LegConnector`：两条有坐标条目之间；`routeVisible` 时显示「图标 · N 分钟 · X km」，`source:'heuristic'` 灰色 + 「估算」。
- [ ] `UnassignedBlock`：`day:unassigned` droppable，同样 SortableContext。
- [ ] Commit：`feat(routebook): 按天日程侧栏`

### 任务 10：右栏与地图

**Files**：Modify `components/PlannerPointPoolPanel.tsx`、`components/PlannerMapStage.tsx`、`hooks/useRouteGeometry.ts`。

- [ ] 右栏数据 = 用户点位池（`UserPointPool`，加入行程本后会从池里删掉——现有语义不变）∪ 本行程本全部 `kind=point` 条目。三个 chip：全部；未安排 = 池内点位 + `dayId=null` 的点位条目；已安排 = `dayId≠null` 的点位条目（同一 pointId 多天只列一行，显示 `Day 1·3`）。作品筛选下拉（按预览 subtitle 聚合）；搜索框过滤列表；「+」：池内点位 → `addItem(selectedDayId ?? null, {kind:'point', pointId})`；未安排条目 → `reorder` 到选中天末尾；已安排条目 → 「再加一天」也是 `addItem` 到选中天。已安排点击触发 `onFocusPoint`。拖拽 id：池内 `pool:<poolItemId>`，条目 `item:<itemId>`。自定义点列表（B2）。
- [ ] 地图（改 `components/route/RoutePreviewMap.tsx`，**/plan 的用法不能变**，新 props 全部可选、缺省行为等于现在）：新增 `legs?: { coordinates: [number, number][]; dashed?: boolean }[]`（有则画多段，忽略 `routeGeometry`）、`markerVariants?: Record<pointKey, { badge?: string; emphasis: 'active' | 'muted' | 'hollow' }>`、`onMarkerPointerDown?(pointKey, event)`、`onMapContextMenu?({ lat, lng, x, y })`（右键 + 触屏长按 500ms）。文件已 716 行：把标记 DOM 构建抽到 `components/route/routePreviewMarkers.ts`，把图层样式抽到 `components/route/routePreviewLayers.ts`，主文件 ≤ 500 行。样式：每段底层线宽 8 `#7c2d3a` 不透明 0.35，上层线宽 4 `#f43f5e`；`dashed` 段 `line-dasharray [2,2]`。`PlannerMapStage.tsx` 负责把 `detail`+`selectedDayId`+`legs` 换算成这些 props：顺序徽标（同一 pointId 多天 → `1·3`）、选中天 `active`、其它天 `muted`（opacity 0.45）、未安排 `hollow`；B1 全是 heuristic → 每段直线且 dashed。标记拖拽不用 `useDraggable`（标记是命令式 DOM）：`onMarkerPointerDown` 里手动构造 dnd-kit 的拖动——最简单做法是在 `PlannerMapStage` 里渲染一个隐藏的 `useDraggable({ id: 'marker:'+itemId })` 代理元素并把 pointer 事件转发给它的 `listeners.onPointerDown`。B1 只做已在行程本里的条目标记可拖。
- [ ] 回归检查：`/plan/[id]` 的 `DayMap`/`DayMapExpanded` 不传新 props，行为与改前一致（手动打开一个计划页看地图与路线仍然渲染）。
- [ ] `useRouteGeometry.ts` 不再拉 `/route-geometry` 整条几何，改为用 `legs`；保留文件名，内部换实现。`lib/routeBook/handlers/routeGeometry.ts` 与它的路由**不动**（/plan 还在用）。
- [ ] Commit：`feat(routebook): 点位池三态筛选与按天地图`

### 任务 11：页面编排、移动端最小适配、沉浸模式按天

**Files**：Modify `ui.tsx`、`components/RouteBookImmersiveMode.tsx`、`components/MobilePointPoolSheet.tsx`。

- [ ] `ui.tsx`：用 `useTripData` + `useTripDnd` 替换旧 hook；桌面三栏：左 `DayPlanSidebar`、中 `PlannerMapStage`、右 `PlannerPointPoolPanel`；`DndContext` 包住三栏；`DragOverlay` 渲染当前拖动条目的简版卡片。
- [ ] 移动端（B1 最小版，B3 再重做）：顶部横向天胶囊（简单按钮组）+ 现有「路线 / 点位池」两 tab 保留，其中「路线」显示选中天的 `DayBlock`。
- [ ] 沉浸模式：props `sorted: PointRecord[]` 改为 `sequence: ItemRecord[]` + `places: PlaceRecord[]` + `dayLabel: string`；内部对 `kind:'place'` 的条目用 place 坐标/名字，打卡只对 `kind:'point'` 可用；最后一站完成时若有下一天显示「Day N 完成 → 明天从 X 开始」。入口按钮文案「开始 Day N」，`pickTodayDayId` 决定 N；无日期 → 先弹一个选天 sheet。
- [ ] `npm run typecheck:app && npm run typecheck:tests && npm test` 全绿。Commit：`feat(routebook): 行程本页面按天编排与沉浸模式按天`

### 任务 12：/plan 导入入口文案与跳转

**Files**：Create `app/(authed)/plan/[id]/hooks/useSaveToMyMap.ts`（把 `DayCards.tsx:347–348, 433–456` 的保存状态机抽出来；`DayCards.tsx` 已 742 行，不抽会超预算）；Modify `DayCards.tsx`；Modify `app/(authed)/me/routebooks/[id]/ui.tsx`（读 `?imported=` 显示一次性提示条）；`lib/i18n/locales/{zh,en,ja}.json`。

- [ ] 成功且 `created === true` 时直接 `router.push('/me/routebooks/'+id+'?imported='+encodeURIComponent(JSON.stringify(counts)))`；`created === false`（已导过）保持现有「已保存 · 查看地图」两段式行为。
- [ ] 行程本页面读到 `imported` 参数时在顶部显示提示条（zh「已按 {days} 天导入：{points} 个点位、{transits} 条交通、{lodgings} 个住宿」+（`degradedToNote>0` 时）「，{n} 条作为备注导入」；en/ja 对应写；新 key：`routebook.importSummary`、`routebook.importDegraded`），并用 `router.replace` 去掉参数。
- [ ] Commit：`feat(plan): 导入行程本结果提示`

**B1 验收**：`npm test` 全绿；迁移已按任务 1 的方式应用到开发库且 `migrate diff --exit-code` 为 0；本地 `npm run dev` 打开一个旧路线本，原「已排序」点位在 Day 1、「未排序」在未安排、旧导出的 `Day N` 本按天显示；从 /plan 导入一个计划后按天显示；能拖、能优化；公共地图「加入我的地图」仍可用。

---

## B2 完整规划

### 任务 13：自定义点与住宿 UI

**Files**：Create `components/PlaceEditorDialog.tsx`（新建/编辑自定义点：kind、名、地址搜索、小地图微调）、`components/LodgingDialog.tsx`、`components/DayDetailCard.tsx`（地图右上浮卡：住宿；天气 B4）；Create `lib/share/geocodeSearch.ts`（MapTiler 正向：`GET https://api.maptiler.com/geocoding/{q}.json?key=…&language=ja,zh,en&limit=5`，key 与 `fetchMapTilerAddresses` 同一环境变量）与 `app/api/geocode/search/route.ts`（登录用户，每用户 30 次/分钟，内存计数即可）；Modify `PlannerPointPoolPanel.tsx`（列出自定义点 + 「+ 添加自定义点」）、`PlannerMapStage.tsx`（右键/长按 → 打开 `PlaceEditorDialog` 预填坐标 + 反向地理编码地址）、`DayBlock.tsx`（住宿徽标：绿 入住 / 红 退房 / 灰 续住；「添加住宿」）。

- [ ] 测试：`tests/share/geocodeSearch.test.ts`（解析响应、无 key 时返回空数组不抛）；jsdom `PlaceEditorDialog.test.tsx`（提交表单调 `onSubmit` 且 lat/lng 数字）。
- [ ] Commit：`feat(routebook): 自定义点与住宿`

### 任务 14：备注条目

**Files**：Create `components/NoteEditorDialog.tsx`（标题、详情、10 图标、6 颜色、可选时间）；Modify `TimelineItem.tsx`（note 卡片按 color 着色，图标用 lucide 映射表）、`DayBlock.tsx`（「+ 备注」按钮）。

- [ ] Commit：`feat(routebook): 每日备注`

### 任务 15：Google Directions 接入段与 DB 缓存

**Files**：Create `lib/routeBook/legCache.ts`（`getCachedLegs(keys[])` 一次 `findMany({ where: { key: { in } } })`、`setCachedLeg(key, payload, ttlDays=7)`；key = `sha256(\`${lat5},${lng5}|${lat5},${lng5}|${mode}\`)` 用 `crypto.subtle.digest`，坐标 `toFixed(5)`；过期视为未命中并异步删除）、`lib/routeBook/legResolverGoogle.ts`（实现 `LegResolver`：**只处理 `walking` 与 `driving`**；`transit` 直接返回 null 走 heuristic——日本境内 Google 没有公交数据，见 §0；两端都 `isWithinJapan` 才调 `fetchGoogleDirections`；成功取 `overview polyline` 解码为 `[lat,lng][]`、总时长/距离；写缓存；失败返回 null）；Modify `handlers/legs.ts`（先批量查缓存，再对未命中的段并发 4 路调 resolver，整体 8 秒截止，超时的段返回 heuristic；每用户每分钟 10 次请求限流，写法照 `routeGeometry.ts` 的 `checkRateLimit`）。`RouteBookApiDeps` 增加 `legResolver: LegResolver`（Prisma 工厂用 Google 实现，测试用假实现）。**不改** `lib/routeBook/handlers/routeGeometry.ts`。

- [ ] 测试 `tests/routeBook/legCache.test.ts`（用假的 prisma 双：命中/未命中/过期）、`legResolverGoogle.test.ts`（mock `fetchGoogleDirections`：transit 不调、日本外不调、失败返回 null、成功写缓存）、`handlers/legs` 的并发与截止（fake timers）。
- [ ] Commit：`feat(routebook): 段间交通接 Google Directions 与持久缓存`

### 任务 16：连接行交互与段方式覆盖

**Files**：Modify `LegConnector.tsx`（可点击 → 弹菜单 步行/公共交通/驾车/用当天默认 → `updateItem(toItemId, { legMode })`；`source:'google'` 显示实线、`agent` 显示「AI 已查」小标、`heuristic` 虚线「估算」）。

- [ ] jsdom 测试：点击菜单项触发 `onChangeLegMode(toItemId, mode)`。
- [ ] Commit：`feat(routebook): 段方式覆盖`

### 任务 17：撤销环 UI、天顺序调整弹窗、乐观锁提示

**Files**：Create `components/DayOrderDialog.tsx`（列表内 dnd-kit 排序、任意位置插入、空天可删）；Modify `DayPlanSidebar.tsx`（撤销按钮 hover 显示 `undoLabel`；「调整天顺序」按钮）、`useTripData.ts`（409 `stale` → 顶部提示条「行程已在别处修改」+ 刷新按钮）。

- [ ] jsdom 测试：`DayOrderDialog` 提交 `orderedDayIds`；撤销环 push/pop 顺序（`tests/routeBook/undo.test.ts`，把撤销环抽成纯类 `UndoRing` 放 `lib/routeBook/undoRing.ts`）。
- [ ] Commit：`feat(routebook): 撤销、天顺序调整、并发提示`

**B2 验收**：能加酒店并设住宿区间 → 优化时以酒店成环；连接行在步行/驾车段显示 Google 真实时长与道路几何，公交段为估算（日本无 Google 公交数据，agent 导入的段显示「AI 已查」）；备注可加；撤销可用；`npm test` 全绿。

---

## B3 移动端与执行

### 任务 18：移动端布局

**Files**：Create `components/mobile/DayPillTrack.tsx`、`components/mobile/MobilePlanView.tsx`（当前天时间线 + 左滑操作：用 `pointer` 事件自实现 80px 阈值，或 `@dnd-kit` 不适用则用简单 touch handler；长按 200ms 拖动排序）、`components/mobile/MobileDock.tsx`（点位池 / 优化 / 打开导航 / 开始 Day N）、`components/mobile/DaySummaryBar.tsx`；Modify `ui.tsx`（`isMobile` 分支换成新结构）、`MobilePointPoolSheet.tsx`（「+」加到当前天）。

- [ ] jsdom 测试：`DayPillTrack` 点击切换 `selectedDayId`；`MobilePlanView` 「移到…」菜单调 `reorder`。
- [ ] Commit：`feat(routebook): 移动端按天规划布局`

### 任务 19：沉浸模式收尾

**Files**：Modify `RouteBookImmersiveMode.tsx`（无日期时的选天 sheet；「明天从 X 开始」；place 条目导航用 place 坐标）。

- [ ] Commit：`feat(routebook): 沉浸模式按天执行收尾`

**B3 验收**：iPhone 尺寸下能从池子加点、切天、拖序、优化、开始导航。

---

## B4 锦上添花

### 任务 20：GCJ-02 与导航深链

**Files**：Create `lib/geo/gcj02.ts`（`wgs84ToGcj02`、`gcj02ToWgs84`（迭代 ≤ 30 次至 1e-7）、`isOutsideChina`（经度 72.004–137.8347、纬度 0.8293–55.8271 之外为外）——**自行按公开公式实现**）、`lib/route/navigationTargets.ts`（`buildSingleTargets({lat,lng,name}, mode)` 与 `buildDayTargets(stops[], mode)` 返回 `NavTarget[] = { provider:'google'|'apple'|'amap', label, url, note? }`；`orderTargets(targets, { isIOS, locale })`；高德整天：Android `amapuri://route/plan/?sourceApplication=seichigo&dlat&dlon&dname&dev=0&t=1` + `vialons/vialats/vianames`（逗号分隔，最多 16 个），iOS `iosamap://path?sourceApplication=seichigo&dlat&dlon&dname&dev=0&t=1`；网页回退 `https://ditu.amap.com/dir?from[lnglat]=lng,lat&from[name]=…&to[lnglat]=…&to[name]=…&via[0][lnglat]=…&type=bus`）、`components/navigation/OpenInMapsMenu.tsx`（下拉 / action sheet；高德项点击后 `setTimeout 1600ms` 内 `document.visibilityState` 未变 hidden → `window.location.href = webFallback`）；Modify `DayBlock.tsx`、`MobileDock.tsx`、`RouteBookImmersiveMode.tsx` 用它；把 `app/(authed)/plan/[id]/lib/navigationLinks.ts` 里的 Google 逻辑迁入 `lib/route/navigationTargets.ts` 并让原文件 re-export。

- [ ] 测试：`tests/geo/gcj02.test.ts`（东京 35.6762,139.6503 在中国外不转；上海 31.2304,121.4737 与拉萨 29.65,91.1 往返误差 < 1m；`isOutsideChina` 边界）；`tests/route/navigationTargets.test.ts`（三平台 URL；高德坐标已是 GCJ-02（对上海断言与 wgs 不同且差值在 300–900m 内）；Apple 仅起终点；排序三种情况）。
- [ ] Commit：`feat(route): 三家导航深链与 GCJ-02`

### 任务 21：天气

**Files**：Create `lib/weather/openMeteo.ts`（`fetchDailyForecast({lat,lng,from,to})` → `{ date, tMax, tMin, code }[]`，URL `https://api.open-meteo.com/v1/forecast?latitude&longitude&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo&start_date&end_date`；超过 16 天的日期不请求）、`app/api/weather/route.ts`（登录用户；`Cache-Control: public, max-age=3600`）、`components/WeatherBadge.tsx`（code → emoji 映射：0 ☀️、1–3 ⛅、45/48 🌫️、51–67 🌧️、71–77 ❄️、80–82 🌦️、95–99 ⛈️）；Modify `DayBlock.tsx` 标题行、`DayDetailCard.tsx`、`DaySummaryBar.tsx`。天气坐标取当天第一个有坐标条目（或住宿）。

- [ ] 测试：`tests/weather/openMeteo.test.ts`（mock fetch 解析；失败返回 []）。
- [ ] Commit：`feat(routebook): 每日天气`

### 任务 22：GPX / ICS 导出

**Files**：`npm i fast-xml-parser`；Create `lib/routeBook/exportGpx.ts`（`buildGpx(detail, previews, scope)`：`<gpx version="1.1" creator="SeichiGo">`，`<wpt lat lon><name><desc><sym>`，每天 `<rte><name>Day N</name><rtept…>`）、`lib/routeBook/exportIcs.ts`（`buildIcs(detail, previews)`：`VCALENDAR/PRODID:-//SeichiGo//RouteBook//ZH`，每天全天 `VEVENT`（`DTSTART;VALUE=DATE`），带 `timeStart` 条目 `DTSTART;TZID=Asia/Tokyo`，`timeEnd` 缺省 +60min；行按 75 字节折叠 `\r\n `；`UID = <itemId>@seichigo.com`）、`lib/routeBook/handlers/export.ts`、`app/api/me/routebooks/[id]/export.gpx/route.ts`、`export.ics/route.ts`（`Content-Disposition: attachment; filename="<title>.gpx"`，文件名做 `encodeURIComponent`）；Modify `DayPlanSidebar.tsx` 工具栏「导出」下拉、`MobileDock.tsx` 更多菜单。

- [ ] 测试：`tests/routeBook/exportGpx.test.ts`、`exportIcs.test.ts` 用固定输入做快照（`toMatchInlineSnapshot`）；ICS 无日期 → 400。
- [ ] Commit：`feat(routebook): GPX 与 ICS 导出`

**B4 验收**：全部 v1 范围可用；`npm test` 全绿；`npm run cf:build` 通过。

---

## 评审修订记录（2026-09-23，Opus 审查后）

采纳的修改：`/points` 保留为兼容壳（公共地图在用）；迁移 DDL 用 `prisma migrate diff` 生成、用 `db execute + migrate resolve` 应用、禁止 `migrate dev`；旧导出的 `Day N` zone 迁到对应天；时间锚改为 `locked && timeStart`，导入只对 `schedule.confidence==='explicit'` 上锁；25 上限只数 point/place 且未安排区不限；transit 条目通过 `payload.transitBetween` 附着并在错位时失效；lodging `toDayIndex` 为退房日、重叠按夜晚判断、导入 `to = 末晚+1`；`resolveDayAnchors` 支持换酒店日；同天去重跨天允许；跨行程本 id 校验；reorder 列表必须完整；所有写入推进 `updatedAt`；`updateItem` 也跑锚校验；日本境内 transit 不调 Google；legs 批量缓存读 + 并发 4 + 8 秒截止 + 限流；`routeGeometry.ts` 不动；`RoutePreviewMap` 以可选 props 扩展并拆文件；右栏三 chip 定义修正；任务 12 改为 URL 参数带回导入结果并抽 hook；补 `runtime='nodejs'`、`tx`-only、回滚说明、Prisma mock 测试与迁移数据核对。

## 自查记录（计划作者）

- 设计稿 §1 模型 → 任务 1–3；§1 迁移 → 任务 1；§1 agent 映射 → 任务 6；§2 路由 → 任务 4/7/15/22/21；§2 优化 → 任务 5；§2 段 → 任务 7/15；§2 导出 → 任务 22；§2 深链/GCJ → 任务 20；§3 左栏 → 9/14/16/17；§3 地图 → 10/13；§3 右栏 → 10/13；§3 /plan 侧 → 12；§3 沉浸 → 11/19；§4 移动端 → 11（最小）/18；§4 降级表 → 4（错误映射）/7/15/20/21；§5 测试 → 各任务；§6 批次 → 本文结构。
- 命名一致性：`RouteBookRuleError.reason` 与 `errors.ts` 映射一一对应；`LegResolver` 在任务 7 定义、任务 15 实现、`RouteBookApiDeps.legResolver` 注入；`resolveDayAnchors` 在任务 5 定义、任务 7 与 4 使用；拖拽前缀在任务 8 定义、9/10/18 使用；`pointCoords` 在任务 4 加入 deps、任务 7 使用。
