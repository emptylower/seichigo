# 我的地图升级为按天行程本（设计）

日期：2026-09-23　状态：已确认，待实施　范围：路线本域 + /plan 导出桥接 + 路线本 UI（桌面与移动）

## 背景

- 「我的地图」（`/me/routebooks`）现在是一条平铺的点位链：`RouteBookPoint.zone` 只有 `sorted` / `unsorted`，没有「天」，没有时间，没有酒店、餐厅、备注这类非圣地条目。
- `/plan` 的 agent 已经能产出按天日程（`TripPlan → TripPlanDay → TripPlanItem`，含 `point | transit | meal | lodging | attraction | free` 六类条目与 `timeHint`），但「存到我的地图」把它压扁，且**现在实际是坏的**：`lib/tripPlan/handlers/exportRouteBook.ts` 以 `zone: "Day N"` 写入，`lib/routeBook/repoPrisma.ts` 的读取只认 `sorted` / `unsorted`，导出后路线本是空的。
- 参照对象：TREK（liketrek/TREK）与其中文分支 T-T（bhxnms/T-T）的规划器交互。两者均为 AGPL-3.0，本仓库为 PolyForm Noncommercial，**不得复制其代码**；本设计只借鉴交互与算法思路（最近邻 + 2-opt、GCJ-02 变换均为公开算法），全部自行实现。

## 目标

1. 一张「地图」= 一次行程：有天数、可选日期、每天一条按时间线排列的条目列表（点位 / 自定义点 / 备注 / 交通），可拖拽排序与跨天移动，可一键优化当天顺序。
2. `/plan` 生成的计划按天、带条目类型无损导入行程本，导入后可继续手动编辑。
3. 出发当天的沉浸模式按天执行；回来后按天沉淀打卡。
4. 移动端可完成同等规划。

## 非目标

- 不合并 `TripPlan` 与 `RouteBook`：TripPlan 仍是 agent 的工作台，RouteBook 是用户的行程本，两者通过一次性导出互通。
- 不做「让 agent 优化这一天」的反向回灌（v2）。
- 不做 TREK 的费用/分账、行李清单、待办、文件、协作、预订导入、航班/租车模型、插件、PDF 导出、多成员权限、卫星底图。
- 自定义点不「提升」进公共点位库，纯私有。
- 不做多标签页实时同步，只做乐观锁。

## 术语

- **行程本**：升级后的 `RouteBook`。UI 栏目名仍叫「我的地图」，URL 不变（`/me/routebooks`、`/me/routebooks/[id]`）。
- **天**：`RouteBookDay`，`dayIndex` 从 1 起。
- **条目**：`RouteBookItem`，一天时间线上的一行；`dayId = null` 表示在「未安排」区。
- **自定义点**：`RouteBookPlace`，不在 Anitabi 库里的坐标点（酒店、车站、餐厅、其它）。
- **住宿区间**：`RouteBookLodging`，某个自定义点在 `fromDayIndex..toDayIndex` 作为当天锚点。
- **段**：相邻两条有坐标条目之间的一段交通（含当天住宿首尾）。
- **时间锚**：设置了 `timeStart` 或 `locked=true` 的条目；优化与拖拽不得改变时间锚之间的相对顺序。

## 第 1 节：数据模型

Prisma 新增/修改如下（字段名以此为准，实施时按项目命名习惯补 `@@index`）：

