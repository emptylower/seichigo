# /plan 冒烟测试问题 —— 现状调研（不含方案）

> 本文档只收集"现状事实"（文件路径、代码原文、行号、spec 原文），**不提出任何修复方案**。供后续用更高级模型设计解决方案时作为输入素材。
>
> 调研范围：`/Users/mac/Desktop/seichigo`（main，无 /plan 功能）与 `/Users/mac/Desktop/seichigo-worktrees/plan-agent-m1`（分支 `feat/plan-agent-m1`，本次冒烟测试的对象）。**main checkout 完全没有 `app/(authed)/plan` 目录**，以下所有发现均来自 worktree。

---

## 用户原始验收报告（逐字保留）

> 冒烟测试完毕，问题很多：
> 1 当前导航栏不符合spec，当前为：
> 计划 | 地图 | 热门攻略 | 热门城市 | 我的（错误；需删除；账号处就是我的，底下有二级菜单）| 资源（错误；需删除）| 投稿（错误；放置到我的二级下拉菜单中）| 社群（正确；spec没提，但保留）  语言（正确，保留） 账号（部分错误，需要合并一些内容进二级下拉菜单）
> 2 重点实测plan页面，功能错误：
> 对话标题生成过慢，在1轮对话后第二次提问后才生成，应该在第一次提问后生成；
> 回复出现大量的**，说明对话框对回复富文本格式不支持
> 在调取点位信息时出现了一次工具调用失败，关键原文"cluster返回空了，应该是点位id需要带作品前缀，我重新用完整id调用"
> 3 重灾区！交互和面板设计
> 3.1 整体布局大问题，当前计划页的整体布局从上到下是对话卡片->预览路线卡片；两个大卡片把整体功能给割裂了，要采用整个页面的对话布局，模仿当今成熟的chat页面布局，路线渲染卡片是对话中会生成的组件，而不是独立卡片；整个页面不需要卡片布局，卡片应该是组件；
> 3.2 ai回答过程要有简短思维链展示ai当前的工作状态，这个思维链有动画效果，是动态的，默认只展示一个简短的短语，然后用户感兴趣可以手动点击展开思考过程的流式输出，中间会展示ai调用的参考资料
> 3.3 对话组件未生成，全程都是ai出文字，用户在使用过程中，ai应该首先问什么时候去，然后弹出一个日期组件，用户可以选择精确的去和返回的时间，或者组件切换页面选择模糊日期；这个行为会决定后续的提问和回答；
> 给用户选择的时候，应该给选择卡片，不是干瘪瘪的文字
> 最终给用户展示的点位应该是组件卡片，这个卡片上中有点位图片 当天的游览序号 点位名称 游览时间 简单描述（乐趣/简介）去往这个点位的交通方式；
> 3.4 最终地图渲染，在计划形成完成后，会有包含所有游览点位和他们之间的路线的地图渲染，这个地图渲染当前压根没实现；当前报错：'未拿到真实道路路线...' 页面也是灰的
> 4 该页面不需要页脚，ai对话的结果（交付地图）会录入进用户的我的地图中

---

## 1. 导航栏（当前实现 vs spec）

### 1.1 两个不同的导航栏组件

- **桌面导航**：`components/layout/HeaderPublic.tsx`（经 `SiteShellPublic` 渲染，作用于 `app/(authed)` 等布局）
- **移动端抽屉**：`components/layout/HeaderMobileDrawer.client.tsx`

**关键发现：用户实测报告的 10 项（计划|地图|热门攻略|热门城市|我的|资源|投稿|社群|语言|账号）实际对应的是移动端抽屉菜单，不是桌面导航。**

### 1.2 桌面导航当前代码

`HeaderPublic.tsx:44-49`（worktree `feat/plan-agent-m1`）：
```tsx
<Link href={prefixPath('/plan', locale)}>{t('header.plan', locale)}</Link>
<Link href={prefixPath('/map', locale)}>{t('header.map', locale)}</Link>
<Link href={prefixPath('/', locale)}>{t('header.posts', locale)}</Link>
<Link href={prefixPath('/city', locale)}>{t('header.city', locale)}</Link>
<Link href={prefixPath('/me', locale)}>{t('header.me', locale)}</Link>
<CommunityMenu locale={locale} />
```
i18n 标签（`lib/i18n/locales/zh.json:3-11`）：
```
posts: "热门攻略", map: "地图", city: "热门城市", plan: "计划",
me: "我的", resources: "资源", submit: "投稿", community: "社群"
```
→ 桌面导航实际顺序：**计划 | 地图 | 热门攻略 | 热门城市 | 我的 | 社群** + 语言 + 头像（无文字"账号"标签）。
`resources`/`submit` 的 i18n 词条存在，但**没有**被接入桌面 `<nav>` 数组。

