# 我的地图升级为按天行程本 — 实施计划（2026-09-23）

> **执行者须知**：本计划面向零上下文的执行者（opencode）。设计依据是 `docs/superpowers/specs/2026-09-23-routebook-day-planner-design.md`，有冲突以本计划为准，本计划没写的以设计稿为准。按批次（B1 → B4）执行，每批内按任务顺序；每个任务：先写测试 → 跑失败 → 实现 → 跑通过 → `git commit`。不要在一个 commit 里塞多个任务。
>
> **硬约束**
> - 分支 `feat/routebook-day-planner`，工作目录就是本仓库根。**不要 `git push`，不要 `git merge`，不要切分支。**
> - 不要碰 `features/map/**`、`components/map/**`、`lib/planAgent/**`（只读引用，不改）、`prisma/migrations/` 里已有目录。
> - 任何文件 ≤ 750 行（`npm test` 会先跑行数预算检查）；**不要**往 `line-budget.allowlist.json` 加条目，超了就拆文件。
> - 不要 `as any` / `@ts-ignore`。
> - 不要新建 Prisma client，只用 `@/lib/db/prisma`。
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
- `RouteBookApiDeps = { repo, pointPoolRepo, getSession, now }`（`lib/routeBook/api.ts`）。
- Prisma 现有模型 `RouteBook { id userId title status metadata createdAt updatedAt }`、`RouteBookPoint { id routeBookId pointId sortOrder zone createdAt }`（`prisma/schema.prisma` 约 872–905 行）。`UserPointPool` 是用户全局点位池，不动。
- 迁移目录命名 `YYYYMMDDHHMMSS_snake_name/migration.sql`，最新是 `20260911090000_add_agent_run_started_at`。
- `/plan` 导出：`lib/tripPlan/handlers/exportRouteBook.ts`（`createExportRouteBookHandler(deps).POST(planId)`），依赖 `RouteBookExportStore { findBySourcePlanId, createWithPoints }`；路由 `app/api/me/plans/[id]/export-routebook/route.ts`；测试 `tests/tripPlan/exportRouteBook.test.ts`（用 `MemoryTripPlanRepo` + `MemoryRouteBookExportStore`）。**现状 bug**：它写 `zone: "Day N"`，而 `repoPrisma.getById` 只保留 `sorted|unsorted`，导出后路线本为空。
- TripPlan 类型（`lib/tripPlan/repo.ts`）：`TripPlanItemType = 'point' | 'transit' | 'meal' | 'lodging' | 'attraction' | 'free'`；`TripPlanItem { id dayId sortOrder type pointId timeHint title note reason payload point }`；`TripPlanDay { dayIndex date citySlug summary items }`；`TripPlan { startDate dayCount ... }`。
- agent 的外部地点载荷 `payload.place`：`{ placeId, name, lat, lng, address?, ... }`，合法性用 `validateExternalPlacePayload(value)`（`lib/googlePlaces/places.ts:442`，返回 `null` 表示合法）。交通载荷 `payload.transport`：`{ mode: 'walk'|'transit'|..., durationMin, distanceKm, mapsUrl, transfers, provider, estimated, source, note, legs }`。
- 直线估算：`lib/planAgent/enrich/heuristicTransit.ts` 导出 `computeHeuristicTransitCore(from, to) → { mode:'walk'|'transit', durationMin, distanceKm, mapsUrl }`（≤1.5km 步行 4.5km/h，否则 25km/h+12min）。可以 import 使用，不要改它。
- Google Directions：`lib/directions/googleClient.ts` 导出 `fetchGoogleDirections`、`isWithinJapan(lat,lng)`、`decodePolyline`、`readOverviewPolyline`、`parseRouteLegs`、`GoogleTravelMode = 'walking'|'transit'|'driving'`；deps 工厂 `lib/directions/api.ts`（`apiKey` 来自 `GOOGLE_DIRECTIONS_API_KEY || GOOGLE_MAPS_API_KEY`）。
- 地理编码：`lib/share/geocode.ts` 的 `fetchMapTilerAddresses`（反向地理编码）；正向搜索需新加（B2）。
- 前端详情页：`app/(authed)/me/routebooks/[id]/{page.tsx,ui.tsx,types.ts,utils.ts}`，`components/{PlannerMapStage,PlannerRoutePanel,PlannerPointPoolPanel,PointCard,DroppablePanel,RouteBookImmersiveMode,TransitGuidance,MobilePointPoolSheet,RouteBookPlannerHeader,RouteBookSelector,...}.tsx`，`hooks/{useRouteBookDetail.tsx(587 行),useRouteGeometry.ts}`。`ui.tsx` 桌面为 `lg:grid-cols-[420px_minmax(0,1fr)_420px]` 三栏；移动端为「路线 / 点位池」两 tab + 底部「开始导航」按钮。
- 拖拽 id 约定在 `types.ts`：`SORTED_DND_PREFIX='sorted:'`、`UNSORTED_DND_PREFIX='unsorted:'`、`POOL_DND_PREFIX='pool:'`；`DRAG_SAFE_CONTROL_PROPS` 用于阻止按钮触发拖拽。
- 沉浸模式 `RouteBookImmersiveMode` props：`{ routeBookTitle, sorted: PointRecord[], checkedInPointIds, getPointPreview, onCheckInSuccess, onUndoCheckIn, onClose }`，内部按 `sorted` 顺序逐点导航。
- `/plan` 的保存按钮在 `app/(authed)/plan/[id]/components/DayCards.tsx:433–456`，POST `/api/me/plans/${planId}/export-routebook`，成功后 `router.push('/me/routebooks/<id>')`；文案 key `day.saveToMyMap` / `day.savedViewMap` / `day.saveFailed`（`lib/i18n/locales/{zh,en,ja}.json`）。
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