```prisma
model RouteBook {
  // 现有字段保留：id/userId/title/status/metadata/createdAt/updatedAt
  startDate DateTime?
  dayCount  Int @default(1)
  days      RouteBookDay[]
  items     RouteBookItem[]
  places    RouteBookPlace[]
  lodgings  RouteBookLodging[]
}

model RouteBookDay {
  id                String   @id @default(cuid())
  routeBookId       String
  dayIndex          Int                       // 1 起
  date              DateTime?                 // 有 startDate 时 = startDate + (dayIndex-1)，服务端派生写入；无日期行程为 null
  title             String?
  defaultTravelMode String   @default("transit") // transit | walking | driving
  items             RouteBookItem[]
  @@unique([routeBookId, dayIndex])
}

model RouteBookItem {
  id          String   @id @default(cuid())
  routeBookId String
  dayId       String?                          // null = 未安排
  sortOrder   Int
  kind        String                           // point | place | note | transit
  pointId     String?                          // kind=point → AnitabiPoint
  placeId     String?                          // kind=place → RouteBookPlace
  title       String?                          // note/transit 用；point/place 展示时取引用对象名
  note        String?
  timeStart   String?                          // "HH:mm"
  timeEnd     String?                          // "HH:mm"
  locked      Boolean  @default(false)
  icon        String?                          // note 用，枚举见第 4 节
  color       String?                          // note 用，枚举见第 4 节
  legMode     String?                          // 覆盖「到达本条」这一段的方式；null = 用当天默认
  payload     Json?                            // agent 带来的 transit 细节 / mealSlot 等原样保留
  createdAt   DateTime @default(now())
  @@index([routeBookId, dayId])
}

model RouteBookPlace {
  id          String   @id @default(cuid())
  routeBookId String
  kind        String                           // lodging | station | restaurant | other
  title       String
  address     String?
  lat         Float
  lng         Float
  note        String?
  createdAt   DateTime @default(now())
}

model RouteBookLodging {
  id           String   @id @default(cuid())
  routeBookId  String
  placeId      String                          // → RouteBookPlace(kind=lodging)
  fromDayIndex Int                             // 入住日
  toDayIndex   Int                             // 退房日（>= fromDayIndex）
  checkIn      String?                         // "HH:mm"
  checkOut     String?                         // "HH:mm"
  note         String?
}

model RouteLegCache {
  key       String   @id                       // sha256(fromLat,fromLng,toLat,toLng,mode)，坐标四舍五入到 5 位
  payload   Json                               // { mode, durationSec, distanceM, polyline, steps? }
  expiresAt DateTime
  @@index([expiresAt])
}
```

约束：

- `RouteBookItem` 的 `kind` 与引用字段一致：`point` 必须有 `pointId`，`place` 必须有 `placeId`，`note` / `transit` 两者皆空。由 handler 的 Zod schema 保证。
- 每天最多 **25 条**（沿用现有 `SORTED_ZONE_LIMIT`，语义改为每天）；每本自定义点最多 **50 个**；`dayCount` 1..30。
- 删除自定义点时，引用它的条目与住宿区间一并删除（handler 内事务）。
- 同一天内 `sortOrder` 连续从 0 起，由服务端在每次写入后重编。
- `startDate` 变化时服务端重算全部 `RouteBookDay.date`。

### 迁移

一次迁移 SQL + 一个数据搬运步骤（放在同一个 migration 里，Neon 上可一次执行）：

1. 建四张新表与 `RouteLegCache`。
2. 每本现有 `RouteBook` 建 `RouteBookDay(dayIndex=1)`。
3. `RouteBookPoint` → `RouteBookItem(kind='point')`：`zone='sorted'` → Day 1 的 `dayId`，`unsorted` → `dayId=null`；`sortOrder` 沿用；`createdAt` 沿用。
4. `RouteBookPoint` 表保留一个发布周期不删（下一次迁移再 drop）；`repoPrisma` 只读写新表。
5. `metadata.sourcePlanId`、`metadata.startDate` 保持原样；`startDate` 列由 `metadata.startDate` 回填（能解析时）。

### 点位池

`UserPointPool` 不变，仍是用户全局的。行程本右栏的三个筛选 = 全部 / 未安排（在池里且不在本行程任一天）/ 已安排（在本行程任一天）。

### agent 导入映射

重写 `lib/tripPlan/handlers/exportRouteBook.ts` 与 `lib/routeBook/exportStore*.ts`。同一 `sourcePlanId` 已导出过则直接返回已有行程本 id，不重复导入（现有行为）。

| `TripPlanItem.type` | 写入 | 备注 |
|---|---|---|
| `point` | `kind=point` | |
| `meal` / `attraction` | `payload.place` 有合法 lat/lng → 先建 `RouteBookPlace`（meal→`restaurant`，attraction→`other`），再 `kind=place`；否则 `kind=note` | 用 `lib/planAgent` 现有的 `validateExternalPlacePayload` 判合法 |
| `transit` | `kind=transit`，`payload` 原样带；`title` 取原 title | 连接行优先显示 agent 已查好的交通 |
| `lodging` | 建 `RouteBookPlace(kind=lodging)` + `RouteBookLodging`；连续多天同一酒店（同名同坐标）合并为一个区间；无坐标 → `kind=note` | |
| `free` | `kind=note` | |
| `timeHint` | 解析为 `timeStart`（仅接受可解析为 `HH:mm` 的值，否则丢弃） | 成为时间锚 |
| `note` / `reason` | 拼进 `RouteBookItem.note` | |

