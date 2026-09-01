# /plan 冒烟测试问题修复方案（桌面 + 移动双端）

> 输入：`docs/superpowers/research/2026-08-31-plan-page-smoke-test-findings.md`（现状事实调研）。
> UI/UX 部分由两个模型协作设计：Claude（架构草案）+ kimi k3（前端设计评审，读过全部相关代码后逐条修正），k3 的 6 处核心修正已全部采纳并标注。
> 本文档是方案（What/Why + 关键 How），实现交给 opencode 委派执行（前端 → `kimi-for-coding/k3 high`；后端 → `zhipuai-coding-plan/glm-5.3 max`，非 flash）。

## 0. 问题 → 方案映射

| 冒烟问题 | 方案章节 |
|---|---|
| 1 导航栏不符 spec | §1 |
| 2a 标题生成过慢（第二轮才出） | §2.1 |
| 2b 回复出现字面 `**`（不支持富文本） | §2.2 |
| 2c cluster 空返回（点位 ID 缺作品前缀） | §2.3 |
| 3.1 双大卡片割裂布局 → 整页 chat 布局 | §3.A |
| 3.2 思维链工作状态展示 | §3.B |
| 3.3 结构化交互组件（日期/选择卡片）| §3.C |
| 3.3 点位组件卡片（图/序号/名称/时间/描述/交通）| §3.D |
| 3.4 最终地图渲染未实现 | §3.E |
| 4 页脚移除 + 结果导入"我的地图" | §3.A（页脚）/ §3.F（导出） |

---

## 1. 导航栏修复

目标形态（用户验收口径）：**计划 | 地图 | 热门攻略 | 热门城市 | 社群** + 语言 + 账号（头像，下拉即"我的"二级菜单）。

### 1.1 桌面导航 `components/layout/HeaderPublic.tsx`

- 删除 `/me`（"我的"）一级链接（44-49 行数组中移除一项）。其余五项（计划/地图/热门攻略/热门城市/社群）保持现状——现状桌面导航本就没有资源/投稿，无需改。

### 1.2 移动端抽屉 `components/layout/HeaderMobileDrawer.client.tsx`

- `navItems`（73-83 行）删除 `/me`、`/resources`、`/submit` 三项，保留 计划/地图/热门攻略/热门城市（社群、语言、账号区块已独立存在）。
- "账号"分区内补齐与桌面下拉一致的条目（见 1.3）。

### 1.3 账号下拉 `components/layout/HeaderAuthControls.client.tsx`

下拉菜单（176-219 行 inline 变体 + 94-174 行 drawer/stack 变体，两处同步）调整为：

1. 我的主页（`/me` 聚合页，新增条目——"我的"从一级导航降级到这里）
2. 我的收藏（`/me/favorites`，保留）
3. 我的地图（`/me/routebooks`，保留）
4. 我的巡礼计划（`/plan`，新增，与 /me 聚合页的入口呼应）
5. **投稿**（`/submit`，新增——按用户指示从一级导航移入此处）
6. 用户中心 → 改名"设置"（`/me/settings`，保留）
7. 管理员面板（admin 可见，保留）
8. 退出（保留）

- 硬编码中文标签（"用户中心""我的地图"）顺手接入 i18n（`header.*`/新增 `account.*` 词条），与其余条目一致。
- "资源"（`/resources`）：一级导航删除后放入页脚 `components/layout/Footer.tsx` 链接区（spec 原文允许"收入页脚或我的下"）；路由本身保留。

---

## 2. 对话功能 bug 修复

### 2.1 标题第一轮就生成（确定性方案，不赌 prompt）

现状根因：标题写入由 system prompt 第 5 步的 `update_plan_meta` 驱动，排在"先问清天数/日期"（第 3 步）之后，天然要到第 2-3 轮才触发。

方案（双管齐下）：

