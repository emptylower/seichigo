# plan agent 订阅分档与用量计量（设计）

日期：2026-09-06　状态：用户已批准方向（包月订阅、用户侧只看百分比、三档分级、先只开放标准档购买、高级档占位）

## 1. 问题

Plan 页的 agent 目前由站方 DeepSeek key 和 Google key 直接承担全部成本，用户无限制使用。要把它做成收费项目，需要回答三件事：成本怎么算、用户买到的是什么、毛利怎么保证。

已核对的现状：

- `lib/llm/openaiClient.ts` 的流式请求不带 `stream_options.include_usage`，SSE 末帧的 usage 被丢弃；`TripPlanRunLog.modelUsage` 只存 provider、model、protocol，没有任何 token 数。
- 每个 run 的外部成本由两部分构成：DeepSeek token，以及 Google Places（Text Search、Nearby、Details、Photos）与 Directions 调用。后者按公开牌价量级估算通常高于前者，且 Directions 与餐厅搜索几乎不可缓存；地点解析与照片经 ExternalPlace 与照片镜像缓存后边际成本随覆盖增长下降。
- Google Directions 对日本境内 `mode=transit` 一律 ZERO_RESULTS，现由 driving 与 walking 两次兜底补查代替（`lib/directions/googleClient.ts` 注释与 `transportEnricher` 已记录）。即任何用户目前都拿不到日本真实公交。
- 仓库没有任何支付 SDK、余额或配额表。
- 模型供应商由管理员在 `/admin/llm` 配置，`resolveLlmForScope` 按 agent / translation 两个 scope 全站接管，不存在按用户选模型。

## 2. 目标与非目标

目标：

1. **三档订阅**：免费、标准、高级。首期只开放标准档购买；高级档在 UI 上展示但不可订阅。
2. **用户侧只看一个数**：“本月 agent 用量剩余 xx%”。不出现 credits、token、调用次数、成本等任何内部概念。
3. **毛利结构性保证**：每档的月度成本预算按月价的固定比例设定，用满也不低于目标毛利；用不满的部分是额外利润。
4. **计量先行**：先把每个 run 的真实成本算出来落库，只记账不扣费，用真实分布定价。
5. **权限分级可扩展**：未来的日本公交 API、酒店、航班、多模型选择都能挂到同一张能力表与同一张价格表上。

非目标：支付渠道接入（独立子项目，本文只定义它需要写入的字段）；年付与折扣；企业或团队账户；退款流程；更换默认模型。

## 3. 商业模型

| 档位 | 首期状态 | 月价 | 月度成本预算 | 定位 |
|---|---|---|---|---|
| 免费 | 开放 | 0 | 固定小额，见 §6.3 | 体验与转化 |
| 标准 | 开放购买 | P_std | P_std × 45% | 完整的当前功能 |
| 高级 | 占位，不可订阅 | P_pro（展示“即将开放”，不显示价格） | P_pro × 45% | 贵 API 与多模型 |

45% 的成本占比留出 5 个点给支付手续费、退款与 Worker、Neon 摊销，对应用满时毛利 55%。P_std 与 P_pro 的具体数值在计量层跑满两周、拿到 p50 与 p75 单次成本后再定，见 §10。

## 4. 用户侧体验

- Plan 页侧栏与账户页显示一个进度条与文案“本月 agent 用量剩余 xx%”，重置日期以“x 月 x 日恢复”呈现。
- 百分比向下取整到整数；低于 1% 但大于 0 显示 “<1%”。
- 剩余不足以启动新一轮时，输入框禁用并提示“本月用量已用完，x 月 x 日恢复”，标准档以下附升级入口。
- 免费档的交通行显示“参考估算”徽标，徽标旁的文案指向升级；餐厅位显示“升级后可推荐餐厅”的占位卡。这两处是唯一允许出现的档位差异提示，不解释背后机制。
- 定价页列出三档，高级档卡片可见、按钮置灰、标注“即将开放”。
- 不显示每次规划消耗了多少、也不显示任何成本或 token 明细。

## 5. 权限层（entitlements）

服务端代码内一张能力表，以 tier 为键，不进数据库：