`TripPlan.startDate` → `RouteBook.startDate`；`TripPlanDay.date` → `RouteBookDay.date`；`dayCount` 取实际天数。导入结果返回计数 `{ days, points, places, notes, transits, lodgings, degradedToNote }`，前端 toast 用。

## 第 2 节：服务端

沿用 `app/api/**/route.ts` 薄壳 → `lib/routeBook/handlers/*.ts` → `repo.ts` 接口 + `repoPrisma.ts` / `repoMemory.ts`。现有 `handlers/routebookPoints.ts` 与 `points/route.ts` 由新的 items 接口直接取代（只有站内前端调用，不需要兼容期）。`RouteBookRepo` 里被点位池同步与 `lib/userPointState` 依赖的 `isPointInAnyRouteBook`、`listPointRefsByUser` 保留签名不变，改为查 `RouteBookItem(kind='point')`。

### 路由（均在 `/api/me/routebooks/[id]/` 下，均需登录且 `routeBook.userId === session.user.id`）

| 方法与路径 | 请求 | 响应 / 行为 |
|---|---|---|
| `GET /` | — | `{ ok, routeBook, days[], items[], places[], lodgings[] }`，一次装载 |
| `PATCH /` | `{ title?, status?, startDate?: string\|null, dayCount?, metadata?, updatedAt }` | 乐观锁：`updatedAt` 不等于库中值 → 409 `{ error: 'stale' }`；改 `dayCount` 只允许增（减少用删天） |
| `POST /days` | `{ afterDayIndex }` | 在指定天之后插入空天，后续天 `dayIndex+1`，住宿区间 `>= 插入位` 的下标整体 +1 |
| `PATCH /days/[dayId]` | `{ title?, defaultTravelMode? }` | |
| `DELETE /days/[dayId]` | — | 仅允许空天；后续天下标 -1，住宿区间同步 |
| `POST /days/reorder` | `{ orderedDayIds }` | 重编 `dayIndex`，条目随 `dayId` 走；住宿区间**不动**（住宿按第几晚定义） |
| `POST /items` | `{ dayId: string\|null, kind, pointId?, placeId?, title?, note?, timeStart?, index? }` | 插到指定位置（缺省末尾） |
| `PATCH /items/[itemId]` | `{ title?, note?, timeStart?, timeEnd?, locked?, icon?, color?, legMode? }` | |
| `DELETE /items/[itemId]` | — | |
| `POST /items/reorder` | `{ dayId: string\|null, orderedItemIds }` | 天内排序与跨天移动共用：`orderedItemIds` 为目标天完整顺序，其中不属于目标天的条目即为移入；源天剩余条目自动重编。校验时间锚顺序、25 上限；违反 → 409 `{ error, reason: 'anchor_order' \| 'day_limit' }` |
| `POST /days/[dayId]/optimize` | — | 跑 `optimizeDay`，写回，返回 `{ before: string[], after: string[], distanceBeforeM, distanceAfterM }` |
| `POST /places`、`PATCH /places/[placeId]`、`DELETE /places/[placeId]` | `{ kind, title, address?, lat, lng, note? }` | |
| `POST /lodgings`、`PATCH /lodgings/[lodgingId]`、`DELETE /lodgings/[lodgingId]` | `{ placeId, fromDayIndex, toDayIndex, checkIn?, checkOut?, note? }` | 区间不得与另一区间重叠 |
| `GET /days/[dayId]/legs` | — | `{ legs: [{ fromItemId\|'lodging', toItemId\|'lodging', mode, durationSec, distanceM, polyline, source: 'google'\|'agent'\|'heuristic' }] }` |
| `GET /export.gpx?scope=all\|day&dayIndex=` | — | `application/gpx+xml` 附件 |
| `GET /export.ics` | — | 无日期行程 400 |
| `GET /api/weather?lat&lng&from&to` | — | Open-Meteo 代理，`Cache-Control: public, max-age=3600`，返回每日 `{ date, tMax, tMin, code }` |