- [ ] 迁移 SQL（建表 + 搬数据，一个文件）：

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

-- 数据搬运：每本建 Day 1；sorted → Day 1，unsorted → 未安排
INSERT INTO "RouteBookDay" ("id","routeBookId","dayIndex")
SELECT 'rbd_' || md5(random()::text || rb."id"), rb."id", 1 FROM "RouteBook" rb;

INSERT INTO "RouteBookItem" ("id","routeBookId","dayId","sortOrder","kind","pointId","createdAt")
SELECT 'rbi_' || md5(random()::text || p."id"), p."routeBookId",
       CASE WHEN p."zone" = 'sorted' THEN d."id" ELSE NULL END,
       p."sortOrder", 'point', p."pointId", p."createdAt"
FROM "RouteBookPoint" p
JOIN "RouteBookDay" d ON d."routeBookId" = p."routeBookId" AND d."dayIndex" = 1;

-- startDate 回填（metadata.startDate 可解析时）
UPDATE "RouteBook" SET "startDate" = ("metadata"->>'startDate')::timestamp
WHERE "metadata" ? 'startDate' AND ("metadata"->>'startDate') ~ '^\d{4}-\d{2}-\d{2}';
```

  **不要**在这次迁移里 drop `RouteBookPoint`。

- [ ] `npx prisma generate`；`npm run typecheck:app` 此时会因为 `repoPrisma.ts` 等仍引用旧表而通过（旧表还在），继续下一任务。
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

  规则实现细节（Memory 与 Prisma 两边必须一致）：
  - `reorderItems`：`orderedItemIds` 必须全部属于本行程本；不在目标天的条目视为移入；目标天条目数（含移入）> 25 → `day_limit`；**时间锚校验**：取新顺序里所有 `timeStart != null` 的条目，其 `timeStart` 必须非递减，否则 `anchor_order`（消息：`「${later.title}」(${later.timeStart}) 必须排在「${earlier.title}」(${earlier.timeStart}) 之后`；title 取 item.title，point/place 没有 title 时用 `点位`/`地点`）。写入后目标天与源天各自 `sortOrder` 从 0 重编；`dayId=null` 的「未安排」同样可作为目标。
  - `createItem`：`index` 缺省末尾；同样受 25 上限；`kind=point` 且同一 `pointId` 已在本行程本任何天 → 直接返回已有条目（幂等），不重复创建。
  - `insertDay(afterDayIndex)`：`afterDayIndex` ∈ [0, dayCount]；新天 `dayIndex = afterDayIndex+1`，其后各天 +1；lodging 的 `fromDayIndex/toDayIndex >= afterDayIndex+1` 者 +1；`dayCount+1`（上限 30）。
  - `deleteDay`：其后各天 -1；lodging 区间 `> 被删下标` 的 -1，`from==to==被删` 的整条删掉，跨过它的 `to -1`。
  - `reorderDays`：只重编 `dayIndex`（并按 `startDate` 重算 `date`），lodging 不动。
  - `update` 里 `startDate` 变化 → 所有天 `date = startDate + (dayIndex-1) 天`（UTC 日期，00:00）；`startDate=null` → 各天 `date=null`。`dayCount` 只允许增大，减小 → `invalid`。
  - `deletePlace` 级联删 `items.placeId` 与 `lodgings.placeId`。`createPlace` 超过 50 → `place_limit`。
  - `createLodging`/`updateLodging`：`from <= to`，且与同本其它区间不相交，否则 `lodging_overlap`；`placeId` 必须是本行程本 `kind=lodging` 的自定义点，否则 `invalid`。
  - `listByUser.firstPointImage`：取 `dayIndex` 最小的天里 `sortOrder` 最小的 `point` 条目的图；没有则 null。

- [ ] `repoMemory.ts` 用 Map 实现以上全部；`tests/routeBook/repoMemory.test.ts` 覆盖：创建自动建天、insertDay/deleteDay 对 lodging 下标的影响、reorderDays 不动 lodging、reorderItems 天内/跨天/25 上限/锚顺序、createItem 幂等、deletePlace 级联、lodging 重叠、update 的 startDate 重算与 stale。
- [ ] `npx vitest run tests/routeBook/repoMemory.test.ts` 通过。Commit：`feat(routebook): 行程本仓储接口与内存实现`

### 任务 3：Prisma 实现

**Files**：Rewrite `lib/routeBook/repoPrisma.ts`（超 750 行就拆成 `repoPrisma.ts` + `repoPrismaItems.ts` + `repoPrismaDays.ts`，主类组合调用）。

- [ ] 所有写操作用 `prisma.$transaction`；`getById` 一次 `findFirst` + `include: { days: { orderBy: { dayIndex: 'asc' } }, items: { orderBy: [{ dayId: 'asc' }, { sortOrder: 'asc' }] }, places: true, lodgings: true }`，`items` 里 `point` 关系不 include（前端仍走现有点位预览接口）。
- [ ] 规则与内存版完全一致（把校验函数抽到 `lib/routeBook/rules.ts` 共用：`assertAnchorOrder(items)`、`assertDayLimit(count)`、`assertLodgingNoOverlap(list, candidate)`、`shiftLodgingsForInsert/Delete`、`computeDayDate(startDate, dayIndex)`），两边都 import `rules.ts`。
- [ ] `tests/routeBook/rules.test.ts` 覆盖 `rules.ts` 的每个函数。
- [ ] `npm run typecheck:app` 通过（此时 `handlers/routebookPoints.ts` 等会报错——任务 4 处理，本任务可临时把它们留着不 typecheck 到，或者直接进任务 4 再一起跑）。Commit：`feat(routebook): 行程本 Prisma 仓储`

### 任务 4：Handlers 与路由

**Files**：Create `lib/routeBook/handlers/{items.ts,days.ts,places.ts,lodgings.ts,optimize.ts,schemas.ts,errors.ts}`；Modify `lib/routeBook/handlers/routebooks.ts`；Delete `lib/routeBook/handlers/routebookPoints.ts` 与 `app/api/me/routebooks/[id]/points/route.ts`；Create 路由 `app/api/me/routebooks/[id]/{days/route.ts,days/reorder/route.ts,days/[dayId]/route.ts,days/[dayId]/optimize/route.ts,items/route.ts,items/reorder/route.ts,items/[itemId]/route.ts,places/route.ts,places/[placeId]/route.ts,lodgings/route.ts,lodgings/[lodgingId]/route.ts}`；Delete `tests/routeBook/point-pool-sync.test.ts`，Create `tests/routeBook/handlers.test.ts`。

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
export const reorderItemsSchema = z.object({ dayId: z.string().min(1).nullable(), orderedItemIds: z.array(z.string().min(1)).max(DAY_ITEM_LIMIT + 1), updatedAt: z.string().datetime().optional() })
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
- [ ] `optimize.ts` handler：`POST /days/[dayId]/optimize`——读 detail，收集该天 `point`/`place` 且有坐标的条目（point 的坐标用 `deps.pointCoords(pointIds)`——在 `RouteBookApiDeps` 新增 `pointCoords: (pointIds: string[]) => Promise<Map<string, { lat: number; lng: number }>>`，Prisma 实现查 `AnitabiPoint` 的 `geo`/lat/lng 字段——看 `prisma/schema.prisma` 里 `AnitabiPoint` 的坐标字段名并按 `features/map` 现有读取方式取），锚点由当天 lodging 决定（任务 5 的 `resolveDayAnchors`），调 `optimizeDay`，`repo.replaceDayOrder` 写回，返回 `{ ok: true, before, after, distanceBeforeM, distanceAfterM }`。
- [ ] `tests/routeBook/handlers.test.ts`（用 `InMemoryRouteBookRepo` + `InMemoryPointPoolRepo` + `pointCoords` 假实现）覆盖：401/404/403；items 增删改；reorder 天内、跨天、未安排↔天、25 上限 400、锚顺序 409 与消息文本；点位池同步；days 插入/删除/重排；places 级联；lodgings 重叠；PATCH 乐观锁 409；optimize 返回顺序且写回。
- [ ] `npm run typecheck:app && npm run typecheck:tests && npx vitest run tests/routeBook` 通过。Commit：`feat(routebook): 按天条目/天/自定义点/住宿 handlers 与路由`

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

  算法：
  1. `free = points.filter(!fixed)`；`free.length < 2` → 返回原顺序。
  2. 最近邻：起点 = `anchors.start`，没有则 `free[0]`；每步选未访问中距当前最近者。
  3. 2-opt：对序列 `seq`（前面虚拟接 start、后面虚拟接 end，若存在），反复对所有 `i<j` 尝试反转 `seq[i..j]`，若总长减小则接受；直到一轮无改进或迭代 200 轮。
  4. 回填：结果数组长度 = points.length；先把 fixed 项放回其原下标，再把优化后的 free 序列按顺序填入空位。
- [ ] `anchors.ts`：`resolveDayAnchors(dayIndex, lodgings, places): Anchors`——找覆盖 `dayIndex` 的 lodging（`from <= dayIndex <= to`）：`dayIndex == from && from != to` → 只有 `end`；`dayIndex == to && from != to` → 只有 `start`；`from < dayIndex < to` 或 `from == to` → `start = end`；无 → `{}`。坐标取 `places` 里对应 `placeId`。
- [ ] 测试：固定项下标不变；有 start=end 锚时结果首元素是离锚最近的自由点；2-opt 后 `routeDistanceM` ≤ 最近邻结果；单点/全固定原样返回；一个已知交叉的 4 点方形用例（顺序 A,C,B,D 会被修正为 A,B,C,D 或其逆）；`resolveDayAnchors` 四种情况。
- [ ] Commit：`feat(routebook): 当天顺序优化（最近邻 + 2-opt，住宿锚点）`

### 任务 6：agent 导入重写

**Files**：Rewrite `lib/tripPlan/handlers/exportRouteBook.ts`；Rewrite `lib/routeBook/exportStore.ts`、`exportStorePrisma.ts`、`exportStoreMemory.ts`；Rewrite `tests/tripPlan/exportRouteBook.test.ts`。

- [ ] `exportStore.ts`：

```ts
export type ExportDay = { dayIndex: number; date: Date | null; title: string | null }
export type ExportPlace = { tempId: string; kind: PlaceKind; title: string; address: string | null; lat: number; lng: number }
export type ExportItem = { dayIndex: number; sortOrder: number; kind: ItemKind; pointId?: string; placeTempId?: string; title?: string; note?: string; timeStart?: string; payload?: Prisma.InputJsonValue }
export type ExportLodging = { placeTempId: string; fromDayIndex: number; toDayIndex: number }
export type RouteBookExportCreateInput = { userId: string; title: string; status: RouteBookStatus; metadata: Prisma.InputJsonValue; startDate: Date | null; dayCount: number; days: ExportDay[]; places: ExportPlace[]; items: ExportItem[]; lodgings: ExportLodging[] }
export interface RouteBookExportStore { findBySourcePlanId(userId, sourcePlanId): Promise<{ id: string } | null>; createFromPlan(input: RouteBookExportCreateInput): Promise<{ id: string }> }
```

  Prisma 实现在一个事务里：建 book → 建 days → 建 places（记录 tempId→id）→ 建 items（换 placeId）→ 建 lodgings。
- [ ] `exportRouteBook.ts` 把 `TripPlanWithDays` 转成 `RouteBookExportCreateInput`，映射规则（写成纯函数 `buildExportInput(plan): { input, counts }` 放在 `lib/tripPlan/exportMapping.ts` 方便测试）：
  - `point`（有 `pointId`）→ `kind:'point'`；无 `pointId` 跳过。
  - `meal` / `attraction`：`validateExternalPlacePayload(item.payload?.place) === null` → 建 place（meal→`restaurant`，attraction→`other`；title 取 `place.name`，address 取 `place.address ?? null`）+ `kind:'place'`；否则 → `kind:'note'`，`title` 取 item.title，计入 `degradedToNote`。
  - `transit` → `kind:'transit'`，`title` 取 item.title 或 `交通`，`payload` 原样。
  - `lodging`：有合法 `payload.place` → place(`lodging`)；连续天（dayIndex 相邻）且 `place.placeId` 相同的合并为一个 lodging 区间 `[firstDay, lastDay]`；不建 item。无合法 place → `kind:'note'`，计入 `degradedToNote`。
  - `free` → `kind:'note'`。
  - `timeHint` 匹配 `/^([01]?\d|2[0-3]):([0-5]\d)/` → `timeStart` 规范成 `HH:mm`；否则不设。
  - `note`：`[item.note, item.reason].filter(Boolean).join('\n')` 或 undefined。
  - days：按 `dayIndex` 升序，`date` 取 `TripPlanDay.date`，`title` 取 `summary` 前 60 字或 null；`dayCount = max(dayIndex)`（至少 1）；`startDate = plan.startDate`。
  - `counts = { days, points, places, notes, transits, lodgings, degradedToNote }`。
  - 没有任何 item 可导 → 400「计划还没有可导出的条目」。
  - 响应：`{ ok: true, routeBookId, created: true, counts }`；已存在 → `{ ok: true, routeBookId, created: false }`。
- [ ] 测试（改写现有文件）：六种 type 各一例并断言映射；lodging 连续三天合并成一个区间、中间换酒店拆两个；无坐标 meal 降级 note 且计数；`timeHint` `"10:30"`/`"上午10:30"`/`"上午"` 三种输入；重复导入幂等；401/403/404 保留。
- [ ] Commit：`feat(plan): 计划按天导入行程本（点位/自定义点/备注/交通/住宿）`

### 任务 7：段与交通（B1 只做 heuristic + 结构，Google 在 B2 接）

**Files**：Create `lib/routeBook/legs.ts`、`lib/routeBook/handlers/legs.ts`、`app/api/me/routebooks/[id]/days/[dayId]/legs/route.ts`；Test `tests/routeBook/legs.test.ts`。

- [ ] `legs.ts`：

```ts
export type LegSource = 'google' | 'agent' | 'heuristic'
export type Leg = { fromId: string; toId: string; mode: TravelMode; durationSec: number; distanceM: number; polyline: [number, number][] | null; source: LegSource }
export type LegStop = { id: string; lat: number; lng: number; legMode: TravelMode | null }
/** 组装当天停靠序列：住宿首尾按 resolveDayAnchors 规则（id 用 'lodging:start' / 'lodging:end'），中间是有坐标的 point/place 条目；transit 条目不进序列但记录 "接管" 关系 */
export function buildDayStops(day, items, places, lodgings, pointCoords): { stops: LegStop[]; agentLegs: Map<string /* toId */, Prisma.JsonValue /* payload.transport */> }
export type LegResolver = (from: LatLng, to: LatLng, mode: TravelMode) => Promise<Omit<Leg, 'fromId' | 'toId' | 'mode'> | null>
export async function resolveDayLegs(stops, agentLegs, defaultMode: TravelMode, resolver: LegResolver): Promise<Leg[]>
```

  - `resolveDayLegs`：对相邻 `stops[i]→stops[i+1]`：若 `agentLegs.has(to.id)` → 用 agent payload（`durationSec = durationMin*60`，`distanceM = distanceKm*1000`，mode 由 payload.mode 映射 `walk→walking`、`transit→transit`、其它→`driving`，`polyline:null`，`source:'agent'`）；否则 `mode = to.legMode ?? defaultMode`，调 `resolver`；返回 null 时用 `computeHeuristicTransitCore` 估算（`source:'heuristic'`，`polyline:null`）。
  - B1 的 handler 传入的 `resolver` 恒返回 null（全部 heuristic）；B2 接 Google + 缓存。
- [ ] 测试：住宿首尾三种情况；transit 条目接管；legMode 覆盖默认；resolver 为 null 时 heuristic；note 条目被跳过。
- [ ] Commit：`feat(routebook): 当天段序列与交通估算`

### 任务 8：前端类型与数据层（B1-前端从这里开始）

**Files**：Rewrite `app/(authed)/me/routebooks/[id]/types.ts`、`utils.ts`；Create `hooks/useTripData.ts`、`hooks/useTripDnd.ts`、`hooks/useDayLegs.ts`；Delete `hooks/useRouteBookDetail.tsx`（把点位预览拉取 `getPointPreview`、打卡状态、标题编辑等仍需要的逻辑搬到 `useTripData.ts`，不要丢功能）。

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
- [ ] `TimelineItem`：`useSortable({ id: 'item:'+item.id, disabled: item.kind === 'transit' })`；四种样式：point（缩略图 + 名 + 作品名，沿用 `PointCard.tsx` 视觉）、place（kind 图标 + 名 + 地址）、note（图标/颜色）、transit（线路/时长，无手柄，浅底）；时间徽章；锁图标；悬停操作：设时间（inline `<input type="time">`）、锁定、删除、移到…（下拉列出各天 + 未安排，调 `reorder`）。
- [ ] `LegConnector`：两条有坐标条目之间；`routeVisible` 时显示「图标 · N 分钟 · X km」，`source:'heuristic'` 灰色 + 「估算」。
- [ ] `UnassignedBlock`：`day:unassigned` droppable，同样 SortableContext。
- [ ] Commit：`feat(routebook): 按天日程侧栏`

### 任务 10：右栏与地图

**Files**：Modify `components/PlannerPointPoolPanel.tsx`、`components/PlannerMapStage.tsx`、`hooks/useRouteGeometry.ts`。

- [ ] 右栏：三个 chip（全部 / 未安排 / 已安排；「已安排」= pointId 出现在 `detail.items` 里）；作品筛选下拉（按预览 subtitle 聚合）；搜索框过滤池内；条目：「+」→ `addItem(selectedDayId ?? null, {kind:'point', pointId})`；已安排显示「Day N · 序号」并点击触发 `onFocusPoint`；拖拽 id `pool:<pointId>`。自定义点列表（B2）。
- [ ] 地图：接收 `detail`、`selectedDayId`、`legsForSelectedDay`；标记来源 = 所有 point/place 条目；顺序徽标（同一 pointId 多天 → `1·3`）；选中天标记放大、其它天 `opacity 0.45`、未安排空心；当天路线：先用 stops 直线，`legs` 有 polyline 的段替换（B1 全是 heuristic → 全直线，B2 起真实）；样式：底层线宽 8 `#7c2d3a` 透明 0.35，上层线宽 4 `#f43f5e`；heuristic 段 `line-dasharray [2,2]`。标记 draggable（`marker:<itemId>` 或 `marker:point:<pointId>` 表示未在行程本里的池内点位——B1 只做已在行程本里的条目标记可拖）。
- [ ] `useRouteGeometry.ts` 不再拉 `/route-geometry` 整条几何，改为用 `legs`；保留文件名，内部换实现。
- [ ] Commit：`feat(routebook): 点位池三态筛选与按天地图`