对比 `main` 分支（无 IA 改造）的 `HeaderPublic.tsx:43-49`：`/`(文章) → `/map`(地图) → `/anime`(作品) → `/city`(城市) → `/resources`(资源) → `/submit`(投稿) → 社群下拉，无 `/plan`、无 `/me` 顶级项。

### 1.3 移动端抽屉当前代码

`HeaderMobileDrawer.client.tsx:73-83` 的 `navItems`：包含 7 项 `/plan, /map, /, /city, /me, /resources, /submit`，另有独立的语言/账号区块 —— 这与用户报告的 10 项列表完全对应。

### 1.4 spec 原文（`docs/superpowers/specs/2026-08-31-plan-agent-ia-redesign-design.md`）

第 33-47 行：
```
现有导航语义不准："文章"实为巡礼攻略，"作品/城市"实为两种索引维度。目标导航：

计划 | 地图 | 热门攻略 | 热门城市 | 我的

| 导航项 | 路由 | 改造内容 |
| 计划 | `/plan`（新） | 计划 agent 主界面 + 我的计划列表，见 §3 |
| 地图 | `/map` | 不动。定位：云旅游/点位数据库 |
| 热门攻略 | `/posts` | 文章列表默认按热门排序；... |
| 热门城市 | `/city` | 页面不动，导航文案改为"热门城市"。... |
| 我的 | `/me` | 聚合：点位收藏、攻略订阅...、足迹/我的计划（含存量 RouteBook 入口） |

导航中移除"资源""投稿"的一级位置（收入页脚或"我的"下），减少一级项，突出计划。`resources`、`submit` 路由本身保留。
```
第 165 行（补充）：
```
"热门攻略"导航 v1 指向 `/`（首页即攻略列表...）；独立 `/posts` 索引页与页内"按作品切换视图"移入 M2。
```
→ 确认 `posts` 标签指向 `/` 是符合 spec 的（v1 阶段）；`/resources`、`/submit` 不应是一级导航项。

### 1.5 账号（Account）下拉菜单

`components/layout/HeaderAuthControls.client.tsx`（main / worktree 相同）。桌面 `layout='inline'` 变体（176-219 行）：触发器仅头像（无"账号"文字），下拉内容：
- 管理员面板（仅 admin 可见）
- 用户中心（`/me/settings`，硬编码标签，非 i18n）
- 我的收藏（`/me/favorites`）
- 我的地图（`/me/routebooks`，硬编码标签）
- 退出（`/api/auth/signout`）

**两个分支的下拉菜单中都没有"投稿"链接。** `accountLabelByLocale` 的 `'账号'`（`HeaderMobileDrawer.client.tsx:58`）只是移动端抽屉的分区标题文字，不是桌面菜单项。

### 1.6 现有"我的"页面

- `main`：无 `app/(authed)/me/page.tsx` 聚合首页，只有独立的 `/me/favorites`、`/me/routebooks`（+`[id]`）、`/me/settings`。
- worktree：新增 `app/(authed)/me/page.tsx`，`SECTIONS` 静态列表链向：`/plan`（我的巡礼计划）、`/me/favorites`（我的收藏）、`/me/routebooks`（个人地图）、`/submit`（投稿）、`/me/settings`（设置/账号）。同时新增 `app/(authed)/plan/page.tsx`、`app/(authed)/plan/[id]/page.tsx`。

---

## 2. Plan 页对话功能三个 bug 的根因定位

### 2.1 Bug：标题要两轮对话后才生成

代码里**没有**任何显式的"第 N 轮生成标题"判断逻辑——标题生成完全由 LLM 按 system prompt 里的步骤顺序驱动，属于涌现行为。

