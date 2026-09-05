# plan agent M4：可恢复的编排状态机 + 服务端补齐脚本 + 质量门控（设计）

日期：2026-09-02　状态：用户已批准方向（附带约束：流程必须可恢复，agent 需能从证据判断当前阶段，而不是信任固定触发顺序）

## 1. 问题

当前 agent 的流程顺序、外部地点解析、餐厅、交通、时间都只靠提示词约束。模型漏做或顺序错乱时直接落库，用户在 daymap 上看到占位图、交通缺失、时间冲突。第二轮回归（2026-09-02）逐条验证了这些症状，也验证了服务端"兜底脚本"比提示词可靠得多（placeBackstop、日本公交估算、归一化自愈都是服务端脚本解决的）。

## 2. 目标与非目标

目标：
1. 规划过程由服务端**阶段模型**驱动；每个阶段有"必做动作"脚本，模型只负责需要判断的节点（选作品、选交通偏好、写理由与摘要）。
2. **可恢复**：断线、空回合、进程重启、并发接管后，下一轮从"证据推断出的当前阶段"续跑，绝不从头来，也绝不因为"上一步没按顺序触发"而卡死。
3. **质量门控**：落库前硬性检查；不过则拒绝并返回结构化整改单给模型。门控结果只进运行日志，不展示给 C 端用户。
4. **可观测**：阶段、门控、补齐动作写入运行日志表，供回归分析。

非目标：更换模型；重写聊天 UI；思维链持久化（另立任务，但本设计的运行日志为其预留结构）。

## 3. 核心原则：阶段由证据推断，不由计数器记录

状态机不存"当前阶段"字段作为唯一真值。每次 agent 回合开始时，服务端用 `derivePlanStage(plan, messages)` 从**持久化证据**推断阶段：

| 阶段 | 判定证据（全部来自库） |
|---|---|
| `works` 作品确认 | `plan.bangumiIds` 为空 |
| `dates` 日期 | `bangumiIds` 非空且 `startDate`/`dayCount` 缺失（`dayCount` 默认 1 视为缺失） |
| `points` 点位与聚类 | 日期齐但 `plan.days` 为空或没有任何带 `pointId` 的条目 |
| `enrich` 补齐（地点/餐厅/交通/时间） | 有 days，但质量门控存在未通过项 |
| `deliver` 交付 | 门控全部通过，且最近一条 daymap 的 `revisionId` 对应当前 days |
| `revise` 修订 | 用户在 deliver 之后又发了新消息 |

推断结果只作为**提示词注入的上下文**（"当前阶段：enrich；未通过门控：交通门 3 处、图片门 2 处"）与**服务端脚本的触发依据**，模型仍可根据用户意图跳转（例如用户中途换作品 → 回到 `works`）。`TripPlan.stage` 字段只做缓存与展示，不做约束；不一致时以推断为准并回写。

## 4. 服务端补齐脚本（Enrichers）

在 `save_plan_days` 之前（以及在 `enrich` 阶段每个回合开始前）按固定顺序执行，全部幂等、失败静默记录：

1. `placeEnricher`：lodging/meal/attraction/无 pointId 的 point 缺 place → 解析（已有 `placeBackstop`）。
2. `restaurantEnricher`：meal 条目仍无 place → 以前一个有坐标条目为中心 `find_restaurants` 取最优，note 写备选。
3. `transportEnricher`：相邻两个有坐标条目之间缺 transit 行 → 按当天出行偏好（`plan.preferences.travelMode`，缺省 mixed）查 `estimate_travel`；日本公交缺口走参考估算（已实现）。
4. `scheduleEnricher`：归一化自愈（已实现）。
5. `mediaEnricher`：有 place 无 media → 由 place.photo 派生（已实现 derivePlaceMedia）。

每个 enricher 返回 `{ applied: number; skipped: Array<{ itemTitle; reason }> }`，汇总进 `EnrichReport`，随 `save_plan_days` 结果回给模型，并写运行日志。

