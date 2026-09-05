# Plan Agent：提问类型分流与 Daymap 对话时间线

- 日期：2026-09-01
- 分支：`feat/plan-agent-m1`
- 状态：已由 `opencode` 实现，待预览部署/冒烟验收
- 最终澄清（2026-09-01，权威）：作品选择题保持既有作品卡交互，**不**渲染卡内自定义选项卡；通用意见题使用新的文本优先选项组件并在卡内末位提供自定义输入。服务端只在 opinion 任务末位追加保留的 `__custom__` 选项，work 任务保持既有选项语义。所有 ask（含作品选择）的最终自由文本兜底都是全局聊天输入框（answerTo + `{custom}`）。
- 范围：修复通用意见提问误用作品卡片的问题；把 daymap 从页面底部的单一当前态改为对话流中的可持久化交付物

## 1. 问题定位

### 1.1 通用意见问题复用了作品选择卡

当前 `AskUserPayload` 只有 `kind`（日期/单选/多选），没有表达“选作品”和“选方案/表达意见”的任务语义。服务端 `ask_user` 对两者都走同一个 `buildValidatedAskOptions`，客户端 `AskCard` 对所有非 `date_range` 都渲染 `ChoiceAsk`。

`ChoiceAsk` 的每个选项都会进入 `OptionCover`：有图时用 `/map` 图片策略，无图时显示 3:4 的渐变大占位和选项首字。这个组件对作品候选是合理的，但对“自驾/公共交通/混合/自定义”这类意见题会产生截图中的错误视觉和错误语义，让用户误以为是在挑作品。

### 1.2 Daymap 不是消息，而是页面末尾的当前计划

`ui.tsx` 先遍历全部聊天消息，再在 `chatEndRef` 后固定渲染一次 `DayCards(plan)`。`save_plan_days` 只替换 `TripPlanDay/TripPlanItem` 并发 `plan_updated`，没有保存一个代表本次交付物的消息或快照。

因此后续提问只能出现在当前 daymap 之后的页面结构之外，下一次保存又会让原先看到的地图变成新计划的当前态，无法形成“文字 → daymap A → 提问 → 回答 → daymap B”的可恢复时间线。

### 1.3 不需要改动 Google 集成

Google Places/Directions 当前已恢复；本次只处理提问协议和 daymap 消息模型，不能把外部 API 状态作为实现前置条件，也不能在前端暴露密钥。

## 2. 目标与非目标

### 目标

1. `ask_user` 明确区分三类任务：日期、作品选择、通用意见/方案选择。
2. 日期选择器保持现有行为；作品选择保持封面图、作品来源和 `bangumiId` 语义。
3. 通用意见题使用全新的文本优先选项卡，支持单选/多选和末位自定义输入；全局输入框继续作为最终兜底。
4. 每次成功保存完整行程都产生一个不可被后续保存覆盖的 daymap 交付物，并按消息顺序显示在聊天流中。
5. 刷新页面后仍能恢复历史提问和历史 daymap；后续提问可以自然追加在地图下方，后续保存产生新的 daymap。

### 非目标

- 不改变日期选择器协议或已有作品卡的视觉设计。
- 不重新设计 `/map` 页面、MapLibre 图层或 Google API 客户端。
- 不把 daymap 拆成新的数据库表；`TripPlanMessage.kind` 当前是 Prisma `String`，可安全增加逻辑消息种类。
- 不让模型在聊天文字中直接提问；现有协议守卫仍然有效。

## 3. 提问协议设计

### 3.1 显式任务类型

在 `lib/planAgent/askUser.ts` 增加任务类型：

```ts
type AskUserTaskType = 'date_range' | 'work_selection' | 'opinion'
```

`AskUserPayload` 和 `PlanAgentEvent` 的 `ask` 载荷携带 `taskType`。保留 `kind: 'date_range' | 'single_choice' | 'multi_choice'` 作为交互基数：

- `taskType=date_range` 只能配 `kind=date_range`，不带 options。
- `taskType=work_selection` 只能配单选/多选，表示“用户要选哪些作品/候选作品”。
- `taskType=opinion` 只能配单选/多选，表示出行方式、节奏、预算倾向等用户决策，不表示作品实体。

服务端工具参数把 `taskType` 设为必填，并在 `executePlanTool` 做一致性校验。错误要返回模型可修正的中文结构化错误，不能静默猜类型。

历史落库 ask 可能没有 `taskType`，读取时提供兼容归一化：

1. `kind=date_range` 归一为 `date_range`；
2. 旧 options 全部显式 `preferenceOnly=true` 且没有 `bangumiId` 时归一为 `opinion`；
3. 其余旧选择载荷归一为 `work_selection`，保证旧作品卡不改变。

新发起的 ask 不允许依靠上述推断，必须由工具参数明确声明类型。

### 3.2 服务端选项门

让 `buildValidatedAskOptions` 接收 `taskType`，沿用现有最多 19 个模型选项的上限：