`lib/planAgent/prompt.ts:3-9`：
```
## 工作流程（严格遵守）
1. 确定作品：先用 search_anime 在站内搜；...
2. 用 list_points 拉取该作品的真实点位。...
3. 若用户没说清天数或日期，先用一句话问清（一次只问一个问题）。
4. 用 cluster_points 做按天分组和顺路排序，以它的结果为准安排每天的点位顺序。
5. 用 update_plan_meta 写入标题、天数、出发日期和作品 id；用 save_plan_days 保存每日行程。规划结果必须落到这两个工具里，只写在聊天文字里等于没做。
```
第 5 步（`update_plan_meta`，携带 `title`）排在第 3 步之后，而第 3 步要求"用户没说清天数/日期时先停下来问一句"——第一轮回复消耗在提问上，用户回答是第二轮，第 4/5 步（含标题写入）要到第三轮模型调用才会跑到。

`lib/planAgent/tools.ts:169-186`，`update_plan_meta` 处理逻辑，是唯一设置 `patch.title` 的地方：
```ts
case 'update_plan_meta': {
  const patch: Parameters<TripPlanRepo['updateMeta']>[1] = {}
  if (typeof args.title === 'string' && args.title.trim()) patch.title = args.title.trim().slice(0, 80)
  ...
  await deps.repo.updateMeta(deps.planId, patch)
```
计划创建时的默认标题（`lib/tripPlan/handlers/plans.ts:39`）：`let title = '未命名巡礼计划'`。代码层面没有任何机制强制第一轮回复就生成标题，纯粹是 prompt 步骤顺序 + "先问清楚"要求的副作用。

### 2.2 Bug：回复里出现字面 `**`，未渲染 markdown

`app/(authed)/plan/[id]/ui.tsx:104-115`：
```tsx
{chat.map((entry, idx) => (
  <div
    key={idx}
    className={
      entry.role === 'user'
        ? 'ml-auto max-w-[85%] rounded-2xl bg-brand-50 px-4 py-2 text-sm text-gray-900'
        : 'max-w-[92%] whitespace-pre-wrap rounded-2xl bg-gray-50 px-4 py-2 text-sm text-gray-800'
    }
  >
    {entry.text}
  </div>
))}
```
`entry.text`（SSE `text` 事件内容，在 `ui.tsx:80` 追加）直接作为原始 React 文本插值，配合 `whitespace-pre-wrap`，未经任何 markdown 解析器处理。该文件及 `app/(authed)/plan` 目录下均无 `react-markdown`/`marked`/`remark` 引入。

仓库里其实已有 markdown 处理管线：`lib/comment/markdown.ts`（用 `marked` + `sanitize-html`），但**未被 plan 聊天 UI 使用**——确认这是"设计上就是纯文本气泡"，不是遗漏引入导致的偶发问题。

### 2.3 Bug：`cluster_points` 因点位 ID 缺前缀返回空

点位 ID 存储时带作品（bangumi）ID 前缀：

`lib/anitabi/source/normalize.ts:138-140`：
```ts
function scopedPointId(bangumiId: number, rawPointId: string): string {
  return `${bangumiId}:${rawPointId}`
}
```
用于 `normalize.ts:241`：`id: scopedPointId(bangumiId, rawId)`——这是持久化到 `AnitabiPoint.id` 的值（`prisma/schema.prisma:692`，`id String @id`）。

`list_points` 正确地原样返回这个带前缀的完整 ID：`lib/planAgent/pointsPrisma.ts:36-43`（`id: r.id`）。但**工具 schema 的 description 完全没有告知 LLM 这个 ID 是一个必须原样回传的 `"<bangumiId>:<rawId>"` 不透明 token**：

- `lib/planAgent/tools.ts:59`：`pointIds: { type: 'array', items: { type: 'string' }, description: '要安排的点位 id 列表' }`
- `lib/planAgent/tools.ts:20`：`pointId: { type: 'string', description: 'type=point 时必填，来自 list_points 的点位 id' }`

当工具调用参数里的 ID 与存储字符串不完全一致时，查找**静默失败**（不是报错拒绝）：

`tools.ts:141-150`（`cluster_points`）：`const coords = await deps.points.getPointsByIds(pointIds)` → `pointsPrisma.ts:46-52`：`where: { id: { in: ids } }`——精确匹配的 Prisma `in` 过滤，无 fallback 匹配逻辑。若 `ids` 缺少 `bangumiId:` 前缀，`coords` 直接返回空数组（非报错）。

