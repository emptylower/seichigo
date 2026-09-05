# M4 第一期 · 评审修复清单（2026-09-02）

对应实现：`docs/superpowers/plans/2026-09-02-plan-agent-m4-phase1.md`；设计：`docs/superpowers/specs/2026-09-02-plan-agent-m4-orchestration-quality-gates-design.md`。
工作方式：先 `git status`/`git diff` 通读现状；每条先补失败测试再改实现；不要 git commit；不碰 `app/**`、`tests/plan/**`；不对任何数据库执行迁移；`node scripts/check-line-budget.mjs` 必须通过（新逻辑放新文件）。
完成标准：`npx vitest run tests/planAgent tests/tripPlan tests/googlePlaces` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 除 `tests/lib/prisma-client-lifecycle.test.ts` 的 3 条存量外无新增；简短中文汇报每条修了什么、加了哪些测试。

## 总原则（评审结论）
门控的目的是"让服务端把结果补齐"，不是"把用户卡在保存不了"。凡是**外部服务缺失/限流/预算耗尽**导致的缺口，都不能成为硬失败；硬失败只保留**模型自己能改的错误**（坐标缺失、显式时间冲突、出处伪造）。

## 必修（critical）

1. **交通门降级为可恢复** `lib/planAgent/gates.ts`、`lib/planAgent/tools.ts`：
   - `transport` 门改为 **soft**（记录缺失的 A→B 列表，不拒绝落库）。
   - `estimate_transit` 工具（`tools.ts` 约 370 行）返回值补 `provider: 'estimate'`、`estimated: true` 与完整 `transportPayload`（形状同 `queryTravelBetween` 的估算分支），让模型的兜底结果能过出处门并被前端标注"参考估算"。
   - 测试：`deps.travel` 缺省时保存**成功**且 `quality.soft` 含 transport 项（把 `tests/planAgent/tools.save-plan-days-gates.test.ts` 里把"无 travel 就拒绝"当作预期的那条改掉）。
2. **预算按真实外呼计数、按 provider 分开、不超过限速窗口** `lib/planAgent/enrich/types.ts`、`transportEnricher.ts`、`placeEnricher.ts`、`restaurantEnricher.ts`、`lib/planAgent/travelQuery.ts`：
   - `EnrichBudget` 改为 `{ directions: { used, max }, places: { used, max } }`，默认 `directions.max = 8`、`places.max = 6`（均低于 `googleClient` 15/分钟与 `places.ts` 8/分钟的窗口）。
   - `queryTravelBetween` 接收可选 `onGoogleCall()` 回调，日本兜底路径每次真实外呼（transit、driving、walking）各回调一次；enricher 用回调计数，而不是每次 `queryTravelBetween` 记 1。
   - 抛错路径同样计数（先计数再 await）。
   - 测试：日本兜底一次 `queryTravelBetween` 使 `directions.used` 增加 3；预算耗尽后剩余腿记 skipped `reason: 'budget'`。
3. **拒绝不再丢弃补齐成果 + 预算跨保存累计** `tools.ts`、`lib/planAgent/loop.ts`：
   - 只有 hard 失败才拒绝；由于第 1 条把 transport 降为 soft，绝大多数保存会落库，缺交通的腿留给下一回合的 enricher（阶段推断会再次进入 enrich）。
   - `EnrichBudget` 实例挂在 `PlanAgentToolDeps` 上由 loop 每个 run 创建一次（`deps.toolDeps.enrichBudget`），同一 run 内多次 save 共享，避免每次 save 重置预算重烧配额。
   - 测试：同一 run 内两次 save，第二次不再重复外呼已补齐的腿；hard 失败（坐标缺失）仍拒绝。

## 必修（major）

4. **enricher 在归一化排序之后运行** `lib/planAgent/enrich/index.ts`、`tools.ts`：流程改为 解析 → 归一化排序（用 `normalizeDaySchedule` 得到时间序，失败则保持原序）→ place/restaurant/transport/media enrichers（在有序列表上插交通行）→ 再归一化（最终 schedule）→ gates。测试：`[A@14:00, B@09:00]` 保存后交通行插在 B→A 之间，且再次保存不产生重复交通行。
5. **识别 M1 扁平 transit 载荷** `gates.ts`、`transportEnricher.ts`：`type==='transit'` 且 `payload.mode/durationMin` 在根上的行视为已有交通（provider 记 `'legacy'`），gate 计入 `transitLegs`，enricher 不再在旁边插第二行。测试覆盖。
6. **时长跨度门降级** `gates.ts`：13 小时跨度改为 soft，并且计算跨度时排除 `lodging` 条目。测试覆盖。
7. **阶段上下文不再改写 system prompt** `loop.ts`：`stageContext` 改为在本轮新的 user 消息**之前**插入一条 `{ role: 'user', content: '[系统状态]\n' + stageContext }`（保住前缀缓存）；`sanitizeChatHistory` 与落库逻辑不受影响（该消息只在内存，不落库）。测试：system 消息内容等于 `PLAN_AGENT_SYSTEM_PROMPT` 原文；倒数第二条 user 消息含"[系统状态]"。
8. **餐厅中心点兜底** `restaurantEnricher.ts`：无前置坐标时依次取同一天后续第一个有坐标条目、前一天最后一个有坐标条目；都没有才 skipped。测试覆盖早餐在当天首位的情形。