现有 `GET /directions` 与 `GET /route-geometry` 保留给沉浸模式与地图，内部改用 `RouteLegCache`。

### 优化算法 `lib/routeBook/optimize.ts`

纯函数，无外部依赖：

```ts
type Pt = { id: string; lat: number; lng: number; fixed: boolean }
type Anchors = { start?: { lat: number; lng: number }; end?: { lat: number; lng: number } }
export function optimizeDay(items: Pt[], anchors: Anchors): string[]  // 返回新顺序的 id
```

- 锚点来自当天住宿区间：入住日只有 `end`，退房日只有 `start`，中间夜 `start = end`（成环）；无住宿则无锚点，从第一个可移动点出发。
- 步骤：最近邻从 `start`（或第一个自由点）起序 → 2-opt 反转消交叉直到无改进（直线 haversine 距离）→ `fixed` 条目回填到原始下标，自由条目按新序依次填入其余下标。
- 可移动点 < 2 时原样返回。
- 服务端跑（v2 agent 回灌复用），前端只调接口。

### 段与交通 `lib/routeBook/legs.ts`

- 段序列：`[住宿(若当天有且非入住日)] → 有坐标条目按 sortOrder → [住宿(若当天有且非退房日)]`。`note` 与无坐标条目跳过。
- `transit` 条目本身不是段：它把「上一个有坐标条目 → 下一个有坐标条目」这一段标为 `source:'agent'`，直接用 `payload.transport`（时长/方式/线路）；没有 `payload.transport` 的 transit 条目按普通段处理。
- 每段方式 = `toItem.legMode ?? day.defaultTravelMode`。
- 数据源：Google Directions（`lib/directions/googleClient.ts`，`isWithinJapan` 门控）；失败、超限或在日本外 → `lib/planAgent/enrich/heuristicTransit.ts` 的估算，`source:'heuristic'`。
- 缓存：`RouteLegCache`，TTL 7 天，跨用户共享；现有 `routeGeometry.ts` 的进程内 Map 缓存移除（Workers isolate 内基本无效）。
- 每次 `GET /legs` 最多发起 24 次 Directions 请求（25 条上限），缓存命中不计。

### 导出

- GPX：每个 `point` / `place` 条目一个 `<wpt>`（`<name>`、`<desc>` 放备注、`<sym>` 放 kind），每天一条 `<rte>` 按顺序含 `<rtept>`；`scope=day` 只输出那一天。用 `fast-xml-parser` 的 `XMLBuilder`（需新增依赖）。
- ICS：每天一个全天 `VEVENT`（SUMMARY = 天标题或「Day N」，DESCRIPTION = 当天条目清单），每条有 `timeStart` 的条目一个定时 `VEVENT`（时区 `Asia/Tokyo`，`timeEnd` 缺省 +60 分钟）；行折叠 75 字节。

### 导航深链 `lib/route/navigationTargets.ts`

扩展现有 `app/(authed)/plan/[id]/lib/navigationLinks.ts` 的能力并搬到 `lib/route/`：

- 单点：Google（现有）、Apple `https://maps.apple.com/?daddr=lat,lng&dirflg=r|w`、高德 `https://uri.amap.com/marker?position=lng,lat&name=…&coordinate=wgs84`。
- 整天：Google `https://www.google.com/maps/dir/lat,lng/…`（现有分块逻辑）；Apple 只支持起终点 → 只给起终点并在菜单项上标「仅起终点」；高德 Android `amapuri://route/plan/?sourceApplication=seichigo&slat&slon&dlat&dlon&dname&dev=0&t=…` + 途经点 `vialons/vialats/vianames`，iOS `iosamap://path?...`，坐标先经 `lib/geo/gcj02.ts` 转 GCJ-02；1.6 秒内页面未 `visibilitychange` 为 hidden 则回退 `https://ditu.amap.com/dir?from[lnglat]=…&via[0][lnglat]=…&to[lnglat]=…&type=bus`。
- 顺序：iOS UA → Apple, Google, 高德；`zh` locale 且非 iOS → 高德, Google, Apple；其余 → Google, Apple, 高德。
- `lib/geo/gcj02.ts`：`wgs84ToGcj02` / `gcj02ToWgs84`（迭代反解）/ `isOutsideChina`；自行实现（公开算法），单测往返误差 < 1 m。