空的 `coords` 传入 `clusterIntoDays`：`lib/planAgent/cluster.ts:37`：`if (!points.length || dayCount < 1) return []`——这正是用户观察到的"cluster返回空了"现象的产生路径，且**没有区分性的错误信息供 LLM 自我诊断**（用户记录里 LLM 是靠试错才发现要用完整 ID 重新调用的）。

---

## 3. Plan 页整体布局 / 交互 / 面板设计现状

### 3.1 整体布局现状

**服务端组件** `app/(authed)/plan/[id]/page.tsx:1-20`：拉取 plan + 消息历史，渲染单个客户端组件 `PlanPlanner`。

**客户端组件** `app/(authed)/plan/[id]/ui.tsx`（`'use client'`），顶层 JSX（94-147 行）：
```tsx
<div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(320px,2fr)_3fr]">
  <section className="flex h-[70vh] flex-col rounded-2xl border border-gray-200 bg-white">
    {/* 对话卡片：标题 header + 可滚动消息列表 + 输入表单 */}
  </section>

  <section className="space-y-4">
    <RoutePreviewMap points={mapPoints} routeGeometry={null} className="h-64 w-full rounded-2xl" />
    <DayCards plan={plan} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
  </section>
</div>
```
这是一个 CSS grid，列拆分 (`lg:grid-cols-[minmax(320px,2fr)_3fr]`) 仅在 `lg` 断点及以上生效；`lg` 以下无显式列数，默认单列——两个 `<section>` 纵向堆叠：对话卡片（固定 `h-[70vh]`、白底带边框）在上，地图（固定 `h-64`）+ `DayCards` 在下。这与用户报告的"对话卡片->预览路线卡片两个大卡片割裂"完全对应——DOM 上就是两个平级的 `<section>`，不存在任何"路线/行程作为消息流内组件渲染"的机制；`DayCards` 与 `RoutePreviewMap` 完全在对话 `<section>` 之外。

对话消息渲染（104-115 行）：每条消息是一个按角色着色的 `<div>`（用户气泡右对齐 `bg-brand-50`，AI 气泡左对齐 `bg-gray-50`），纯文本 `{entry.text}`。

### 3.2 思维链 / 工作状态展示现状

**完全没有**展示 AI 中间思考、工具调用活动、进行中状态的 UI，只有一个静态忙碌文案。

- `AgentEvent` 类型（`ui.tsx:9-13`）只有四种：`'text' | 'plan_updated' | 'done' | 'error'`，没有 `'thinking'`/`'tool_call'`/`'reasoning'`。
- 等待期间唯一提示：`ui.tsx:116`：`{busy ? <p className="text-xs text-gray-400">规划师思考中…</p> : null}`——纯静态文本，不可展开，不显示当前在跑哪个工具。
- SSE 消费逻辑在 `ui.tsx` 的 `send()`（42-92 行）：`fetch` 到 `POST /api/me/plans/{id}/agent`，`res.body.getReader()` 逐块解析 `data: {...}` 帧，按 `event.type` 分支处理（`'text'`→追加气泡；`'plan_updated'`→重新拉取 plan；`'error'`→追加错误气泡）。`'done'`/`'ready'` 收到但不产生任何 UI 变化。
- 服务端 `lib/planAgent/loop.ts:150-166`：模型调用 `deps.createMessage(...)` **不是 token 级流式**——是单次非流式 `chat.completions.create`（见 `lib/planAgent/api.ts:19-29`，无 `stream: true`）。循环每个完整 LLM 轮次只发一个 `{type:'text'}` 事件（`loop.ts:152-154`），工具调用（168-180 行）在服务端静默执行，**不发任何事件**给客户端——客户端完全不知道有工具运行过，更不知道是哪个工具、参数/结果是什么。
- 代码注释明确说明推理内容被丢弃：`loop.ts:156`：`// DeepSeek 推理模型响应带 reasoning_content，回传历史与落库前只保留协议字段`——紧接着构造的 `assistantParam`（157-161 行）只保留 `content` 和 `tool_calls`，丢弃了模型可能返回的 `reasoning_content` 字段。即使底层 DeepSeek 模型暴露了推理 token，这段代码也会在到达客户端之前就去掉它。
- 相关文件：客户端 `app/(authed)/plan/[id]/ui.tsx`；服务端 SSE 端点 `app/api/me/plans/[id]/agent/route.ts`（`send()` 辅助函数 60-66 行写 `data: ${JSON.stringify(event)}\n\n`）；agent 循环/事件源 `lib/planAgent/loop.ts`（`PlanAgentEvent` 类型 8-12 行，与客户端本地 `AgentEvent` 类型结构完全相同，但是两个独立定义、非共享 import 的类型）。