### 任务 11：页面编排、移动端最小适配、沉浸模式按天

**Files**：Modify `ui.tsx`、`components/RouteBookImmersiveMode.tsx`、`components/MobilePointPoolSheet.tsx`。

- [ ] `ui.tsx`：用 `useTripData` + `useTripDnd` 替换旧 hook；桌面三栏：左 `DayPlanSidebar`、中 `PlannerMapStage`、右 `PlannerPointPoolPanel`；`DndContext` 包住三栏；`DragOverlay` 渲染当前拖动条目的简版卡片。
- [ ] 移动端（B1 最小版，B3 再重做）：顶部横向天胶囊（简单按钮组）+ 现有「路线 / 点位池」两 tab 保留，其中「路线」显示选中天的 `DayBlock`。
- [ ] 沉浸模式：props `sorted: PointRecord[]` 改为 `sequence: ItemRecord[]` + `places: PlaceRecord[]` + `dayLabel: string`；内部对 `kind:'place'` 的条目用 place 坐标/名字，打卡只对 `kind:'point'` 可用；最后一站完成时若有下一天显示「Day N 完成 → 明天从 X 开始」。入口按钮文案「开始 Day N」，`pickTodayDayId` 决定 N；无日期 → 先弹一个选天 sheet。
- [ ] `npm run typecheck:app && npm run typecheck:tests && npm test` 全绿。Commit：`feat(routebook): 行程本页面按天编排与沉浸模式按天`