### 校验（Zod，放在 handlers）

- `timeStart` / `timeEnd` / `checkIn` / `checkOut`：`^([01]\d|2[0-3]):[0-5]\d$`；`timeEnd >= timeStart`。
- `defaultTravelMode` / `legMode`：`transit | walking | driving`。
- `RouteBookPlace.kind`：`lodging | station | restaurant | other`；`lat` ∈ [-90, 90]，`lng` ∈ [-180, 180]。
- `note` ≤ 2000 字；`title` ≤ 120 字。
- 错误响应沿用项目习惯：显式 status + 中文 `error` 文案，可附机器可读 `reason`。

## 第 3 节：桌面端 UI（`/me/routebooks/[id]`，≥ 768px）

三栏布局不变（`ui.tsx` 现有 `lg:grid-cols-[420px_minmax(0,1fr)_420px]`），改各栏内容。`useRouteBookDetail.tsx`（587 行）拆为：

- `hooks/useTripData.ts`：装载、乐观更新、回滚、撤销环（最近 10 步的反向操作，刷新清空）。
- `hooks/useTripDnd.ts`：dnd-kit 传感器、拖拽 id 编解码（沿用 `types.ts` 的前缀约定并新增 `day:`、`item:`、`marker:` 前缀）、drop 解析成 `reorder` 请求。
- `hooks/useDayLegs.ts`：选中天的 `legs` 拉取与缓存；路线开关关闭时不拉。

任何单文件不超过 750 行（`line-budget.allowlist.json` 不新增条目）。

### 左栏：日程侧栏（`components/DayPlanSidebar.tsx` 取代 `PlannerRoutePanel.tsx`）

- 工具栏：导出（下拉：GPX 整程 / GPX 当天 / ICS）、全部展开/折叠、撤销（无可撤销时禁用，hover 显示上一步名称）、调整天顺序。
- 天区块：可折叠；折叠状态存 `localStorage` 键 `routebook-day-expanded-{routeBookId}`。标题行：`Day N` + 日期（有则显示「9/12 周六」）+ 天气（有日期时）+ 住宿徽标（绿=入住 / 红=退房 / 灰=续住，点击定位到该自定义点）+ 「N 站 · 约 X 小时」摘要。点标题 = 选中该天（高亮、地图只画该天路线、右栏「+」目标）。
- 时间线：按 `sortOrder`；四种卡片：点位（缩略图 + 名 + 作品名）、自定义点（kind 图标 + 名 + 地址）、备注（自选图标/颜色）、交通（线路名/时长，无拖动手柄，随前一站）。有 `timeStart` 显示时间徽章；`locked` 显示锁形。
- 连接行：两条有坐标条目之间；路线开关打开时显示「方式图标 · 时长 · 距离」，`source:'heuristic'` 灰色虚线 + 「估算」；点击弹菜单：步行 / 公共交通 / 驾车 / 用当天默认（写 `legMode`）。
- 条目悬停/右键操作：设时间、锁定/解锁、编辑备注、移到…（列出各天与未安排）、从当天移除、删除条目。
- 拖拽：天内排序、跨天移动、从右栏拖入（可精确到两条之间）、从地图标记拖入。使用 `@dnd-kit/sortable`，每个天区块与「未安排」区各是一个 droppable 容器。
- 底部工具条（仅选中天，且有 ≥ 2 个有坐标条目，或 1 个 + 当天住宿）：路线开关（状态存 `localStorage`）、优化、打开导航（下拉三家）、当天默认方式（公共交通 / 步行 / 驾车）。优化完成后 toast「已重排 N 站，缩短 X km · 撤销」。
- 「未安排」区：始终在最后，可折叠，条目可拖进任意天。
- 调整天顺序：弹窗内可拖动交换天、在任意位置插入新的一天、删除空天（非空天禁用删除并提示先清空）。
- 住宿：天标题 🏨 或「添加住宿」→ 弹窗：选已有 lodging 自定义点 / 新建（地址输入 → 现有 `lib/share/geocode.ts` MapTiler 地理编码 → 可在小地图上微调）、入住日..退房日、可选入住/退房时间。