### 3.3 日期/偏好选择 UI 与当前工具 schema

**没有任何结构化 UI 组件**（日期选择器、选择卡片、按钮）。根据 system prompt `lib/planAgent/prompt.ts:6`，模型被要求用纯聊天文本提问：`若用户没说清天数或日期，先用一句话问清（一次只问一个问题）`。用户的回答就是打字回到同一个自由文本 `<input>`。目前没有任何工具能让 agent 向用户渲染 UI 元素（没有"present_choices"/"ask_user_structured"之类的工具），客户端代码也不会为 assistant 消息渲染除文本气泡外的任何内容。

当前完整工具列表，定义于 `lib/planAgent/tools.ts:37-101`（`PLAN_AGENT_TOOLS`，OpenAI function-tool 格式）：

1. **`search_anime`**（38-42 行）—— `{ query: string }`（必填）。站内点位库按作品标题搜索。
2. **`search_bangumi_tv`**（43-47 行）—— `{ keyword: string }`（必填）。站内搜索失败时回退到 bgm.tv，返回候选及 `hasPoints`。
3. **`list_points`**（48-55 行）—— `{ bangumiId: number（必填）, limit?: number }`。列出某作品全部已地理编码的巡礼点位。
4. **`cluster_points`**（56-63 行）—— `{ pointIds: string[]（必填）, dayCount: number（必填） }`。确定性地理聚类分天（委托给 `lib/planAgent/cluster.ts` 的 `clusterIntoDays`）。
5. **`estimate_transit`**（64-71 行）—— `{ fromPointId: string（必填）, toPointId: string（必填） }`。本地启发式：≤1.5km 判定步行，否则判定公交；**不调用任何外部路由 API**（见 `executePlanTool` 里 `estimate_transit` 分支，`tools.ts:151-163`）。
6. **`read_plan`**（72 行）—— `{}`。返回完整 plan 视图。
7. **`update_plan_meta`**（73-81 行）—— `{ title?: string, dayCount?: number, startDate?: string（ISO，空字符串表示清除）, bangumiIds?: number[] }`。全部可选，是唯一写入 `startDate`/天数的地方，完全由 LLM 从聊天文本中提炼出的自由格式工具调用参数驱动——没有任何客户端日期选择器为它供数。
8. **`save_plan_days`**（82-100 行）—— `{ days: [{ dayIndex: number, citySlug?: string, summary?: string, items: [{ type, pointId?, title, timeHint?, note?, reason? }] }] }`。行程内容的唯一写入路径；每个 item 的 `type` 取自 `TRIP_PLAN_ITEM_TYPES`（`point | transit | meal | lodging | attraction | free`，定义于 `lib/tripPlan/repo.ts`）。

没有"展示日期选项"或"把点位选择渲染成可点击卡片"之类的工具——所有此类交互目前预期都是 LLM 用纯中文文本在聊天流里询问，用户用同一个自由文本框回答。

### 3.4 点位/行程卡片渲染现状

组件：`app/(authed)/plan/[id]/components/DayCards.tsx`。

- 天数切换：按 `plan.days` 生成的胶囊按钮，标签为 `Day ${dayIndex}`（34-47 行）。
- 当天摘要：若存在则渲染 `active.summary` 的纯 `<p>`（50 行）。
- 条目列表：`<ol>` 包裹的 `<li>` 卡片（52-66 行）。每个条目只展示：
  - 硬编码的类型徽标映射 `TYPE_LABELS`（`point: '点位', transit: '交通', meal: '用餐', lodging: '住宿', attraction: '景点', free: '自由'`，5-12 行）
  - `item.timeHint`（若存在，灰色小字）
  - `item.title`（加粗）
  - `item.note`（可选，灰色小字段落）
  - `item.reason`（可选，品牌色小字段落）