- `work_selection`：保留当前作品封面阶梯、图片安全检查、来源三件套和 `bangumiId` 规范来源。新作品选项必须有可追溯的 `bangumiId`/来源；允许服务端通过 `resolveOptionCover` 补本地封面。**不追加**保留的自定义选项（最终澄清）：作品卡保持既有选项语义，自由文本回答由全局输入框兜底；历史过渡期落库的 work 载荷若残留 `__custom__`，渲染层忽略该保留项。
- `opinion`：不调用 `resolveOptionCover`，不接受 `bangumiId` 或 `image`，避免再次进入作品媒体语义。纯偏好选项显式带 `preferenceOnly=true`；若选项确实引用外部事实，可以保留来源三件套，但不得带作品字段或封面字段。
- 仅 `opinion` 在末位追加同一个保留的自定义选项 `__custom__`。自定义项不参与来源门控。

更新 `PLAN_AGENT_TOOLS` 和 `PLAN_AGENT_SYSTEM_PROMPT`：

- 明确“问用户选作品”必须 `taskType=work_selection`；
- 明确“问用户意见/出行方式/方案取舍”必须 `taskType=opinion`；
- 给出交通不便问题的意见题示例（自驾/租车、公共交通、混合、自定义），并禁止把它作为作品选择；
- 保留 `date_range` 的原说明、结构化回答权威值和 ask 后结束本轮规则。

`statusPhrases`、协议守卫提示和路由注释同步使用新术语，但不改变“所有需要回答的问题必须调用 ask_user”的门控逻辑。

## 4. 前端组件设计

### 4.1 按任务类型分流

在 `AskCard.tsx` 保留日期分支和现有作品卡逻辑，新增独立的通用意见组件（名称可为 `OpinionChoiceAsk`）：

```text
date_range       -> DateRangeAsk（现有实现）
work_selection   -> WorkChoiceAsk/现有 ChoiceAsk（封面卡，不改语义，不渲染自定义卡）
opinion          -> OpinionChoiceAsk（新组件，末位带自定义输入）
```

不要通过“有没有图片”“有没有 `bangumiId`”在渲染时猜类型；类型来自 payload，历史兼容只在 view 归一化层做一次。

### 4.2 通用意见卡片的交互

- 文本优先、紧凑、可扫描的选项列表/卡片；显示 A/B/C 等稳定顺序标识、label 和可选 sublabel。
- 不显示 3:4 封面、不显示首字渐变占位、不加载 `ResilientMapImage`，也不展示作品图片署名。
- `single_choice` 保持点选后提交的快捷行为；`multi_choice` 保持勾选后点击确认。
- 末位 `__custom__` 显示为“其他/自定义输入”选项，打开卡内文本输入；输入内容回传 `{ custom }`。自定义项必须仍然是最后一个选项。
- 全局输入框在待回答 ask 期间继续携带 `answerTo` 和 `{ custom: message }`，作为所有选择卡的最终保底。
- 选项、长文案和输入框在移动端不得溢出；保持现有无障碍按钮、禁用态和键盘 Enter 提交行为。

更新 ask 相关客户端类型、SSE `ask` 事件拼装、历史 ask chip 图标判定及现有测试 fixture，使新字段在实时和刷新两条路径都可用。

## 5. Daymap 对话时间线

### 5.1 持久化消息形状

在 `TripPlanMessageKind` 增加逻辑值 `daymap`。Prisma schema 不需要迁移，因为 `kind` 是 `String`；memory repo 和 Prisma repo 均按现有 append/list 语义透传。

定义可版本化的 daymap 载荷，至少包含：

```ts
type DaymapMessagePayload = {
  type: 'daymap'
  revisionId: string
  savedAt: string
  days: TripPlanDayView[]
}
```

`days` 必须是 `replaceDays` 成功后的结构化快照（含点位、外部地点 payload、schedule、transport、media 和 provider polyline），不能只存当前 plan id 再回读当前 days，否则旧地图会被后续保存改写。载荷不得包含 API key。

### 5.2 保存工具与 SSE

在 `save_plan_days` 成功完成确定性校验和替换后：

1. 生成新的 `revisionId`；
2. 追加一条 `kind=daymap` 消息；
3. 通过新的 `PlanAgentEvent`（例如 `{ type: 'daymap', revisionId, days }`）实时下发同一快照；
4. 仍发送现有 `plan_updated`，供标题/当前计划元数据刷新。

优先把“替换天数 + 追加 daymap”封装为 repo 的带 run-token 方法，至少保证二者都经过现有 fencing；若受当前 repo 抽象限制无法共事务，必须保证 daymap 追加失败能被显式记录/重试，不能静默告诉用户保存成功。工具消息回放仍保持 OpenAI assistant/tool 成组规则，daymap 不进入模型上下文。

实时事件和历史 `toChatView` 使用同一载荷解析器，避免 SSE 与刷新后的字段漂移。对同一工具调用应保持幂等，不能因客户端重连重复插入同一个 revision。

### 5.3 聊天视图与渲染位置