1. **确定性侧信道（主）**：`app/api/me/plans/[id]/agent/route.ts` 在 `beginAgentRun` 成功、agent loop 启动的同时，**并行**发起一次独立的轻量标题生成调用（同一 DeepSeek client，无工具、`max_tokens≈30`，prompt："根据用户的巡礼规划请求生成不超过 12 字的计划标题，只输出标题"），完成后仅当 `plan.title` 仍为 `'未命名巡礼计划'` 时经 `updateMeta` 写入（不覆盖 agent 后续起的更好的标题；写入后发 `plan_updated` 事件让顶栏标题原地刷新）。失败静默忽略（标题兜底交给 agent 流程）。
2. **prompt 辅助（次）**：`lib/planAgent/prompt.ts` 工作流程第 1 步后追加一句："确定作品后立即用 update_plan_meta 先写入一个初步标题（可随后更新）"。

注意：侧信道写标题**不走** run-token 栅栏（`updateMeta` 直连，非 `updateMetaIfActive`）——它不属于 agent run 的写序列，标题是幂等展示字段，与并发修复语义不冲突。

### 2.2 聊天气泡 markdown 渲染

`app/(authed)/plan/[id]/ui.tsx:104-115` 的 assistant 气泡从纯文本插值改为 markdown 渲染：

- 复用现有 `lib/comment/markdown.ts`（marked + sanitize-html）管线：新增一个 client 组件 `components/chat/MarkdownBubble.tsx`（或直接在 plan 目录内），将 assistant 文本经该管线转 safe HTML 后 `dangerouslySetInnerHTML` 输出，容器加 `prose prose-sm max-w-none` 级排版类（现有 sanitize 白名单已覆盖 b/strong/em/a/ul/ol/li/code 等常用标签；如白名单缺表格/标题标签，补齐即可）。
- 用户气泡保持纯文本（用户输入不需要渲染，也避免注入面）。
- 若 sanitize-html 在客户端 bundle 体积不可接受（构建时验证），退路是 `react-markdown` + `remark-gfm`；两者选型交实现者按 `npm run cf:build` 产物体积定，方案上不强制。

### 2.3 点位 ID 前缀问题（三层防御）

现状根因：`AnitabiPoint.id` 为 `"<bangumiId>:<rawId>"`（`lib/anitabi/source/normalize.ts:138-140`），`getPointsByIds` 精确 `in` 匹配，工具 schema 未告知格式，未命中静默返回空。

1. **Schema 说明（防患）**：`lib/planAgent/tools.ts` 中 `cluster_points.pointIds`（59 行）、`save_plan_days` 的 `pointId`（20 行）、`estimate_transit` 的 from/to 描述统一改为："点位 id 是形如 `<bangumiId>:<rawId>` 的不透明字符串，必须原样使用 list_points 返回的完整 id，不要截取或改写"。
2. **服务端容错（自愈）**：`lib/planAgent/pointsPrisma.ts` 的 `getPointsByIds` 增加一次兜底解析：首轮精确匹配后仍有未命中的 id 且 id 不含 `:` 时，用调用上下文可得的 bangumiIds（`plan.bangumiIds`）拼 `${bangumiId}:${id}` 重查一次；命中则返回并在结果中回写完整 id。
3. **显式报错（自诊断）**：`cluster_points` 执行器（`tools.ts:141-150`）在 `getPointsByIds` 结果数 < 入参数时，不再把空/缺员结果直接喂给聚类，而是返回 `JSON.stringify({ error: '以下点位 id 未找到（id 需为 list_points 返回的完整 "<bangumiId>:<rawId>" 形式）', missing: [...] })`——让 LLM 一步自纠，不再靠试错。

---

## 3. /plan 页 UI/UX 重构（吸收 k3 评审结论）

> k3 六处核心修正全部采纳：① 全 immersive + 自绘顶栏，展开态用右侧 dock 而非常驻面板；② 思维链完成态保留可回看 affordance、展开不触发自动滚动、移动端内联展开；③ 日期组件双端都 inline、自绘日历、旧组件永久定格；④ 行程组件全流唯一、原地更新，transit 走 payload Json 免迁移；⑤ 地图收进行程组件"列表/地图"tab、按天请求 geometry、inline 态禁单指手势；⑥ 保存入口唯一挂行程组件 header、幂等。

### 3.A 页面骨架（含页脚移除）