- **完全不渲染图片。** 注意：底层数据类型 `TripPlanItemView`（`lib/tripPlan/view.ts:4-15`）**确实携带** `point.image: string | null`（在 `toPlanView` 中从 `AnitabiPoint` 填充，`view.ts:51-74`），但 `DayCards.tsx` 从未读取 `item.point.image` 或 `item.point`——每个条目上挂载的点位经纬度/名称/图片数据在这个组件里完全未使用（只在 `ui.tsx` 的 `mapPoints` memo 里被间接消费，供地图使用，23-33 行）。
- 除自由文本 `timeHint` 字符串外，没有独立的"游览时间"字段（没有起止时间选择器）。
- 没有交通专属渲染（如按方式区分图标、时长/距离展示）——`transit` 类型条目走和其他类型完全相同的通用 `<li>` 模板，仅徽标文字是"交通"；`estimate_transit` 工具算出的 `distanceKm`/`mode`/`durationMin` 只能被 LLM 写进自由文本 `note`/`title`（`TripPlanItemView`/`TripPlanItem` schema 里没有结构化的 transit 字段）。

### 3.5 最终地图渲染与"未拿到真实道路路线"报错

**报错文案位置**：`components/route/RoutePreviewMap.tsx:455`
```tsx
const hint = previewData.hasFallback
  ? previewData.hasLongJump
    ? '路线跨度较大，当前为分段示意线，请缩放查看各段。'
    : '暂未拿到真实道路路线，当前为站点直连示意。'
  : hasWideSpread
    ? '路线跨度较大，可缩放查看各段细节。'
    : null
```
渲染为地图右下角的非阻塞浮动提示条（471-475 行），不是硬报错/空白态，但确实是用户可见、说明"没拿到真实道路路线"的文案。

**触发条件**：`buildPreviewData()`（118-182 行）在**没有**可用 `routeGeometry`（即 `routeGeometry` 为 `null` 或坐标数 `< 2`，122 行条件不成立）时被调用——该分支会画连续点位间的"示意直线"而非真实路线，`hasFallback = lineFeatures.length > 0`（179 行）。

**plan 页的具体根因**：`app/(authed)/plan/[id]/ui.tsx:143` 调用 `<RoutePreviewMap points={mapPoints} routeGeometry={null} className="h-64 w-full rounded-2xl" />`——`routeGeometry` 是**硬编码字面量 `null`**，plan 页/agent 代码里任何地方都没有获取或计算它。`lib/planAgent/*` 与 `app/(authed)/plan/*` 里没有任何 Mapbox/路由相关引用。→ 只要一个 plan 有 ≥2 个点位，这个 fallback 提示就必然出现，是设计上的必然结果（是这个页面唯一的代码路径），不是偶发 bug。

另外：`mapPoints`（`ui.tsx:23-33`）只从当前 `selectedDay` 对应的 items 派生（`plan.days.find(d => d.dayIndex === selectedDay)`），即地图任何时候只显示"当天"的点位，不是"全部行程点位"；进一步按 `item.point && item.point.lat != null && item.point.lng != null` 过滤，未被地理编码的点位会被静默丢弃，不会有任何错误提示。

**可参考的已工作实现**（routebooks，已确认功能正常，使用真实道路路由）：
- 页面：`app/(authed)/me/routebooks/[id]/page.tsx` 与 `.../ui.tsx`
- 地图容器：`app/(authed)/me/routebooks/[id]/components/PlannerMapStage.tsx`——渲染同一个共享的 `<RoutePreviewMap>`，但传入了真实的 `routeGeometry`（75 行），来源于自定义 hook。
- Hook：`app/(authed)/me/routebooks/[id]/hooks/useRouteGeometry.ts`——点位集变化时 800ms 防抖，按坐标签名缓存，调用 `GET /api/me/routebooks/{id}/route-geometry?points=lng,lat|lng,lat&mode=walking`。
- API handler：`lib/routeBook/handlers/routeGeometry.ts`（`createRouteGeometryHandler`）——校验点位数（2-25），按用户限流（10/min），服务端缓存 10 分钟，调用 **Mapbox Directions API**（`https://api.mapbox.com/directions/v5/mapbox/{walking|driving}/{coords}?geometries=geojson&overview=full&access_token=...`），使用 `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` 或 `MAPBOX_DIRECTIONS_TOKEN` 环境变量（163-176 行），成功时返回 `{ ok: true, geometry: GeoJSON.LineString, distance, duration, mode }`。这个端点/hook 与 /plan 页完全没有接入关系。
- 两者共用的底层地图组件：`components/route/RoutePreviewMap.tsx`（同一份文件，没有 plan 专属 vs routebook 专属的变体——区别纯粹在于调用方是否传入真实 `routeGeometry` 还是 `null`）。

