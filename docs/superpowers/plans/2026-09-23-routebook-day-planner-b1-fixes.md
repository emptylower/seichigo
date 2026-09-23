# 按天行程本 B1 审查修复（2026-09-23）

> 执行者须知：本文件是 `docs/superpowers/plans/2026-09-23-routebook-day-planner.md` B1 实现的审查修复清单。先读那份计划顶部的硬约束（不 push、不 migrate dev、≤750 行、不 `as any`、`$transaction` 只用 `tx`、路由 `runtime='nodejs'`），再执行本文件指定的部分。**A 部分（后端）与 B 部分（前端）由两个 opencode 会话并行执行，文件互不重叠**：A 只改 `lib/**`、`prisma/**`、`tests/routeBook/**`、`tests/tripPlan/**`；B 只改 `app/(authed)/me/routebooks/**`、`app/(authed)/plan/**`、`components/route/**`、`tests/**/*.test.tsx`（jsdom）。每修完一组就 `git commit`（不 push）；两边都会 commit，遇到 `index.lock` 就等几秒重试。
>
> 完成标准：本部分改动 + 对应测试全部通过；`npm run typecheck:app`、`npm run typecheck:tests` 0 错；`npx vitest run tests/routeBook tests/tripPlan tests/userPointState`（A）或 `npx vitest run --project jsdom tests/routebooks`（B，目录自建）全绿。汇报改动文件与测试结果（中文，简短）。

## 前后端接口契约（两边都按这个改，这是并行的前提）

1. **所有写接口的响应都带 `bookUpdatedAt: string`（ISO）**：`POST/PATCH/DELETE /items*`、`POST /items/reorder`、`POST /days`、`PATCH /days/[dayId]`、`DELETE /days/[dayId]`、`POST /days/reorder`、`POST /days/[dayId]/optimize`、`POST/PATCH/DELETE /places*`、`POST/PATCH/DELETE /lodgings*`、`PATCH /`（这个本来就返回 `routeBook.updatedAt`，再额外带 `bookUpdatedAt` 同值）。
2. **`POST /items` 响应**：`{ ok: true, item, items, bookUpdatedAt }`，其中 `items` 是目标天（或未安排区）写入后的完整条目列表（已重编 sortOrder）。
3. **`POST /items/reorder` 响应**：`{ ok: true, items, bookUpdatedAt }`，`items` 是整本全部条目（现状不变）。
4. **`GET /days/[dayId]/legs`**：服务端只取该天的条目算坐标；响应形状不变（`legs`、`staleTransitItemIds`）。
5. **`updatedAt` 乐观锁只由用户主动的 `PATCH /`（改标题/状态/日期）携带**；其它写接口不传 `updatedAt`，服务端不做 stale 判断，改为先锁行（见 A2）。

---

## A. 后端（zhipuai glm-5.3）

### A1 [blocker] optimize 必须固定时间锚
`lib/routeBook/handlers/optimize.ts:42` 附近：`fixed = isAnchor(item) || kind==='note' || kind==='transit' || !coords`，其中 `isAnchor = item.locked && item.timeStart != null`（`rules.ts` 里若已有同名判断就复用）。
测试 `tests/routeBook/handlers.test.ts` 现有 "locked" 用例改法：先 `POST /items` 创建，再 `PATCH /items/[id]` `{ timeStart: '12:00', locked: true }`（`createItemSchema` 没有 locked 字段，之前的用例是被 Zod 剥掉了才"通过"的），把锚放在下标 2 而不是 0，断言优化后它仍在下标 2。