- `/plan/[id]`（列表页 `/plan` 同理酌情）设 `data-layout-wide="true" data-layout-immersive="true"`，复用 `styles/globals.css:28-44` 现成机制隐藏站点 header/footer（routebooks 详情页已验证的先例）——冒烟问题 4"页脚"随本项直接解决。
- 自绘顶栏：`h-14 shrink-0 border-b border-pink-100/80 bg-white/80 backdrop-blur-md`，内容 `mx-auto flex w-full max-w-3xl items-center gap-3 px-4`：返回（`/plan` 列表）+ 计划标题（truncate，`plan_updated` 时原地更新）+ `···` 菜单（重命名/删除/查看我的地图）。
- 布局：`flex h-dvh flex-col`；对话列 `flex-1 overflow-y-auto`，内容 `mx-auto w-full max-w-3xl px-4 py-6`（768px，替换现在的 `max-w-7xl` 双栏 grid）；所有富组件 inline 在消息流中。
- 输入区：sticky 底部 `border-t bg-white/90 backdrop-blur-md`，`<input>` 升级自适应 `<textarea>`（≤4 行），发送按钮圆形图标化；`pb-[max(0.75rem,env(safe-area-inset-bottom))]`。
- **宽屏增强（dock）**：inline 行程/地图组件右上角"展开"→ 桌面端右侧 dock 面板 `fixed inset-y-0 right-0 z-40 w-[min(560px,45vw)] border-l bg-white shadow-2xl`（对话列保持可见可输入，行程+地图联动：点行程项 → 地图 flyTo）；移动端展开 = 全屏 modal 底部滑入。dock 是 inline 组件的放大态（数据同源、用户主动唤起、可关闭），不是页面级常驻面板——不违背"组件在对话流内"的红线。若 dock 工期超预期，v1 先做全屏覆盖层，dock 移 v1.5。
- 滚动策略收敛：现在 `send()` finally 无条件 `scrollIntoView`（`ui.tsx:90`）改为"仅当用户已在底部时跟随滚动"（IntersectionObserver 哨兵或 scrollTop 判断），否则思维链展开/组件加载会拽走视口。

### 3.B 思维链组件（三段式生命周期）

**服务端（SSE 事件扩展 + 流式改造）**：

- `lib/planAgent/api.ts` 改 `stream: true`，聚合增量的同时向外回调；`CreateMessageFn` 签名扩展出 `onDelta?: (d: { reasoning?: string; content?: string }) => void`（或拆一个流式变体函数，测试用的非流式 mock 不受影响）。
- `PlanAgentEvent`（`lib/planAgent/loop.ts:8-12`）与客户端 `AgentEvent`（`ui.tsx:9-13`）**统一为共享类型**（从 loop.ts 导出，客户端 import），并新增：
  - `{ type: 'status', phase: string }` —— 每轮 LLM 调用前/每个工具执行前发（如"正在检索《吹响吧！上低音号》的点位…"，由工具名+参数生成短语）。
  - `{ type: 'tool_call', id, name, argsSummary, status: 'running' | 'done', durationMs?, resultSummary? }` —— 工具开始/结束各一帧（resultSummary 如"找到 47 个点位"）。
  - `{ type: 'reasoning', delta: string }` —— DeepSeek `reasoning_content` 流式增量（现在 `loop.ts:156` 直接丢弃；改为透传给 SSE，**落库仍然剥除**，与现有协议回放约束一致）。
- 现有 `text/plan_updated/done/error` 保留。

**客户端 UI**：

- assistant 回合顶部渲染**工作状态条**：`rounded-full border border-brand-100 bg-brand-50/60 px-3 py-1.5 text-xs`，旋转圆弧 loader（不用三点，避免与"输入中"混淆）+ 当前短语（key-change 淡入上滑 200ms 切换）+ shimmer 高光扫过动画 + 右侧 chevron。
- 点击**内联展开**（双端一致，不用 bottom sheet）：竖向时间线——reasoning 流式文本区（`max-h-40` 内滚、灰色斜体）在顶部，其下每个工具调用一张小卡（lucide 图标按工具类型区分 + 名称 + 结果摘要 + 耗时；running 转圈、done 绿勾）。移动端展开区限 `max-h-[50dvh]`。
- **完成态**折叠为一行灰字："已完成 5 步 · 用时 12s · <u>查看思考过程</u>"——保留下划线/chevron 的可回看 affordance，点击重新展开。
- 展开/收起不触发自动滚动（配合 3.A 的滚动策略）。