### 任务 12：/plan 导入入口文案与跳转

**Files**：Modify `app/(authed)/plan/[id]/components/DayCards.tsx:433–456`；`lib/i18n/locales/{zh,en,ja}.json`。

- [ ] 成功响应含 `counts` 时 toast（复用页面现有提示机制）：zh「已按 {days} 天导入：{points} 个点位、{transits} 条交通、{lodgings} 个住宿」+（`degradedToNote>0` 时）「，{n} 条作为备注导入」；en/ja 对应写。新 key：`day.importSummary`、`day.importDegraded`。然后 `router.push('/me/routebooks/'+id)`。
- [ ] Commit：`feat(plan): 导入行程本结果提示`

**B1 验收**：`npm test` 全绿；`npm run db:migrate:dev` 在开发库跑通（`.env` 的 DATABASE_URL）；本地 `npm run dev` 打开一个旧路线本，原「已排序」点位在 Day 1、「未排序」在未安排；从 /plan 导入一个计划后按天显示；能拖、能优化。

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

**Files**：Create `lib/routeBook/legCache.ts`（`getCachedLeg(key)`/`setCachedLeg(key, payload, ttlDays=7)`，key = `sha256(\`${lat5},${lng5}|${lat5},${lng5}|${mode}\`)`，坐标 `toFixed(5)`；`prisma.routeLegCache` 读写；过期即视为未命中并删除）、`lib/routeBook/legResolverGoogle.ts`（实现 `LegResolver`：先查缓存；`isWithinJapan` 两端都成立才调 `fetchGoogleDirections`，mode 直传；成功取 `overview polyline` 解码为 `[lat,lng][]`、总时长/距离；写缓存；失败返回 null）；Modify `handlers/legs.ts`（注入 `legResolverGoogle`；每次请求最多 24 次真实调用，超出的段返回 heuristic）、`lib/routeBook/handlers/routeGeometry.ts`（删除进程内 Map 缓存，改用 `legCache.ts`；限流逻辑保留）。`RouteBookApiDeps` 增加 `legResolver: LegResolver`（Prisma 工厂用 Google 实现，测试用假实现）。