| 能力 | 免费 | 标准 | 高级 |
|---|---|---|---|
| agent 规划、追问、重生成 | 是 | 是 | 是 |
| Anitabi 点位、聚类、封面、日程排布、图片去重与邻近图 | 是 | 是 | 是 |
| 地点解析与照片（Places Text Search、Details、Photos） | 是 | 是 | 是 |
| 餐厅推荐（find_restaurants 工具、meal 与 restaurant enricher） | 否 | 是 | 是 |
| 真实路线（Directions；estimate_travel 工具、transport enricher） | 否，只有直线估算 | 是（日本境内为步行与驾车） | 是 |
| 日本公交 API（未来） | 否 | 否 | 是 |
| 酒店、航班 API（未来） | 否 | 否 | 是 |
| 模型选择（未来，见 §9） | 否 | 否 | 是 |
| 单个行程天数上限 | 3 | 7 | 14 |
| 单 run Places 预算上限 | 15 | 40（现值） | 40 |
| 单 run Directions 预算上限 | 0 | 40（现值） | 40 |
| 队列优先级 | 普通 | 普通 | 优先 |

能力表在三个卡点生效，任何一处不得单独判断 tier：

1. **工具暴露**：组装 tools 时按能力表过滤。免费档不注入 `estimate_travel` 与 `find_restaurants`，提示词追加一句“本档位交通只能用直线估算，不要尝试查询餐厅”。工具被调用但档位不允许时（防提示词失效），返回 `{ error, code: 'tier_forbidden' }`，模型按现有 `budget_exhausted` 同样的收尾规则处理。
2. **补齐层**：`EnrichBudget` 的 `places.max` 与 `directions.max` 由能力表初始化。免费档 `directions.max = 0`，transportEnricher 现有的“预算耗尽走 heuristicTransit”路径自然生效，估算行保留 `source:'heuristic'` 标记。restaurantEnricher 与 mealEnricher 在能力表关闭时直接跳过并在 enrichReport 记录 `skipped: 'tier'`。
3. **前端**：交通与餐厅的档位提示（§4）由 `GET /api/me/usage` 的 `hints` 字段给出（`transitEstimateOnly`、`restaurantsLocked`、`maxDays`），前端只渲染，不自行判断 tier。

天数上限在 `save_plan_days` 与 `update_plan_meta` 的服务端校验里生效，超出时返回结构化错误让模型缩减天数并告知用户。

## 6. 预算层

### 6.1 记账单位

内部一切以 **costMicros**（微美元，1 美元 = 1,000,000）记账。月价以人民币标价，换算汇率是价格表里的一个常量，每次调价时人工更新。

### 6.2 生命周期

- **周期**：按订阅日滚动，`periodStart` 到 `periodEnd` 为一个月。免费档以注册日为锚。周期切换时余量清零、不结转，写入一条 `grant` 账目。
- **预扣**：POST `/api/me/plans/[id]/agent` 投队列前，按该档最近 30 天 run 成本 p75（价格表里维护的常量 `reserveMicros[tier]`）预扣一笔 `reserve`。余量不足以覆盖预扣则拒绝，返回 `402` 与恢复日期。
- **结算**：run 结束时按真实 costMicros 写 `settle`，同时冲销对应 `reserve`。真实成本超过预扣时按真实值扣，允许余量短暂为负；为负时不能再启动新 run。
- **退回**：run 因内部错误、供应商 5xx、被用户停止而未产生任何模型输出时，`refund` 全额；已产生部分输出的 run 按真实成本结算，不退。
- **单次上限**：标准与高级档一个 run 的 costMicros 不得超过月预算的 15%；免费档预算本身只够两到三次，单次上限取月预算的 50%。达到时 loop 把本 run 的 Google 预算上限压到已用量（后续补齐全部走直线估算），向模型注入一条“预算已用完，立即保存并结束”的系统状态，并最多再允许两次模型调用用于保存与收尾。
- **现有日限**：`DAILY_MESSAGE_LIMIT`（每日 20 条）保留为防滥用闸门，与预算层并存。
- **run 中途跨周期**：以 run 开始时所在周期记账，不拆分。
- **管理员**：`isAdmin` 用户不预扣不结算，但仍完整记录 run 成本（用于回归与校准）。
- **被接管的 run**：栅栏接管后仍按真实成本结算（成本已经发生）；接管方的新请求在预扣前把该用户超过两倍 busy TTL 仍未结算的孤儿预扣全部退回。

