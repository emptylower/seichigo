# 按天行程本 B3 派发单：移动端与执行（2026-09-23）

> 执行者须知：主计划 `docs/superpowers/plans/2026-09-23-routebook-day-planner.md`（先读顶部硬约束与「评审修订记录」，再读 **任务 18、19** 与设计稿 §4「移动端布局」）。B1/B2 已完成并提交在本分支。本批只有前端，一个会话执行。**只改** `app/(authed)/me/routebooks/**`、`components/route/**`、`lib/i18n/locales/*.json`、`tests/routebooks/**`；不碰 `lib/**`（i18n 字典除外）、`app/api/**`、`features/map/**`、`components/map/**`。每组完成 `git commit`（不 push）。
>
> 完成标准：`npm run typecheck:app`、`npm run typecheck:tests` 0 错；`npx vitest run --project jsdom tests/routebooks tests/route` 与 `npx vitest run tests/i18n` 全绿；`npm test`（含 750 行预算）全绿；简短中文汇报。

## 代码现状（B2 之后）

- 详情页编排：`app/(authed)/me/routebooks/[id]/ui.tsx`（桌面三栏 + 现有移动端最小版：顶部天胶囊按钮组 + 「路线 / 点位池」两 tab + 底部「开始 Day N」按钮）、`components/DetailChrome.tsx`（页头面包屑等）。
- hooks：`useTripData`、`useItemMutations`、`useDayMutations`、`usePlaceLodgingMutations`、`useTripDnd`、`useDayLegs`（带 `?sig=`，stale/failed 状态）、`useRouteGeometry`、`useUndoRing`、`usePointPreviews`。
- 组件：`DayPlanSidebar`（工具栏：撤销/展开折叠/显示全部/调整天顺序）、`DayBlock`（标题行含日期/住宿徽标/摘要，底部工具条：路线开关/优化/打开导航/默认方式）、`TimelineItem`（四种卡 + 序号徽章 + 悬停操作）、`LegConnector`（时长/距离/方式，点击菜单改 legMode）、`UnassignedBlock`、`PlannerMapStage`、`PlannerPointPoolPanel`、`PointDetailCard`（桌面浮卡 / 移动端底部抽屉已有）、`PlaceEditorDialog`、`LodgingDialog`、`NoteEditorDialog`、`DayOrderDialog`、`DayDetailCard`、`StartDayPickerSheet`、`MobilePointPoolSheet`、`RouteBookImmersiveMode`。
- 地图显示模式：`selectedDayId=null` 全览（不画线）；选中某天只显示该天点位 + 路线，徽标 = 游览顺序。
- 文案全部走 `t('routebook.*', locale)`，三语同步。
- 行数：`ui.tsx`、`RoutePreviewMap.tsx` 都接近 750，往里加东西先抽文件。

## 任务 18：移动端布局（`< 768px`，用现有 `useIsMobile`）

新建 `components/mobile/`：
- `DayPillTrack.tsx`：横向滚动胶囊：「全部」+ `Day 1 9/12`…+「未安排」；选中即 `selectedDayId`（「全部」= null，语义与桌面一致：全览不画线，选中天只显示该天）；当前项自动滚入视野。
- `MobilePlanView.tsx`：当前天时间线（复用 `TimelineItem`/`LegConnector`，全宽）；连接行**始终显示**（不需要路线开关）；条目**左滑**露出「移到… / 移除」（自实现 pointer 事件，阈值 80px，不用 dnd-kit）；**长按 200ms** 后拖动排序（dnd-kit `TouchSensor` `delay: 200, tolerance: 8`）；跨天移动只走「移到…」菜单。「全部」模式下显示各天折叠列表（只读摘要 + 点击进入该天）。
- `DaySummaryBar.tsx`：天标题下一行：日期 · 住宿 · 「N 站 · 约 X 小时」；点开 = `DayDetailCard` 内容以底部抽屉呈现。
- `MobileDock.tsx`：固定底部 dock 四个按钮：点位池（打开 `MobilePointPoolSheet`，其中「+」加到当前天；「全部」模式下加到未安排）、优化（当前天，<2 可移动点禁用）、打开导航（底部 action sheet，B4 前先只有 Google）、开始 Day N（无日期弹 `StartDayPickerSheet`）。dock 高度用 `env(safe-area-inset-bottom)`。
- `ui.tsx` 的 `isMobile` 分支换成：`DetailChrome`（精简）→ `DayPillTrack` → 「计划 / 地图」切换 → 内容区（计划 = `MobilePlanView`；地图 = 全屏 `PlannerMapStage`，只画当前天，点标记打开 `PointDetailCard` 抽屉）→ `MobileDock`。桌面分支不动。
- 移动端不提供锁定；只有 `timeStart` 能固定一站（保持现状）。
- 三语文案进 `routebook.mobile.*`。

## 任务 19：沉浸模式收尾

`RouteBookImmersiveMode.tsx`：
- 无日期行程：入口先弹 `StartDayPickerSheet`（已有），选定后进入。
- 序列 = 当天 `point` 与 `place` 条目按 `sortOrder`；`place` 条目导航用 place 坐标与名称，不能打卡（隐藏打卡按钮，显示「到达 · 下一站」）。
- 最后一站完成时：有下一天 → 「Day N 完成 → 明天从 X 开始」（X = 下一天第一个有坐标条目名）；没有 → 「全部完成」。
- 打卡、撤销打卡、导航嵌入逻辑不动。

## 测试（jsdom，`tests/routebooks/mobile/`）

- `DayPillTrack.test.tsx`：点击切换 `selectedDayId`，「全部」→ null。
- `MobilePlanView.test.tsx`：「移到…」菜单调 `reorder`；左滑露出操作（用 pointer 事件模拟位移）。
- `MobileDock.test.tsx`：优化按钮在 <2 可移动点时禁用；「开始」在无日期时打开选天 sheet。
- `RouteBookImmersiveMode.test.tsx`：place 条目不显示打卡；最后一站完成文案含下一天首站名。