- [ ] 测试 `tests/routeBook/legCache.test.ts`（用假的 prisma 双：命中/未命中/过期）、`legResolverGoogle.test.ts`（mock `fetchGoogleDirections`：日本外不调、失败返回 null、成功写缓存）。
- [ ] Commit：`feat(routebook): 段间交通接 Google Directions 与持久缓存`

### 任务 16：连接行交互与段方式覆盖

**Files**：Modify `LegConnector.tsx`（可点击 → 弹菜单 步行/公共交通/驾车/用当天默认 → `updateItem(toItemId, { legMode })`；`source:'google'` 显示实线、`agent` 显示「AI 已查」小标、`heuristic` 虚线「估算」）。

- [ ] jsdom 测试：点击菜单项触发 `onChangeLegMode(toItemId, mode)`。
- [ ] Commit：`feat(routebook): 段方式覆盖`

### 任务 17：撤销环 UI、天顺序调整弹窗、乐观锁提示

**Files**：Create `components/DayOrderDialog.tsx`（列表内 dnd-kit 排序、任意位置插入、空天可删）；Modify `DayPlanSidebar.tsx`（撤销按钮 hover 显示 `undoLabel`；「调整天顺序」按钮）、`useTripData.ts`（409 `stale` → 顶部提示条「行程已在别处修改」+ 刷新按钮）。