### 3.C 结构化交互组件（`ask_user` 工具）

**协议**：

- 新增 agent 工具 `ask_user({ kind: 'date_range' | 'single_choice' | 'multi_choice', prompt, options?: [{ id, label, sublabel?, image? }], allowSkip? })`。
- 服务端收到该工具调用：发 SSE 事件 `{ type: 'ask', askId, kind, prompt, options }`，**结束本回合**（不继续 loop，正常走 `endAgentRun` 释放互斥），并把 ask payload 落库为 `TripPlanMessage(kind='ask')` 保证刷新可恢复。
- prompt 更新：第 3 步改为"若用户没说清日期/天数，调用 ask_user(kind='date_range') 询问；需要用户在多个候选间选择时调用 ask_user 的 choice 类型，不要用纯文字罗列选项"。**agent 首轮标准动作**：确认作品后立即 ask 日期——正面满足"AI 应该首先问什么时候去"。
- 用户提交后客户端发下一条 user 消息：人类可读文本（"10月3日出发，10月6日返回，共4天"）+ 结构化 payload（`{ answerTo: askId, value }`）。**服务端优先解析结构化值直接调 `update_plan_meta` 写入 startDate/dayCount**，不让 LLM 再从自由文本里猜（同时把可读文本入历史供上下文）。
- **定格态**：已回答组件塌缩为只读摘要 chip（`rounded-full bg-brand-50 px-3 py-1 text-xs`，"📅 10月3日 – 10月6日 · 4天"）+ "修改"小按钮——点击在**对话流末尾**发起新一轮同类 ask，旧组件永久定格（对话流是只读历史）。

**日期组件**（inline 于流中，双端一致，不用原生 `<input type="date">`、不用 bottom sheet）：

- 容器 `rounded-2xl border border-brand-100 bg-white p-4 shadow-sm`；顶部 prompt + segmented control（"精确日期 / 大概时间"，`rounded-full bg-gray-100 p-0.5`）。
- 精确模式：自绘 range 日历——桌面双月 `grid grid-cols-2 gap-4`，移动单月+翻月；选中区间 `bg-brand-100`、端点 `bg-brand-600 text-white rounded-full`；底部"共 N 天"+ 确认按钮（未选全 disabled）。
- 模糊模式：月份 chips（本月/下月/未来月份名）+ 天数 stepper（`- 3 天 +`）；payload `{ monthHint, dayCount }`，startDate 留空。

**选择卡片**（作品/点位取舍）：

- 横向 snap 滚动：`flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-4 px-4`（出血到屏幕边缘）；单卡 `w-40 shrink-0 rounded-2xl border bg-white`：封面 `aspect-[3/4] object-cover`（点位场景 `aspect-video`）+ 标题 `line-clamp-1` + 副标（"47 个点位"）。
- 选中态 `ring-2 ring-brand-500` + 右上角圆形白勾；`single_choice` 点击即提交（200ms 动画后自动发送），`multi_choice` 底部确认条（"已选 2 项 · 确认"）。
- 封面缺失：`bg-gradient-to-br from-brand-100 to-pink-50` 渐变占位 + 首字符大字。

### 3.D 行程组件（对话流内，全流唯一、原地更新）