### 6.3 免费档预算

免费档预算是一个固定微美元常量，目标是“够完成两到三次 3 天以内、无交通无餐厅的规划”。首期取值 = 免费路径 p75 单次成本 × 2.5，由计量数据给出。它记为获客成本，不进付费毛利的分母，但进入 §10 的整体毛利公式。

## 7. 计量层

### 7.1 模型用量捕获

- `openaiClient.streamChat`：请求体加 `stream_options: { include_usage: true }`；SSE 末帧 `chunk.usage` 解析出 `prompt_tokens`、`completion_tokens`、`prompt_cache_hit_tokens`、`prompt_cache_miss_tokens`、`completion_tokens_details.reasoning_tokens`（缺省为 0）。usage 以不可枚举属性附在返回消息上，与现有 `provider` 同一手法，保证不进 TripPlanMessage。
- `openaiClient.completeText`（标题、翻译）：非流式响应直接读 `usage`。
- `anthropicClient`：`message_start` 的 `usage.input_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens` 与 `message_delta` 的 `usage.output_tokens`。
- 供应商未返回 usage 时记 `usageMissing: true`，成本按该模型最近 30 天平均单次成本兜底，并计入日志告警。

### 7.2 外部调用计数

`EnrichBudget` 现有 `used` 计数按 60 秒窗口滚动，不能直接当 run 总量。在 `EnrichBudget` 上新增随 run 生命周期累加、不随窗口归零的 `calls` 分类计数，所有外呼点（工具 `resolve_place`、`find_restaurants`、`estimate_travel`，以及 `placeBackstop`、`imageDedupeEnricher`、`restaurantEnricher`、`transportEnricher`）在真实发出请求时各 `+1`，按类别分：`placesTextSearch`、`placesNearby`、`placeDetails`、`directions`。缓存命中不计。照片（Photos）经镜像在 run 之外拉取、无法按 run 归集，按次价摊进 `placeDetails` 的单价；标题侧信道每个带新用户消息的 run 按固定常量 `TITLE_OVERHEAD_MICROS` 摊入模型成本。

### 7.3 价格表

服务端单文件常量，不进库，键为模型名或调用类别，值为每单位微美元：

- 模型：每百万 token 的 `inputMiss`、`inputCacheHit`、`output`（reasoning 计入 output）。
- Google：每次调用的价格，按上面四类（Photos 摊入 placeDetails）。
- 未来项预留：`japanTransit`、`hotelSearch`、`flightSearch`。
- 汇率常量与 `reserveMicros[tier]`、`freeBudgetMicros`。

数值来源必须是 DeepSeek 与 Google 当前价格页，上线前人工填写并在文件头写明抄录日期。价格表变更走正常代码评审。

### 7.4 落库

`TripPlanRunLog.modelUsage` 扩展为：

```
{
  providerId, providerName, model, protocol,           // 现有
  tokens: { inputMiss, inputCacheHit, output, reasoning },
  models: { [modelName]: tokens },
  calls: { placesTextSearch, placesNearby, placeDetails, directions },
  costMicros: { model, google, total },
  modelCalls: number,
  usageMissing: boolean,
  priceTableVersion: string
}
```

一个 run 内多次模型调用在 loop 累加后一次写入。计量层上线后的前两周只写此表，不做预扣与结算。

## 8. 数据模型

User 新增：

```
tier          String   @default("free")   // free | standard | pro
periodStart   DateTime @default(now())
periodEnd     DateTime?                     // null = 尚未初始化，首次访问时由 billing service 计算
```

新表 UsageLedger：

```
id            String   @id @default(cuid())
userId        String
planId        String?
runRef        String?                      // 路由生成的计费引用，reserve/settle/refund 配对
kind          String                       // grant | reserve | settle | refund
deltaMicros   BigInt                       // grant 为正，其余为负或冲销
balanceAfter  BigInt
periodStart   DateTime
createdAt     DateTime @default(now())
@@index([userId, periodStart])
@@index([runRef])
```

余量 = 该用户当前周期内所有账目 `deltaMicros` 之和，`balanceAfter` 只作对账快照。周期内查询在一次事务里完成，预扣使用 `SELECT ... FOR UPDATE` 锁用户行防并发双扣。