- [ ] jsdom 测试：`DayOrderDialog` 提交 `orderedDayIds`；撤销环 push/pop 顺序（`tests/routeBook/undo.test.ts`，把撤销环抽成纯类 `UndoRing` 放 `lib/routeBook/undoRing.ts`）。
- [ ] Commit：`feat(routebook): 撤销、天顺序调整、并发提示`

**B2 验收**：能加酒店并设住宿区间 → 优化时以酒店成环；连接行显示真实公交时长；备注可加；撤销可用；`npm test` 全绿。

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

## 自查记录（计划作者）

- 设计稿 §1 模型 → 任务 1–3；§1 迁移 → 任务 1；§1 agent 映射 → 任务 6；§2 路由 → 任务 4/7/15/22/21；§2 优化 → 任务 5；§2 段 → 任务 7/15；§2 导出 → 任务 22；§2 深链/GCJ → 任务 20；§3 左栏 → 9/14/16/17；§3 地图 → 10/13；§3 右栏 → 10/13；§3 /plan 侧 → 12；§3 沉浸 → 11/19；§4 移动端 → 11（最小）/18；§4 降级表 → 4（错误映射）/7/15/20/21；§5 测试 → 各任务；§6 批次 → 本文结构。
- 命名一致性：`RouteBookRuleError.reason` 与 `errors.ts` 映射一一对应；`LegResolver` 在任务 7 定义、任务 15 实现、`RouteBookApiDeps.legResolver` 注入；`resolveDayAnchors` 在任务 5 定义、任务 7 与 4 使用；拖拽前缀在任务 8 定义、9/10/18 使用；`pointCoords` 在任务 4 加入 deps、任务 7 使用。