- **全流只存在一份**（key=planId）：首次 `save_plan_days` 时插入当前流位置；后续 `plan_updated` 原地刷新数据 + 顶部闪"行程已更新 · 刚刚"badge（一次 pulse 后常显灰字）。挂载点不动、不跳动、不允许多份旧版本并存（否则用户对着旧版提问）。
- 外框 `rounded-2xl border bg-white shadow-sm`；头部：标题 + meta（"3天 · 京都 · 10月3日出发"）｜右侧：**列表/地图切换 tab** + 展开按钮 + "保存到我的地图"（§3.F）。
- 天数 tab（双端统一，不做纵向全展开）：胶囊横滚，active `bg-brand-600 text-white`，标签带日期（"D1 · 10/3"）。
- 点位列表 = **竖向时间线**：每项 `flex gap-3 px-4 py-3`——序号徽标（`h-6 w-6 rounded-full bg-brand-600 text-white`，全局连续序号）+ 纵向连接线｜图片 `h-20 w-20`（桌面 `h-24 w-24`）`rounded-xl object-cover`（**消费已有但未用的 `item.point.image`**；缺图 = 渐变占位 + pin 图标）｜内容区：名称 + 时间 chip（`timeHint`）+ 乐趣/简介（`reason`/`note`，`line-clamp-2`）。
- **交通连接段**：点位之间插入连接行 `flex items-center gap-2 pl-9 text-xs text-gray-400`：方式图标（Footprints/Bus/TrainFront）+ "步行 8 分钟 · 650m"。**数据不迁移**：约定 `TripPlanItem.payload`（已是 `Json?`）承载 `{ mode, durationMin, distanceKm }`，`save_plan_days` schema 给 transit 类型 item 增加这三个结构化可选字段并在执行器写入 payload（`estimate_transit` 本就算出这些值）。
- `meal/lodging/free` 条目弱化样式（无图、灰徽标）混排同一时间线。
- 高度限制：列表区桌面 `max-h-96` 内滚，移动整组件 `max-h-[70dvh]`。

### 3.E 最终地图（行程组件内"地图"tab + 展开态）

- **接入真实路线**：`useRouteGeometry` 从 `app/(authed)/me/routebooks/[id]/hooks/` 提升为共享（`components/route/` 或 `lib/route/`）；`createRouteGeometryHandler()` 本身已通用（无 routebook 依赖），新挂路由 `app/api/me/plans/[id]/route-geometry/route.ts`（沿用 2-25 点校验 + 10/min 限流 + 10min 缓存）。
- **按天分别请求** geometry：天然规避 Mapbox 25 点上限，得到 `Record<dayIndex, geometry>` 支撑分天着色与单天聚焦，缓存键按天签名。
- inline 形态（行程组件"地图"tab 内）：`h-64`（桌面 `h-80`）`rounded-2xl`；**手势防劫持（必须）**：inline 态 `scrollZoom.disable()` + `dragPan.disable()`（移动端保留双指 `touchZoomRotate`），叠渐隐 hint"双指操作地图 · 点右上角展开"；全交互只在展开态开启。
- 分天视觉：硬编码 7 色序列（brand-600 起步 + 青/琥珀/紫等），每天一色路线；marker 天数色描边 + 全局连续序号；地图左上 day filter chips（"全部/D1/D2/D3"），选中单天时其余路线 `line-opacity` 降至 0.3（纯前端 layer 过滤，不重复请求）。
- 展开态：桌面 dock 内上地图下行程联动（点列表 → flyTo）；移动全屏 modal 同构。
- 兜底文案修正：接入真实 geometry 后，"暂未拿到真实道路路线"只在请求失败时出现，且改为可重试（"路线加载失败 · 重试"），不再是常态。
- 现状"地图只显示当天点位"（`ui.tsx:23-33` 只取 selectedDay）改为默认全部天 + filter 聚焦。

### 3.F 导出到"我的地图"（TripPlan → RouteBook）

- **唯一主入口**：行程组件 header 右侧主按钮"保存到我的地图"（dock 头部同态按钮不算第二入口）。不放地图底部（列表 tab 下不可见）、不放消息操作条（随滚动淹没）；完成消息里 AI 用文字引导一句即可。
- 按钮状态机：未保存（brand 实色）→ 保存中（spinner+disabled）→ 已保存（描边样式"已保存 · 查看我的地图"，点击跳 `/me/routebooks/[id]`）。
- 后端：新端点 `POST /api/me/plans/[id]/export-routebook`——把各天 `type='point'` 条目按 (dayIndex, sortOrder) 摊平为 `RouteBookPoint`，`zone` 写 `"Day 1"/"Day 2"`（zone 本是自由文本分组，天然承接分天），`RouteBook.metadata` 存 `{ sourcePlanId, startDate }`；**按 `metadata.sourcePlanId` 幂等**——已存在则返回已有 routebook id（再点跳转而非重复创建）。TripPlan 与 RouteBook 两套模型无外键（调研 §3.6），此转换以 metadata 软关联即可，无 schema 迁移。

### 3.G 双端差异总表