### 3.6 页脚 与 Routebook/"我的地图" 数据模型

**页脚组件**：`components/layout/Footer.tsx`（默认导出 `Footer`，接受 `{ locale }`）。

引入路径：`/plan/[id]` 由 `app/(authed)/layout.tsx` 提供，统一包裹进 `<SiteShellPublic>`（`components/layout/SiteShellPublic.tsx:10-20`）：
```tsx
<div className="site-shell-public min-h-dvh flex flex-col">
  <HeaderPublic locale={locale} />
  <main className="site-shell-public__main ...">{children}</main>
  <Footer locale={locale} />
</div>
```
header/footer 对所有 authed 页面（含 `/plan/[id]`）无条件渲染——`ui.tsx` 顶层 `<div>` 没有携带退出这一渲染所需的 `data-layout-wide`/`data-layout-immersive` 属性。

**已有的排除机制**（已在别处使用，/plan 未使用）：`styles/globals.css:28-44`：
```css
.site-shell-public:has([data-layout-immersive='true']) > header,
.site-shell-public:has([data-layout-immersive='true']) > footer {
  display: none;
}
.site-shell-public:has([data-layout-immersive='true']) > .site-shell-public__main {
  max-width: none; margin: 0; padding: 0;
}
```
纯 CSS `:has()` 选择器，依据后代元素上的 `data-layout-immersive="true"` 属性驱动。目前被 routebooks 详情页使用——`app/(authed)/me/routebooks/[id]/page.tsx:26` 与 `.../ui.tsx:22,203` 都在最外层 wrapper 设置了 `data-layout-wide="true" data-layout-immersive="true"`，从而隐藏 header+footer、`main` 全出血。`app/(authed)/plan/[id]/ui.tsx` 两个属性都没设置，所以 `/plan` 始终显示常规 header + footer + 居中 `max-w-5xl` 的 main（尽管 plan 页自己的 grid 内部进一步限制为 `max-w-7xl`）。

**Routebook / "我的地图" 数据模型**（Prisma，`prisma/schema.prisma`）：
```prisma
model RouteBook {
  id        String           @id @default(cuid())
  userId    String
  title     String
  status    String
  metadata  Json?
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt
  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  points    RouteBookPoint[]
  @@index([userId])
  @@index([status])
}
model RouteBookPoint {
  id          String       @id @default(cuid())
  routeBookId String
  pointId     String
  sortOrder   Int
  zone        String
  createdAt   DateTime     @default(now())
  routeBook   RouteBook    @relation(fields: [routeBookId], references: [id], onDelete: Cascade)
  point       AnitabiPoint @relation(fields: [pointId], references: [id], onDelete: Cascade)
  @@index([routeBookId])
  @@index([pointId])
  @@index([zone])
}
```
`RouteBook.points` 是按 `sortOrder` 排序、按自由文本 `zone` 分组的扁平 `AnitabiPoint` 引用列表，附带 JSON `metadata` 和 `status` 字符串（`pending/in_progress/completed` 风格状态，见 `PlannerMapStage.tsx` 引用的 `RouteBookStatus` 类型）。"我的地图" UI 位于 `/me/routebooks`（列表：`app/(authed)/me/routebooks/page.tsx`，标题 `'我的地图'`；详情：`app/(authed)/me/routebooks/[id]/`），导航入口：`components/me/MeSectionShell.tsx:19`：`{ key: 'routebooks', label: '我的地图', hint: '管理巡礼路线', href: '/me/routebooks', icon: Map }`。