### 中栏：地图（`PlannerMapStage.tsx` 改造）

- 顺序徽标：标记右下角显示当天序号；一个点位在多天出现显示「1·3」。选中天的标记放大，其它天的标记降低不透明度；「未安排」条目用空心标记。
- 当天路线：亮芯 + 暗壳双线；`legs` 返回前先画直线，返回后替换为 polyline；heuristic 段虚线。
- 标记可拖：dnd-kit `useDraggable` 挂在标记 DOM 上，拖到左栏某天或两条之间。
- 右键 / 长按空白处 → 「在这里添加自定义点」（MapTiler 反向地理编码填地址）。
- 日程详情卡：选中天时地图右上浮一张可折叠卡片：天气（Open-Meteo；无日期不显示）、当天住宿（名/地址/入住退房）。

### 右栏：点位池（`PlannerPointPoolPanel.tsx` 改造）

- 顶部「+ 添加自定义点」（弹窗同住宿的地址输入，多一个 kind 选择）。
- 三个 chip：全部 / 未安排 / 已安排；作品筛选下拉（按池内点位的 bangumi 聚合）；搜索框只搜池内，无结果时给「去巡礼地图找点位」链接（现有加入池流程不变）。
- 条目：缩略图、名、作品；已安排的显示「Day N ·序号」，点击地图飞过去；「+」加进选中天（未选中则加到「未安排」）；可拖。
- 自定义点也在此列出（kind 图标），可编辑/删除。

### /plan 侧

「存到我的地图」按钮位置与状态机不变；成功后跳转 `/me/routebooks/[id]` 并 toast「已按 N 天导入：M 个点位、K 条交通、J 个住宿」（有降级时追加「，X 条作为备注导入」）。

### 沉浸模式（`RouteBookImmersiveMode.tsx`）

- 入口按钮改为「开始 Day N」：有日期时按今天匹配 `RouteBookDay.date`（无匹配取第一天），无日期时弹选择器。
- 序列 = 当天 `point` 与 `place` 条目按 `sortOrder`（备注与交通条目不进序列）。
- 最后一站完成时提示「Day N 完成 → 明天从 X 开始」（有下一天时）。
- 打卡、导航、撤销打卡逻辑不动。

## 第 4 节：移动端（< 768px）与错误处理

### 布局

- 顶栏下一条**日期胶囊轨道**（横向滚动）：`Day 1 9/12`、`Day 2`…、`未安排`；选中即当前天，语义与桌面「选中天」相同。取代现有「路线 / 点位池」两 tab。
- 轨道下「计划 / 地图」切换：计划 = 当前天的时间线（全宽，同桌面卡片）；地图 = 全屏地图只画当前天。
- 底部 dock：点位池（打开现有 `MobilePointPoolSheet`，条目「+」加到当前天）、优化、打开导航（底部 action sheet 三家）、「开始 Day N」。
- 计划视图内：条目左滑出「移到… / 移除」；长按 200ms 后拖动排序（dnd-kit `TouchSensor` 带 `delay`）；跨天移动走「移到…」菜单，不支持拖到胶囊上。
- 天标题下一行摘要：天气 + 住宿 + 「N 站 · 约 X 小时」；点开 = 日程详情卡（底部抽屉）。
- 连接行始终显示（不需要路线开关）。
- 移动端不提供锁定；只有 `timeStart` 能固定一站。

### 备注图标与颜色枚举

图标 10 个：`info | clock | train | utensils | ticket | camera | shopping-bag | alert | star | bookmark`（lucide 名）。颜色 6 个：`gray | pink | amber | green | sky | violet`。

### 乐观更新与冲突

- 拖拽 / 排序 / 移动 / 删除先本地生效再调 API；失败回滚并 toast。
- `PATCH /` 与 `POST /items/reorder` 带 `updatedAt` 乐观锁；409 `stale` → toast「行程已在别处修改」+ 刷新按钮。
- 25 条/天上限：拖入前前端校验（目标天灰掉并提示），服务端二次校验。

### 降级表