| 组件 | 桌面（≥lg） | 移动（<lg） |
|---|---|---|
| 页面骨架 | 全 immersive + 自绘顶栏 h-14；对话列 max-w-3xl 居中；输入区 sticky 底部 | 同结构；safe-area 内边距；textarea 单行收起 |
| 宽屏增强 | inline 组件 → 右侧 dock `w-[min(560px,45vw)]`，对话列保持可用 | 无 dock；展开=全屏 modal 底部滑入 |
| 思维链 | 状态条 inline；展开为内联时间线（工具卡+reasoning 流） | 同结构；展开区 max-h-[50dvh] 内滚；不用 bottom sheet |
| 日期组件 | inline；双月日历 grid-cols-2；segmented 精确/模糊 | inline；单月+翻月；模糊模式 chips+stepper；不用原生 input |
| 选择卡片 | 横向 snap 卡列 w-40；hover 态；single 点击即提交 | 同卡列出血滚动；multi 底部确认条 |
| 行程卡片 | 单份原地更新；图 h-24；列表 max-h-96 内滚；tab 切天 | 同结构；图 h-20；组件 max-h-[70dvh] |
| 地图 | 行程组件内列表/地图 tab，h-80；inline 禁滚轮/拖拽 | 同 tab 结构 h-64；inline 仅双指+hint；展开全手势 |
| 保存动作 | 行程组件 header 主按钮 + dock 头部同态 | 同位置；不做屏幕级 fixed 底栏（输入框已占底部） |

---

## 4. 实施拆分（PR 序列与模型分工）

依赖排序（① ② 可并行，③ 依赖 ②，④ 依赖 ①，⑤ ⑥ 相对独立）：

| # | PR | 内容 | 模型 |
|---|---|---|---|
| ① | nav-fix | §1 导航栏三个文件 + i18n 词条 + 页脚补"资源"链接 | k3 high（前端） |
| ② | chat-core | §3.A 骨架重构（immersive/单列流/输入区/滚动策略）+ §2.2 markdown 气泡 | k3 high |
| ③ | agent-stream | §3.B 服务端流式 + SSE 事件扩展 + 共享事件类型（后端部分）；§2.1 标题侧信道；§2.3 三层防御 | glm-5.3 max（后端） |
| ④ | thinking-ui | §3.B 客户端思维链组件（依赖③的事件） | k3 high |
| ⑤ | ask-user | §3.C 工具协议+落库+服务端解析（后端）→ 日期/选择组件（前端） | glm-5.3 max → k3 high 串行 |
| ⑥ | itinerary-map | §3.D 行程组件 + §3.E 地图接入（route-geometry 挂载/按天请求为后端小改）+ §3.F 导出端点（后端）+ 前端组件 | glm-5.3 max → k3 high 串行 |

每个 PR 交付后跑：`vitest`（现有 repo/loop 测试不回归）+ `tsc` + `npm run cf:build`，UI 项用 `wrangler versions upload` 出预览版本供人工验收。

## 5. 验收清单（对照冒烟问题逐条销项)

1. 双端导航 = 计划|地图|热门攻略|热门城市|社群 + 语言 + 账号；账号下拉含 我的主页/收藏/我的地图/巡礼计划/投稿/设置/退出。
2. 新计划第一条消息发出后 ≤ 数秒顶栏出现生成标题；assistant 回复的 `**加粗**`、列表正确渲染；故意让 LLM 传短 id 时 cluster 返回明确 missing 报错并能自纠。
3. /plan 无站点 header/footer，单列 chat 流；行程/地图/日期/选择组件全部 inline；桌面展开出 dock、移动展开全屏。
4. AI 回合有动态状态条，可展开看 reasoning 流+工具时间线，完成后可回看。
5. 首轮确认作品后 AI 弹日期组件；选择场景出选择卡片；已答组件定格。
6. 行程组件含图片/序号/名称/时间/描述/交通连接段；AI 修改后原地更新。
7. 地图 tab 显示全部天点位+分天着色真实道路路线，无"未拿到真实道路路线"常态提示；inline 不劫持滚动。
8. "保存到我的地图"幂等导出，`/me/routebooks` 出现分 Day 分组的新地图。