## 顺手修（minor）
9. `transportEnricher.ts`：`outcome.ok` 但缺 `transportPayload` 时记 skipped（reason `'no_payload'`）。
10. `restaurantEnricher.ts`：备选为空时不要留下尾部"；"。
11. `gates.ts`：出处门只检查 `payload.place` **存在**的条目，且跳过 `transit`；`point` 带 pointId 的条目不检查 place。
12. `loop.ts`：`RunFencedError` 后不写运行日志（被接管的 run 不留行）。
13. 设计文档 §7 的 `runId` 改为 `runToken`（文档小改，可直接改 `docs/superpowers/specs/2026-09-02-plan-agent-m4-orchestration-quality-gates-design.md`）。

---

# 第二轮复审修复（2026-09-02 晚）

同样的工作方式与完成标准。复审确认 1/3/5/6/7/8/9–13 已解决；以下为剩余与新增项。

## HIGH

N1. **预排序会导致交通行重复** `lib/planAgent/enrich/scheduleEnricher.ts`（`orderDaysBySchedule`）、`transportEnricher.ts`：`[A(无时间), transit A→B, B@09:00]` 经归一化后 B 与 transit 都被顺延并重排为 `[A, B, T]`，enricher 看到 A/B 相邻无交通又插一条。修法：预排序时把"条目 + 紧随其后的 transit 行"当作一个块整体移动（transit 行钉在其前置条目之后），只按非 transit 条目的解析开始时间排块；enricher 判断"相邻两坐标条目之间是否已有交通"时，凡两者之间存在任一 `type==='transit'` 行即视为已有。测试：上述输入保存一次只有一条 A→B 交通行；重存不增行。

N2. **坐标硬门在外部服务故障时把整份保存拒掉** `lib/planAgent/gates.ts`：`meal`/`lodging` 无坐标改为 **soft**（fix 文案："地点未能解析（外部服务不可用或限流），下一回合继续补齐"）；`point`（含 pointId 或 place）与 `attraction` 无坐标仍为 hard。前端 `isNumberedVisitItem` 对无 place 的 meal/lodging 本就不计序号，不需要改。测试：Places 限流场景下含未解析 meal 的保存成功且 soft 含 coords。

## MEDIUM

N3. **Places 预算漏计** `lib/googlePlaces/places.ts`、`lib/googlePlaces/nearby.ts`、`lib/planAgent/placeBackstop.ts`、`restaurantEnricher.ts`：`resolveByText(query, opts)` 与 nearby 搜索都增加可选 `onGoogleCall()`，在真实发起 Google 请求之前调用（缓存/库命中不调用；失败与抛错都已计数）；backstop 与 restaurantEnricher 用它计数，删除现在"成功后按 fromCache 计数"的逻辑。测试：Google 返回错误时 `places.used` 仍 +1；库命中不计。

N4. **模型自己的工具调用不计预算** `lib/planAgent/tools.ts`（`estimate_travel`、`resolve_place`、`find_restaurants`）、`travelHelpers.ts`（`runEstimateTravelTool`）：同一 run 的 `deps.enrichBudget` 对模型工具调用同样计数（通过同一个 `onGoogleCall`）；预算桶用尽时工具返回 `{ error: '本回合外部查询预算已用完，请先用 save_plan_days 保存当前进度，下一回合继续补充', code: 'budget_exhausted' }`。预算上限调整为 `directions.max = 12`、`places.max = 6`（分别低于 15/分钟与 8/分钟窗口）。提示词补一句："收到 budget_exhausted 时立即保存并结束本轮，不要换别的工具重试"。测试：模型调用 3 次 estimate_travel 后 enricher 只剩 9 次可用；耗尽后工具返回 budget_exhausted。

## LOW

N5. **连续 user 消息** `lib/planAgent/loop.ts`：不再单独插入 `[系统状态]` user 消息，而是把阶段上下文拼进**内存中**最新 human 消息的内容前部（`"[系统状态]\n…\n\n[用户消息]\n" + 原文`）；落库行仍是纯用户原文。空回合重试的 user 指令与 ask_user/协议守卫流程不变。测试：system 恒为原文；最后一条 user 消息以"[系统状态]"开头且包含用户原文；落库无 [系统状态]。

N6. `gates.ts`：`payload.transport` 存在但 `provider` 为空的 transit 行，不计入 `transitLegs`（只计入 missingTransit），避免估算占比分母失真。