预算：每次保存 Google 调用总预算 12 次（places 6 + directions 6），超出部分记 skipped，由下一回合继续补（阶段推断会再次进入 `enrich`）。

## 5. 质量门控（Gates）

`evaluatePlanGates(plan): GateReport`，纯函数，落库前与阶段推断时都调用：

| 门 | 规则 | 失败处理 |
|---|---|---|
| 坐标门 | 每个可到访条目（point/attraction/lodging/meal）有坐标 | 硬失败：拒绝落库 |
| 交通门 | 相邻有坐标条目之间存在 transit 行且 `transport.provider` 非空 | 硬失败 |
| 时间门 | 归一化 ok；每天首尾跨度 ≤ 13 小时 | 硬失败 |
| 密度门 | 每天可到访条目 3–9 个 | 软失败：允许落库，报告中提示 |
| 图片门 | 可到访条目有图比例 ≥ 80% | 软失败 |
| 出处门 | 每个 payload.place 有 provider+placeId；估算交通有 `estimated:true` | 硬失败 |
| 估算门 | 估算交通占比 ≤ 60% | 软失败 |

硬失败返回给模型的整改单是结构化的：`{ gate, dayIndex, itemTitle, fix: '用 estimate_travel 补 A→B 交通' }`，并且服务端已先跑过一遍 enrichers，所以模型收到的是"脚本补不了的剩余项"。

可见性（2026-09-02 用户决定）：门控、阶段、补齐报告都是内部机制，**不向 C 端用户展示**。`GateReport` 随 daymap 快照落库（payload `quality` 字段）只用于运行日志与内部排查；C 端只看到结果本身——点位图片、地图、交通信息齐全。后续如需查看，放管理后台而不是计划页。

## 6. 回合编排（loop 的变化）

每回合开始：
1. `stage = derivePlanStage()`，`gates = evaluatePlanGates()`。
2. 若 `stage === 'enrich'`：先跑 enrichers（不经模型），把 `EnrichReport` 作为 system 级上下文注入本回合。
3. 提示词注入：当前阶段、未通过门控、建议的下一步动作（由服务端生成的一两句话，不是硬指令）。
4. 模型回合照常（工具循环、空回合守卫、协议守卫）。
5. `save_plan_days`：enrichers → gates → 硬失败则拒绝并返回整改单；通过则落库 + daymap（含 quality）。

恢复：断线/重启/接管后，新回合的第 1 步天然从证据续跑；`agentBusy` 与 run-token 栅栏不变。

## 7. 运行日志

新表 `TripPlanRunLog`：`planId, runToken, turnIndex, stage, enrichReport(Json), gateReport(Json), toolCalls(Json 摘要), modelUsage(Json), durationMs, createdAt`。前端暂不读取；后续思维链持久化可复用 `toolCalls` 字段。

## 8. 交通信源阶梯（与本设计并行推进）

主用 NAVITIME `route_transit` → 次选 Ekispert → 兜底现有参考估算。`transportEnricher` 的 provider 顺序可配置（`PLAN_AGENT_TRANSIT_PROVIDERS=navitime,ekispert,google,estimate`），每个 provider 实现同一接口 `TransitProvider.route(from, to, departAt) → TravelResult | null`。试用 key 到手后先做新宿→浅草冒烟再接入。

## 9. 分期

- **第一期**（本设计主体）：enrichers 汇总层 + gates + 阶段推断注入提示词 + 运行日志。不改对话形态，不增加任何 C 端可见的内部状态。
- **第二期**：TransitProvider 抽象与 NAVITIME/Ekispert 接入；思维链持久化读 `TripPlanRunLog`。

## 10. 测试要点

- `derivePlanStage` 对每种证据组合的判定，含"用户中途换作品"的回退；
- 每个 enricher 的幂等与预算耗尽行为；
- gates 的硬/软失败分类与整改单形状；
- loop：断线后新回合从 `enrich` 续跑且不重复补齐；硬失败时 save 被拒且模型收到整改单；
- daymap payload 的 `quality` 字段透传（前端不渲染）。