### A2 [blocker] reorder 校验目标 dayId 归属；写入先锁行
- `lib/routeBook/repoPrismaItems.ts`（reorderItems，约 133–181 行）与 `repoMemory.ts`（约 435 行）：`dayId !== null` 时必须存在 `RouteBookDay { id: dayId, routeBookId }`，否则抛 `RouteBookRuleError('invalid', '目标天不存在')`。`createItem` 同样校验。
- `lib/routeBook/repoPrismaShared.ts:94` 附近的 `touchTx`：调用方没传 `expectedUpdatedAt` 时，**不要**用事务内先读的 `updatedAt` 当期望值；改为事务开头 `tx.routeBook.update({ where: { id, userId }, data: { updatedAt: now } })`（既做行锁串行化，又推进时间戳；`userId` 不匹配 → P2025 → 映射成 `not_found`）。只有传了 `expectedUpdatedAt` 才走 `updateMany` + `count===0 → stale`。
- 所有写方法返回值带最新 `bookUpdatedAt`（契约 1）；handlers 把它放进响应。`POST /items` 额外返回目标天完整条目（契约 2）。
- 测试：`tests/routeBook/repoMemory.test.ts` 加"外本 dayId / 不存在 dayId → invalid"；`handlers.test.ts` 加"DELETE item 后 PATCH title 不带 updatedAt 不 409""两次连续 POST /items 不 409"。

### A3 [should-fix] 迁移 startDate 回填
`prisma/migrations/20260923100000_routebook_days/migration.sql:122-123` 改为：
```sql
UPDATE "RouteBook" SET "startDate" = left(("metadata"->>'startDate'), 10)::date
WHERE "metadata" ? 'startDate'
  AND jsonb_typeof("metadata"->'startDate') = 'string'
  AND ("metadata"->>'startDate') ~ '^\d{4}-\d{2}-\d{2}';
```
（去掉 `$`；老导出写的是 `toISOString()`。）开发库已经 `migrate resolve --applied` 过这条迁移且表为空，**不要**重新应用，也不要建第二条迁移——生产尚未应用，改文件即可。在汇报里明确写"迁移文件已改、未重跑"。

### A4 [should-fix] legs 只算选中天
`lib/routeBook/handlers/legs.ts:23` 附近：`pointCoords` 只传该天条目的 `pointId`；不要对整本做 `getById` 之外的额外遍历（`getById` 一次即可）。

### A5 [should-fix] 无 `payload.transport` 的 transit 不算失效
`lib/routeBook/legs.ts:87`：没有 `payload.transport` 的 transit 条目静默跳过（按普通段算），不进 `staleTransitItemIds`。`tests/routeBook/legs.test.ts` 加用例。

### A6 [should-fix] 导入映射：换酒店日重叠、dayIndex 断档
`lib/tripPlan/exportMapping.ts:164-255`、`lib/routeBook/exportStorePrisma.ts:31`：
- 同一天出现两家酒店（换酒店日）：前一区间 `to` 截到换酒店日，即 A[1,3]、B[3,4]，并对全部区间跑 `assertLodgingNoOverlap`（夜晚集合）；仍冲突的后者降级为 note 并计入 `degradedToNote`。
- `days` 必须覆盖 1..dayCount（计划 dayIndex 有断档时补空天），保证 `RouteBookDay` 连续。
- `tests/tripPlan/exportRouteBook.test.ts` 加两例。

### A7 [should-fix] 去掉 items 的任意 payload 写入
`lib/routeBook/handlers/schemas.ts:21`：`createItemSchema` 删除 `payload` 字段（客户端不用；transitBetween 由导入和服务端写）。若 `ItemCreateInput.payload` 只在导入路径用，保留仓储层字段但 handler 不接收。

### A8 [nit] 内存仓储先校验再改状态
`repoMemory.ts:407-417`、`474-483`：在副本上跑 `assertAnchorOrder`，通过后再写回，行为与 Prisma 回滚一致。

### A9 [nit] 列表封面与 reorder 写放大
- `repoPrisma.ts:182-192` `firstPointImage`：按 `dayIndex, sortOrder` 取全本第一个 `point` 条目，不限 Day 1。
- `repoPrismaItems.ts:174` `reorderItemsTx`：只 UPDATE `dayId` 或 `sortOrder` 变化的行。

