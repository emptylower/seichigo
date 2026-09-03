# 回归第三轮：参考条目补图、餐厅补图、返程段卡片化、预算兜底、对话列宽（2026-09-02 晚）

工作方式同前：先通读现状；每条先补失败测试再实现；不要 git commit；不对任何数据库执行迁移；`node scripts/check-line-budget.mjs` 必须通过（新逻辑放新文件）。A 只碰 `lib/**`、`tests/planAgent/**`、`tests/googlePlaces/**`；B 只碰 `app/(authed)/plan/[id]/**`、`tests/plan/**`。两者并行。

## 用户反馈（2026-09-02 预览 5b3bcd5c）
1. 参考类条目缺图："泊宿参考""心斋桥一带""自由安排""参考建议"这类条目没有图片。用户要求这类条目也要有图（有地名的用该地名的图；没有地名的也不能是灰色占位）。
2. 餐厅缺图：找到的餐厅没有补图。
3. 返程日"京都站到关西机场"只有一行文字，没有像别处那样的卡片；要求格式统一，并把关西机场作为带图的点位卡片。
4. 采纳前一轮建议：预算用完后交通不留空（零外呼估算）、给补齐脚本预留预算、预算按时间窗滚动。
5. 前端：对话列宽度（另见 B2，待用户截图确认）。

---

## A. 后端（glm-5.3）

### A1 参考类条目也解析地点（`lib/planAgent/placeBackstop.ts`）
- 候选类型增加 `free`（连同 lodging/meal/attraction/无 pointId 的 point）。
- 新增 `extractPlaceQuery(title, placeQuery?)`（放新文件 `lib/planAgent/placeQuery.ts`）：优先 `payload.placeQuery`；否则从标题里剥掉修饰词后取地名：去掉前后缀「泊宿参考|住宿参考|参考|一带|周边|附近|方向|区域|入住|夜宿|自由安排|自由活动|自由时间|自由漫步|推荐|建议|机动|休息」及冒号/括号/箭头前的说明；若标题形如 `A到B` / `A→B` / `A-B` / `A至B`，取 **B**（目的地）作为查询词。剥完后长度 < 2 才跳过（原 VAGUE 直接跳过的规则改为"剥完为空才跳过"）。
- 例：「泊宿参考：难波」→ 难波；「心斋桥一带」→ 心斋桥；「京都站到关西机场」→ 关西机场；「自由安排」→ 空 → 跳过（交给 A3 的邻近图兜底）。
- 测试 `tests/planAgent/placeQuery.test.ts` 覆盖以上例子；`placeBackstop.test.ts` 补 free 条目被解析的用例。

### A2 餐厅与模型裁剪过的 place 补回 photo（`lib/planAgent/enrich/mediaEnricher.ts`）
- 对有 `payload.place.placeId` 但无 `place.photo` 的条目，先用 `store.findByPlaceId('google', placeId)`（通过 ctx 注入 `ExternalPlaceStore`）回填 `place.photo`（displayUrl 用 placeId 形式），再 `derivePlaceMedia`。库里也没有 photoReference 时跳过。
- `lib/googlePlaces/nearby.ts` 的结果在 `store.upsert` 成功后把 `photo.displayUrl` 改成 placeId 形式（与 `places.ts` 一致），失败保持 ref 形式。
- 测试：模型只复制了 placeId/name/lat/lng 的 meal 条目，保存后 `payload.media.displayUrl` 存在。

### A3 邻近图兜底（新文件 `lib/planAgent/enrich/neighborImageEnricher.ts`，接到 `enrich/index.ts` 末尾）
- 对任何非 transit 且仍无 `payload.media` 的条目：取同一天**前一个**有图条目（`payload.media.displayUrl` 或站内点位 `image`，站内 image 通过 ctx 的 `coordsByPointId` 携带的 `image`），没有就取后一个；都没有就取前一天最后一个有图条目；仍没有则跳过。写入 `payload.media = { source: 'neighbor', displayUrl, attribution?: 来源条目标题 }`。
- 幂等：已有 media 不动。测试：自由安排条目取到前一点位的图；整日无图则跳过。

### A4 已存在但无合格载荷的 transit 行就地补齐（`lib/planAgent/enrich/transportEnricher.ts`）
- 相邻两坐标条目之间若存在 `type==='transit'` 行但 `payload.transport.provider` 为空（且不是 legacy 扁平载荷），对它**就地**查询并写入 `payload.transport`（不新插行，不重复）。预算规则同插行路径。
- 测试：`[A, transit(无载荷), B]` 保存后该行有 transport 且行数不变。

### A5 预算兜底三件套
- 零外呼估算（`transportEnricher.ts` + `lib/planAgent/travelHelpers.ts` 现有 haversine 估算）：Directions 预算耗尽或查询失败时，不再留空，改为写入直线距离估算的 transport（`provider: 'estimate'`, `estimated: true`, `source: 'heuristic'`, mode 按 ≤1.5 km 步行否则乘车，附 Google 地图公交深链）；下一回合有预算时，`provider==='estimate' && source==='heuristic'` 的行会被真实查询替换（视为"待升级"，不算已合格）。
- 预留（`enrich/types.ts`、`tools.ts` 三个外部工具）：模型工具调用最多用到 `directions.max - 4`、`places.max - 2`，超过即返回 `budget_exhausted`；补齐脚本可用完整预算。
- 时间窗滚动（`enrich/types.ts`）：预算记录 `windowStartedAt`；检查时若距上次窗口开始 ≥ 60 秒则 `used` 归零并重置窗口。测试用可注入的 `now()`。
- 提示词：`budget_exhausted` 文案改为"本回合外部查询预算已用完，请立即保存；服务端会用参考估算补齐交通并在下一回合继续完善"。

完成标准：`npx vitest run tests/planAgent tests/googlePlaces tests/tripPlan` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报。

---

## B. 前端（kimi k3）

### B1 非计序条目也显示图片（`app/(authed)/plan/[id]/components/DayCards.tsx`）
- `TimelineCardRow`：只要 `getMedia(item)?.displayUrl` 或 `item.point?.image` 存在就渲染图片，不再要求 `isVisit`；序号规则不变（free/无 place 的 lodging、meal 仍是灰点）。`media.source === 'neighbor'` 时图片右下角加一枚极小的"参考"角标（`text-[10px]`），其他来源不加。
- 测试 `tests/plan/dayCards.test.tsx`：free 条目带 media 时渲染图片且无序号；neighbor 来源显示角标。

### B2 对话列宽度（待确认）
- 现状：`ui.tsx` 的消息流、顶栏、输入区都已是 `mx-auto w-full max-w-3xl`（768px）。用户反馈"对话卡片从左到右是完整网页宽度"，需要用户截图确认是哪一层撑满（可能是 daymap 卡片内的地图、AskCard 横向滚动区、或移动端）。**本轮不改宽度**，等截图后单独处理。

完成标准：`npx vitest run tests/plan` 全绿；`npx tsc --noEmit` 无错；简短中文汇报。