支付子项目将来只需在支付成功回调里更新 `tier`、`periodStart`、`periodEnd` 并写一条 `grant`，本文不定义订单表。

## 9. 高级档占位与模型选择

高级档首期：能力表完整、预算常量存在、定价页展示卡片、按钮置灰、没有任何可购买路径。服务端拒绝一切把用户写成 `pro` 的入口（管理员手工改库除外，用于内测）。

模型选择的设计草案，**在高级档开放购买时（§13 第 4 期）实现**，首期只在能力表与定价页留占位：

- 管理员在 `/admin/llm` 的供应商模型列表上多一个 `exposeToPro` 开关。
- Plan 页设置里，高级档用户可从被暴露的模型里选一个，落在 `TripPlan.preferences.modelOverride`。
- `resolveLlmForScope('agent')` 读取该覆盖，仅在用户为 `pro` 且模型仍处于暴露状态时生效，否则回落到全站接管。
- 不同模型的价格都在同一张价格表里，选择贵模型自然更快消耗百分比，不需要额外规则。

## 10. 毛利模型与校准

定义：P 为月价折算的微美元，B = 0.45 × P 为月预算，C_paid 为付费用户当月真实成本（≤ B 加单次超支），F 为免费用户当月真实成本（≤ freeBudgetMicros），r 为免费转付费率。

- 单个付费用户用满时毛利 = 1 − B / P = 55%。
- 整体毛利 = 1 − (C_paid + F × (1 − r) / r) / P。要求 ≥ 50%，即 F × (1 − r) / r ≤ 0.05 × P + (B − C_paid)。这个不等式给出在既定 r 下免费预算的上限，也说明付费用户的 breakage 是免费成本的资金来源。

校准流程：计量层上线两周后，从 TripPlanRunLog 拉每档、每类 run 的 costMicros 分布，得出 p50、p75、p95。据此设定 P_std、`reserveMicros`、`freeBudgetMicros`，并检查付费档 15% 单次上限是否高于 p95。之后每月复核一次，价格表与常量的改动走代码评审。

## 11. 错误处理与边界

- 预扣后进程崩溃、run 永远不结束：该用户下一次请求预扣前，把超过两倍 busy TTL 仍未结算的 `reserve` 全部写 `refund`。
- 供应商未返回 usage：按 §7.1 兜底估算并告警，不阻断 run。
- 用户在 run 中被降级或周期切换：以 run 开始时的 tier 与周期为准，能力表在 run 开始时快照进 deps。
- 余量为负：只禁止新 run，不影响读取与导出。
- 价格表版本变化：run log 记录 `priceTableVersion`，历史成本不重算。
- 同一用户并发两个 plan 同时投队列：预扣在同一事务内加锁串行化，第二个可能因余量不足被拒。

## 12. 测试

- 单测：usage 解析（含缺字段、缺 usage、DeepSeek 与 Anthropic 两种形状）；RunMeter 计数只在真实外呼时增加；价格表计算；能力表三处卡点对三档的行为；预扣、结算、退回、周期切换的账目与余量；单次上限触发收尾。
- 集成：免费档 run 全程不发出 Directions 与餐厅请求；标准档 run 的 modelUsage 含完整成本明细；余量不足时 `/agent` 返回 402。
- 回归：现有 plan 页 Playwright 用例在标准档下行为不变；免费档看到估算徽标与餐厅占位。
- 只记账阶段结束时，人工核对两周 run log 成本总和与 DeepSeek、Google 控制台账单的偏差在 10% 以内，否则先修计量再定价。

## 13. 分期

1. **计量层**：usage 捕获、RunMeter、价格表、run log 扩展。上线只记账，跑两周。
2. **权限与预算层**：能力表、三处卡点、User 字段、UsageLedger、预扣结算、前端百分比与档位提示、定价页三档卡片（高级置灰）。上线时全员为免费档；管理员手工把内测用户改为标准档验证。
3. **支付子项目**：另立设计，接入后开放标准档购买。
4. **高级档开放**：日本公交 API 或模型选择任一就位后另立设计，届时定 P_pro 并放开购买。

按项目约定，方案定稿后代码改动交给 opencode 执行。