---

## B. 前端（kimi k3）

### B1 [blocker] 详情页无限重载
`app/(authed)/me/routebooks/[id]/hooks/useTripData.ts:132`：`load` 的依赖里不要放 `undoRing`（`useUndoRing` 每次渲染返回新对象），改依赖 `undoRing.clear`（已是稳定 `useCallback`），或把 `useUndoRing` 的返回值 `useMemo`。加 jsdom 测试 `tests/routebooks/useTripData.test.tsx`：mock `fetch`，mount 后等待 2 个 tick，断言 `/api/me/routebooks/<id>` 只被请求 1 次。

### B2 [should-fix] updatedAt 与写响应
`hooks/useTripMutations.ts`：按契约，每个写请求成功后用响应里的 `bookUpdatedAt` 更新本地 `detail.updatedAt`；只有 `patchBook`（改标题/状态/日期）才发送 `updatedAt`，其它请求不带。`POST /items` 成功后用响应的 `items` 替换目标天的条目（修复 B4）。

### B3 [should-fix] 标记拖拽代理定位
`components/PlannerMapStage.tsx:42`：`display:none` 的 `useDraggable` 代理会让 dnd-kit 量到 0×0，overlay 与碰撞检测偏移。改为 pointerdown 时把代理元素绝对定位到标记的 `getBoundingClientRect()`（尺寸相同、`opacity:0`、`pointer-events:none`），或对 `marker:` 前缀的拖拽改用 `pointerWithin` 碰撞检测。

### B4 [should-fix] 插入后本地顺序
`useTripMutations.ts:113-157`：临时条目插入后同天兄弟条目要重编 `sortOrder`；成功后用契约 2 的 `items` 整体替换该天。

### B5 [should-fix] 路线显示
- `hooks/useRouteGeometry.ts:17`：路线开关关闭或 legs 未到时返回 `[]` 而不是 `undefined`（否则地图回退到旧的全点虚线链）。
- `components/route/RoutePreviewMap.tsx:434`：`applyMarkerActive` 之后要再 `applyMarkerVariant`，否则未安排的空心样式被覆盖。/plan 的用法仍不能变。

### B6 [should-fix] legs 只拉选中天
`hooks/useDayLegs.ts:39`：只请求 `selectedDayId`（切天再拉，按 `dayId + 顺序签名` 缓存），不要一次请求所有天。

### B7 [should-fix] 撤销不丢字段
`useTripMutations.ts:217` `recreateItem`：带上 `locked/timeStart/timeEnd/icon/color/legMode/note/title`（payload 由服务端管，不传）；跨天移动的撤销用服务端返回的 `items` 重建 id 列表，而不是拖拽前的旧列表（旧列表可能含已被服务端删掉的 transit）。

### B8 [nit] 交互细节
- `hooks/useTripDnd.ts:42`：`PointerSensor` 用 `{ activationConstraint: { distance: 6 } }`，`TouchSensor` 才用 200ms delay。
- 拖入某天前做客户端 25 条（只数 point/place）预检，超限则目标天置灰并提示「这一天最多 25 个点」。
- `ui.tsx:138`：不要用行程数据的变量名 `t` 遮蔽 i18n 的 `t`；导入提示条的 locale 用页面已有的 locale 解析（路径前缀优先，再 cookie），不要只读 cookie。
- `ui.tsx:206`：无日期行程点「开始」时弹一个选天的底部 sheet（简单列表即可）；最后一站是自定义点时也要能正常走到"今天完成"。

### B9 测试补齐（jsdom，放 `tests/routebooks/`）
- `useTripDnd`：同天排序、跨天移动、从池拖入、从标记拖入 四种 `onDragEnd` 解析出的 `reorder/addItem` 参数。
- `useUndoRing`：push/pop 顺序与上限 10。
- B1 的 fetch 次数用例。
