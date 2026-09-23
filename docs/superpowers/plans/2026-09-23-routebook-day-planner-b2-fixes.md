# 按天行程本 B2 审查修复（2026-09-23）

> 执行者须知：先读 `docs/superpowers/plans/2026-09-23-routebook-day-planner.md` 顶部硬约束。**A（后端）与 B（前端）并行**：A 只改 `lib/routeBook/**`、`lib/share/**`、`tests/routeBook/**`、`tests/share/**`；B 只改 `app/(authed)/me/**`、`lib/i18n/locales/*.json`、`tests/routebooks/**`。各自 commit（不 push）。完成标准：typecheck 0 错、各自测试全绿、`npm test` 全绿、简短中文汇报。

## 契约变更（两边同时改）

- `legs[].source` 语义不变；新增：当条目 `legMode` 显式设置时，该段**永远**按 `legMode` 的方式计算（覆盖 agent 数据、覆盖启发式的按距离选方式），且若该段原本由 agent transit 条目提供，则该 transit 条目进入 `staleTransitItemIds`。
- legs 接口超过每用户 10 次/分钟时**不再 429**：返回 200，但该次请求不调 Google（全部 heuristic/缓存），响应加 `degraded: 'rate_limited'`。

## A. 后端（zhipuai glm-5.3）

- **A1 [blocker] 限流降级**：`lib/routeBook/handlers/legs.ts:44-46` 超限改为用 `nullResolver`（只读缓存 + heuristic）并返回 200 + `degraded:'rate_limited'`；只有真正会触发 Google 调用的请求（有 walking/driving 段且缓存未全中）才计数。测试：超限返回 200 且 `source` 无 `google`；纯缓存命中不计数。`tests/routeBook/legs.test.ts` 里为绕限流加的 `rateLimitMax: 1000` 改回默认。
- **A2 [should-fix] 显式 legMode 不被启发式改写**：`lib/routeBook/legs.ts:184-195`——`to.legMode` 有值时保持该 mode，只估算时长（walking 4.5km/h、transit 25km/h+12min、driving 30km/h 最少 5 分钟）。测试加用例。
- **A3 [should-fix] 显式 legMode 覆盖 agent 段**：`lib/routeBook/legs.ts:175` 附近，`to.legMode` 有值时不用 `agentLegs`，并把对应 transit 条目 id 放进 `staleTransitItemIds`。测试加用例。
- **A4 [nit] 缓存重复读**：`lib/routeBook/legResolverGoogle.ts:67-70` 加选项跳过逐段缓存读（池已批量读过）。
- **A5 [nit] 截止时间**：`lib/routeBook/legPool.ts:51` 的 8 秒计时从 handler 入口开始。
- **A6 [nit] 限流表清理**：`handlers/legs.ts:15`、`lib/share/handlers/geocodeSearch.ts:20` 的内存 Map 每次访问顺带清理过期项。

## B. 前端（kimi k3）

- **B1 [should-fix] 天顺序弹窗不整页重载**：`hooks/useDayMutations.ts:81,120` 的 `insertDay`/`deleteDay` 用响应更新 `days`（和 items 的 dayId 映射），不调 `load()`；`DayOrderDialog.tsx`「在下方插入」用**可视位置**而不是服务端 `dayIndex`，且插入/删除后保留弹窗内已拖出的顺序（新天插在可视位置）。测试：先本地重排再插入，断言位置正确、弹窗仍在。
- **B2 [should-fix] 删自定义点要确认**：`ui.tsx:387` / `PlannerPointPoolPanel.tsx` 的删除按钮先弹确认（文案列出将一并删除的 N 条条目与 M 段住宿；数字从 `detail` 本地算），确认后再删；删除后清掉撤销环里指向这些条目的记录（或整个清空撤销环并 toast 说明）。
- **B3 [should-fix] AI 段改方式提示**：`LegConnector.tsx`——`source==='agent'` 时菜单可用（服务端契约已允许覆盖），但菜单顶部加一行提示「将覆盖 AI 查询结果」。
- **B4 [should-fix] 地址搜索不自触发**：`PlaceEditorDialog.tsx:77-105,113-118`——搜索只在用户输入时触发（单独的 `query` 状态或 `suppressNextSearch` ref），`pickResult` 与编辑模式初始化不触发；请求带 `near=<地图中心或当前坐标>`。
- **B5 [should-fix] 住宿流程补全**：`DialogsHost.tsx:103` 新建住宿点后返回住宿弹窗时保留 `presetDayIndex`；`LodgingDialog.tsx` 编辑模式加「删除住宿」按钮调 `deleteLodging`（带确认）。
- **B6 [nit] 侧栏同时保留「添加一天」与「调整天顺序」**（`DayPlanSidebar.tsx:196-215`）。
- **B7 [nit] 备注可编辑**：`NoteEditorDialog` 加 `item` prop 进入编辑模式（改标题/详情/图标/颜色/时间 → `updateItem`）；`TimelineItem` note 卡的「编辑」入口。
- **B8 [nit] 细节**：`PlaceEditorDialog.tsx:18` `GeocodeResult.address: string | null`；对话框输入加 `maxLength`（标题 120、地址 300、备注 2000）；`PlannerPointPoolPanel.tsx:293` 格式；`PlaceRow` 没选天时也传 `onAddToDay`（点击时 toast「先选一天」）。
- **B9 [nit] 语言文件只保留必要 diff**：`git diff 704b396d -- lib/i18n/locales/*.json` 目前把 `planStart.suggestions`、`me.*` 等无关块重排了。要求：对三个文件，以 `git show 704b396d:<path>` 的内容为基底，只把本分支新增/修改的 `routebook.*` 键合进去，其余部分逐字保持基底格式（写个一次性脚本做，脚本用完删）。完成后 `git diff 704b396d --stat -- lib/i18n/locales` 的行数应明显下降，且 `tests/i18n` 仍全绿。
- **B10 [nit] `ui.tsx` 瘦身**：664 行，B3 还要往里加移动端；把桌面三栏编排抽到 `components/DesktopLayout.tsx`，`ui.tsx` 降到 ≤ 400 行。
- **B11 测试补齐**（`tests/routebooks/`）：`LodgingDialog.test.tsx`（payload 形状、预填天、新建住宿点往返）；`DialogsHost.note.test.tsx`（addItem → PATCH icon/color 两步，含 PATCH 失败回滚）；`DayOrderDialog` 重排后插入用例；`PlaceEditorDialog` 选中结果后不再触发搜索。