| 场景 | 行为 |
|---|---|
| Directions 失败 / 超限 / 点在日本外 | 段回退 heuristic，虚线 + 「估算」，不阻塞操作 |
| Open-Meteo 失败 | 天气留空，不提示 |
| 可移动点 < 2 | 优化按钮禁用 + tooltip |
| reorder 破坏时间锚顺序 | 409 → 回滚 + toast「12:00 的〈餐厅〉必须排在 10:30 的〈神社〉之后」 |
| agent 条目无坐标且非 note | 降级为 note，导入 toast 计数 |
| 高德 app 未安装 | 1.6 秒后回退网页版 |
| 迁移期旧表 | 迁移一次性搬完；`repoPrisma` 只读新表；旧表下个周期删 |

## 第 5 节：测试

- `tests/routeBook/optimize.test.ts`：固定项不动、成环时起点为离住宿最近的自由点、2-opt 总距离 ≤ 最近邻、< 2 点原样、全部固定原样。
- `tests/geo/gcj02.test.ts`：往返误差 < 1 m（东京、上海、拉萨三点）、中国外不转、`isOutsideChina` 边界。
- `tests/routeBook/legs.test.ts`：transit 条目接管相邻段、`legMode` 覆盖当天默认、住宿首尾、heuristic 回退、缓存命中不打 Directions。
- `tests/routeBook/handlers.test.ts`（`repoMemory`）：items 增删改、reorder 天内 / 跨天 / 时间锚校验 / 25 上限、days 插入 / 删除 / 重排后住宿区间不变、places 删除级联、lodgings 重叠拒绝、乐观锁 409。
- `tests/tripPlan/exportRouteBook.test.ts` 重写：六种 type 各一例、连续 lodging 合并、无坐标降级、`timeHint` 解析、重复导入幂等、计数正确。
- `tests/routeBook/export.test.ts`：GPX / ICS 快照（固定输入）。
- `tests/routeBook/navigationTargets.test.ts`：三平台 URL 生成与排序、Apple 仅起终点、高德坐标已转。
- jsdom：`DayPlanSidebar` 的 drop 解析（天内 / 跨天 / 从池 / 从标记）与撤销环；移动端胶囊选中与计划/地图切换。
- 迁移：对开发库跑 `npm run db:migrate:dev` 验证 sorted → Day 1、unsorted → 未安排；生产迁移按 `seichigo-db-env-split` 记忆注入两条连接串。

## 第 6 节：交付批次

| 批次 | 内容 | 出口标准 |
|---|---|---|
| **B1 骨架** | 模型 + 迁移 + repo/handlers（items / days / optimize）+ agent 导入映射 + 左栏按天时间线 + 拖拽 / 排序 / 跨天 + 优化 + 地图按天路线与徽标 + 右栏三 chip + 沉浸模式按天 | agent 计划导入后按天可见可拖；优化可用；旧路线本数据完整迁入；`npm test`、`typecheck:app`、`typecheck:tests` 通过 |
| **B2 完整规划** | 自定义点 + 住宿区间 + 备注 + 连接行与段方式覆盖 + `RouteLegCache` + 撤销环 + 天顺序调整 + 日程详情卡 | 与 TREK 日程侧栏功能对齐 |
| **B3 移动端** | 日期胶囊 + 计划/地图切换 + 底部 dock + 左滑/长按 | 手机上能完整规划并按天走 |
| **B4 锦上添花** | 天气 + GPX/ICS + Apple/高德深链 + GCJ-02 | v1 范围全部交付 |

每批合并 main 前先部署预览版由负责人冒烟。B1 上线时旧路线本用户无感。

## 参考

- TREK 交互参考（只看不抄）：`wiki/Trip-Planner-Overview.md`、`Day-Plans-and-Notes.md`、`Route-Optimization.md`、`Places-and-Search.md`、`Map-Features.md`、`Accommodations.md`（T-T 仓库 `wiki/zh/` 有中文版）。
- 现有代码入口：`lib/routeBook/`、`lib/tripPlan/handlers/exportRouteBook.ts`、`app/(authed)/me/routebooks/[id]/`、`lib/directions/googleClient.ts`、`lib/planAgent/enrich/heuristicTransit.ts`、`app/(authed)/plan/[id]/lib/navigationLinks.ts`、`lib/share/geocode.ts`。