扩展 `ChatEntryView`，允许一个 assistant 时间线条目携带 `daymap`。`toChatView` 遍历消息时按 `createdAt` 顺序插入 daymap；`human/assistant/ask` 的旧逻辑保持不变，`tool/daymap` 不作为模型文本。

`ui.tsx` 不再在整个 chat map 之后固定渲染一个 `DayCards(plan)`。它应在 `chat.map` 的对应条目位置渲染 daymap 组件：

```text
assistant 解释
daymap A
assistant 提问
ask_user opinion
user 回答
assistant 解释
daymap B
```

实时收到 `daymap` SSE 时按 revision 去重后追加到本地 chat；收到 `plan_updated` 仍刷新当前 `plan` 元数据。输入框、滚动锚点和待回答 ask 判断都以完整聊天流末尾为准。地图不再是固定底部侧栏或单一 current map。

### 5.4 DayCards 复用边界

让 `DayCards` 支持渲染传入的 daymap 快照（或提取一个轻量 `DaymapMessage` 包装器），而不是只能读取当前 `plan.days`。每个历史 daymap 的 Day tab 状态应独立，不能让一个地图的切天影响其他地图。

保留当前路线行为：优先使用快照中的 provider geometry，缺失时走现有路线 API/缓存和失败重试；保留列表/地图切换、图片阶梯、时间排序、交通说明。保存/导出按钮需要明确作用域：历史快照不可悄悄修改快照；可以隐藏历史快照的“保存到我的地图”，或明确它导出的是当前计划，并用测试固定选择。

无历史 daymap 的存量计划提供兼容回退：仅当 `chat` 中没有 daymap 且当前 plan 有 days 时，追加一次标记为 legacy 的当前交付物；一旦有真实 daymap 消息，不得再额外渲染底部副本。

## 6. 测试与验收

### 6.1 协议/后端

- 新 `ask_user` schema 要求 `taskType`；date/work/opinion 的不匹配参数结构化拒绝。
- `work_selection` 仍补封面、来源和 `bangumiId`；`opinion` 不触发封面解析且拒绝图片/作品字段。
- 仅 `opinion` 追加末位 `__custom__`；`work_selection` 不追加（最终澄清），且渲染层忽略历史 work 载荷残留的 `__custom__`。超过 19 个模型选项仍拒绝。
- 历史无 `taskType` ask 能按兼容规则读取；日期 payload 不受影响。
- `save_plan_days` 成功后有一条 daymap 消息和 daymap SSE，快照包含归一化时间、交通、外部地点媒体和路线几何；工具遥测不落库。
- 两次保存产生两个不同 revision，历史消息的 days 不被第二次保存改写；fencing/失败路径不产生半截成功状态。

### 6.2 前端

- 渲染 `taskType=work_selection` 时能看到封面作品卡，且没有"其他（自行输入）"自定义卡（含历史残留 `__custom__` 的载荷）；渲染 `taskType=opinion` 时没有 `img`、3:4 封面占位或作品首字大块，只看到文本选项和末位自定义输入。
- 单选、多选、意见卡自定义输入、全局输入框回传 answerTo/answerValue 的行为回归通过。
- 聊天 DOM 顺序覆盖“assistant → daymap A → ask opinion → user → daymap B”，且不再额外出现一个固定在列表末尾的 `DayCards`。
- 刷新后的 `toChatView` 与实时 SSE 渲染相同；重复 revision 不重复渲染。
- 日期选择器、已有作品选择卡、地图 provider/fallback 路线和响应式布局回归通过。

实现验收记录：`npm test` 通过（286 个文件，2041 个测试通过，2 个跳过）；
`npm run typecheck:app` 与 `git diff --check` 通过。`npm run typecheck:tests`
仍有 3 个既有错误，均位于未触及的 `tests/lib/prisma-client-lifecycle.test.ts`。

### 6.3 验收场景

1. 让 agent 询问“这次山区行程以什么交通方式为主”，应弹文本意见卡：自驾/租车、公共交通、混合、自定义；不能出现作品封面大卡。
2. 让 agent 询问“要巡礼哪些作品”，应仍使用原作品封面卡；日期提问仍使用日期选择器。
3. 先生成并保存 daymap A，再在地图下回答一个意见题，再保存修改后的行程；页面按时间线显示两个独立 daymap，A 的点位/路线保持不变。
4. 刷新计划页，以上两张 daymap、意见 ask 的折叠摘要和回答顺序保持不变。
5. Google API 可用或不可用都不改变组件分流；本次验收不依赖重新配置 Google key。

## 7. 实现边界与交付

`opencode` 负责读取本计划并修改实现/测试；不得 reset、checkout 或覆盖工作区已有 M1/M3/map failover 改动，不需要提交 commit 或部署。实现完成后应运行相关 Vitest、`npm run typecheck:app`、`git diff --check`，并报告任何只存在于既有文件的类型检查错误。由主 agent 复核 diff、测试结果和上述验收场景，再决定是否部署预览。
