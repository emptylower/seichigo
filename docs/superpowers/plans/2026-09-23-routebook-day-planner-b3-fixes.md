# 按天行程本 B3 审查修复（2026-09-23，纯前端）

> 执行者须知：先读主计划 `docs/superpowers/plans/2026-09-23-routebook-day-planner.md` 顶部硬约束。**只改** `app/(authed)/me/routebooks/**`、`lib/i18n/locales/*.json`、`tests/routebooks/**`；不碰 `lib/**`（字典除外）、`app/api/**`、`components/route/**`（另一会话在改 `lib/**`）。每组完成 `git commit`（不 push）。完成标准：typecheck 0 错；`npx vitest run --project jsdom tests/routebooks` 与 `npx vitest run tests/i18n` 全绿；`npm test` 全绿；简短中文汇报。所有路径相对 `app/(authed)/me/routebooks/[id]/`。

## Blocker

- **F1 触屏拖拽/左滑失效**：`hooks/useTripDnd.ts:70-73` 现在是 `PointerSensor{distance:6}` + `TouchSensor{delay:200,tolerance:8}`——触屏先来 `pointerdown`，PointerSensor 抢先激活，TouchSensor 永远不触发，长按无效且任何 6px 移动即拖动、与滚动打架。改法：自定义 `MousePointerSensor extends PointerSensor`，`activators` 里 `pointerType === 'touch'` 返回 false（或直接用 `MouseSensor`），配合 `TouchSensor{delay:200,tolerance:8}`。`components/mobile/MobilePlanView.tsx:218-225` 左滑内容层加 `style={{ touchAction: 'pan-y' }}`，否则浏览器接管横向手势发 `pointercancel`。`components/TimelineItem.tsx:205` 的 `mobileDrag` 同时展开 `attributes`（键盘/读屏语义）。测试：用 `pointerType:'touch'` 的 pointerdown 断言不激活鼠标传感器。
- **F2 「未安排」视图状态**：`components/MobileLayout.tsx:75,107-110,138`、`ui.tsx:256-258,394-399`——进入未安排视图时必须同时 `setSelectedDayId(null)`；胶囊点击改为**非切换**的 `setSelectedDayId(dayId)`（点已选中的天保持选中，不回全部；「全部」胶囊才清空）；点位池目标 = `unassignedView ? null : selectedDayId`，sheet 标题随之显示「未安排」。加 `MobileLayout` 级测试覆盖三种情况（未安排下加点进未安排、地图不显示旧天、从未安排点 Day 2 进 Day 2）。
- **F3 沉浸模式 place 站卡住**：`components/RouteBookImmersiveMode.tsx:111-117,147-149,166-172`——用一个 `passedIds: Set<string>`（打卡成功、「到达 · 下一站」、跳过都加入）从 `remainingStops` 里剔除；`currentIndex` 越过最后一个剩余站时直接进 `summary`。测试：序列 `[place, point]`，到达 place → 打卡 point → 应显示完成态而不是回到 place。

## Should-fix

- **F4 计划 tab 点条目要有反馈**：`components/plannerNodes.tsx` 的 `detailCard` 目前只在 `mapStage` 里渲染；改为在 `MobileLayout` 两个 tab 下都以固定底部抽屉渲染（`nodes.detailCard` 单独暴露）。
- **F5 地图 tab 全屏**：`components/PlannerMapStage.tsx:259,295-306` compact 模式高度改 `h-[calc(100dvh-<顶栏+胶囊+切换条+dock 高度>)]`（用 CSS 变量或固定值），隐藏 stage 自带的「开始」按钮与标题（dock 已有）。
- **F6 切换 tab 不卸载地图**：`components/MobileLayout.tsx:164-231` 两个视图都保持挂载，非活动的用 `hidden`；切回地图时调 `map.resize()`（`RoutePreviewMap` 若无暴露则通过 `ResizeObserver`/`window.dispatchEvent(new Event('resize'))`）。
- **F7 隐藏的悬停操作条**：`components/TimelineItem.tsx:248` 在 `mobileDrag` 时不渲染操作条（不是 `opacity-0`），避免误触与吞掉左滑起点。
- **F8 移动端补回丢失功能**：`DaySummaryBar` 的住宿抽屉加「添加住宿」（打开 `LodgingDialog`）；导航 action sheet 里加当天默认方式切换（公交/步行/驾车，调 `updateDay`）；点位池 sheet 加「自定义点」分区（列表 + 新建/编辑/删除，复用 `PlaceEditorDialog`）与「从池中移除」。
- **F9 安全区**：`components/MobileLayout.tsx:125` 内容底部 `pb-[calc(6rem+env(safe-area-inset-bottom))]`；`ui.tsx:415` toast 在移动端 `bottom-[calc(6.5rem+env(safe-area-inset-bottom))]`。
- **F10 去重**：把 `dayStats(day, items, legs)`（站数/预计小时）、`dayNavUrl(...)`、`movableCount(...)`、`dayDateLabel` 抽到 `utils.ts`，`DayBlock`、`MobileLayout`、`DaySummaryBar` 共用；`STOP_MINUTES_ESTIMATE` 只定义一次。
- **F11 测试**：长按激活与左滑不冲突（fake timers）；未安排视图的加点目标；`ui.tsx:101-104` 下一天首个有坐标条目的选取（用真实 `detail` 而不是直接传 `nextDayFirstTitle`）；F3 的 `[place, point]` 流程。

## Nit

- **F12** `MobileDock.tsx:54` `aria-label`、`:73` 全角括号、`DayPillTrack.tsx:56` tablist label → 走 `routebook.mobile.dockLabel` / `pillsLabel`，括号按 locale。
- **F13** `MobilePlanView.tsx:182-184,219,229-237`：拖动中关闭 `transition-transform`（`dragOffset !== null` 时）；同一时间只允许一行展开；关闭遮罩不要拦截反向滑回。
- **F14** 清理旧两 tab 残留：删除未使用的 `routebook.detail.tabRoute/tabRouteDay/tabPool` 键（三语）；`plannerNodes` 不再为移动端构建 `poolPanel`（`compact={isMobile}` 分支移除）。
- **F15**（与 F2 合并）胶囊为 tab 语义，不切换。