**TripPlan 模型**（/plan 功能自己的存储，`prisma/schema.prisma:977-1038`）：
```prisma
model TripPlan {
  id             String            @id @default(cuid())
  userId         String
  title          String
  status         String            @default("draft")
  startDate      DateTime?
  dayCount       Int               @default(1)
  bangumiIds     Int[]             @default([])
  preferences    Json?
  agentBusyUntil DateTime?
  agentRunToken  String?
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
  user           User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  days           TripPlanDay[]
  messages       TripPlanMessage[]
  @@index([userId])
  @@index([status])
}
model TripPlanDay {
  id       String         @id @default(cuid())
  planId   String
  dayIndex Int
  date     DateTime?
  citySlug String?
  summary  String?
  plan     TripPlan       @relation(fields: [planId], references: [id], onDelete: Cascade)
  items    TripPlanItem[]
  @@unique([planId, dayIndex])
}
model TripPlanItem {
  id        String        @id @default(cuid())
  dayId     String
  sortOrder Int
  type      String
  pointId   String?
  timeHint  String?
  title     String
  note      String?
  reason    String?
  payload   Json?
  day       TripPlanDay   @relation(fields: [dayId], references: [id], onDelete: Cascade)
  point     AnitabiPoint? @relation(fields: [pointId], references: [id], onDelete: SetNull)
  @@index([dayId])
  @@index([pointId])
}
model TripPlanMessage {
  id        String   @id @default(cuid())
  planId    String
  kind      String
  content   Json
  createdAt DateTime @default(now())
  plan      TripPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  @@index([planId, createdAt])
}
```

**"计划生成的地图导入我的地图"相关的关键事实**：`TripPlan`/`TripPlanDay`/`TripPlanItem` 与 `RouteBook`/`RouteBookPoint` 是**两个完全独立、互不关联的 Prisma 模型族**——`prisma/schema.prisma` 里没有任何外键、join 表或其他关系连接 `TripPlan` 与 `RouteBook`。两者各自独立引用 `AnitabiPoint`（分别通过 `TripPlanItem.pointId` 和 `RouteBookPoint.pointId`），但目前没有任何机制把一个 `TripPlan` 的天数/点位关联到某个 `RouteBook` 记录。

---

## 附：相关文件索引（本次调研涉及的全部文件路径）

**导航相关**
- `components/layout/HeaderPublic.tsx`
- `components/layout/HeaderMobileDrawer.client.tsx`
- `components/layout/HeaderAuthControls.client.tsx`
- `lib/i18n/locales/zh.json`
- `app/(authed)/me/page.tsx`
- `components/me/MeSectionShell.tsx`
- `docs/superpowers/specs/2026-08-31-plan-agent-ia-redesign-design.md`

**Plan 页对话/agent**
- `app/(authed)/plan/[id]/page.tsx`
- `app/(authed)/plan/[id]/ui.tsx`
- `app/(authed)/plan/[id]/components/DayCards.tsx`
- `app/api/me/plans/[id]/agent/route.ts`
- `lib/planAgent/loop.ts`
- `lib/planAgent/prompt.ts`
- `lib/planAgent/tools.ts`
- `lib/planAgent/pointsPrisma.ts`
- `lib/planAgent/cluster.ts`
- `lib/planAgent/api.ts`
- `lib/tripPlan/handlers/plans.ts`
- `lib/tripPlan/view.ts`
- `lib/tripPlan/repo.ts`
- `lib/anitabi/source/normalize.ts`
- `lib/comment/markdown.ts`（现有但未接入 plan 聊天的 markdown 管线，供参考）

**地图/路由**
- `components/route/RoutePreviewMap.tsx`
- `app/(authed)/me/routebooks/[id]/page.tsx`
- `app/(authed)/me/routebooks/[id]/ui.tsx`
- `app/(authed)/me/routebooks/[id]/components/PlannerMapStage.tsx`
- `app/(authed)/me/routebooks/[id]/hooks/useRouteGeometry.ts`
- `lib/routeBook/handlers/routeGeometry.ts`

**布局/页脚**
- `components/layout/SiteShellPublic.tsx`
- `components/layout/Footer.tsx`
- `styles/globals.css`（`data-layout-immersive` 机制）

**数据模型**
- `prisma/schema.prisma`（`TripPlan`/`TripPlanDay`/`TripPlanItem`/`TripPlanMessage`、`RouteBook`/`RouteBookPoint`）
