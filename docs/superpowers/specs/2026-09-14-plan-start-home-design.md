# /plan/start 新对话首页（设计）

日期：2026-09-14　状态：已由负责人逐节确认　前置：`docs/superpowers/plans/2026-09-14-sitelinks-joint-plan.md`（同日上线，本稿不得回退其任何约束）

## 目标

把 /plan/start 从"欢迎气泡 + 输入框"的过渡页，改成规划师的**新对话首页**：与 /plan/[id] 对话页同一外壳，主区是居中的大标题、输入框和四条建议行，侧栏承载最近对话。参考 Codex / ChatGPT 的初始屏。三语（zh/en/ja）完整适配。

## 已确认的决定

| 议题 | 决定 |
|---|---|
| 整体布局 | A：复用对话页外壳（侧栏 + 主区），不是无侧栏落地页 |
| 主区排布 | A1：输入框居中，建议行在输入框下方 |
| 建议形态 | 一行一句，行首 emoji，不是大卡片；点击填入输入框并聚焦，不直接发送 |
| 建议来源 | 固定文案，三语各写一套，放 i18n 字典 |
| 最近对话 | 只在侧栏，登录后显示；主区不放 |
| 新对话行为 | 侧栏「新对话」与 /plan 索引一律去当前语言的 /plan/start；发第一句才创建计划 |

## 第 1 节：页面外壳与三种状态

- 三语起始页改用与 /plan/[id] 相同骨架：左侧 `PlanSidebar`，右侧主区，整页 `h-dvh`，沿用 `data-layout-wide` / `data-layout-immersive` 隐藏站点页头页脚。进入对话后只有主区变化，侧栏不重绘。
- 登录用户：侧栏与对话页一致，「新对话」项选中态，下方最近计划列表（服务端 `listPlans` 随页面给出），底部保留用量/账户区。
- 游客：侧栏骨架相同，列表区换成提示「登录后这里会显示你的最近对话」+ 登录按钮（打开现有 `LoginModal`）；「新对话」与站点入口照常显示。
- 手机端：与对话页一致，侧栏收进左上角抽屉按钮，主区单列，建议行四行竖排。
- 保持不变：三语 URL、canonical、hreflang、`?locale=` 307 兼容、`?draft=` 预填、发送时才登录、发送成功后把首条消息写入 sessionStorage 再跳 /plan/[id]。

## 第 2 节：主区内容

主区为垂直居中的窄列（最大宽度与对话页聊天列一致，`max-w-3xl`），自上而下：

1. **入口名 H1（视觉很小）**：`pages.planStart.title`（AI 规划 / AI Planner / AIプランナー），主区左上角，13px 灰色。全页唯一 H1，满足 sitelinks 方案"入口页 H1 = 入口名"的约束。
2. **大标题 h2**：`pages.planStart.headline`：「这次想去哪里巡礼？」「Where are we going this time?」「今回はどこへ巡礼しますか？」，22–26px 居中。
3. **副标题 p**：复用 `pages.planStart.intro`。
4. **输入框**：复用对话页 `PlanComposer`（同组件、同 placeholder 逻辑、同输入法回车处理）。发送逻辑沿用起始页现有实现（建计划 + 交接草稿 + 跳转）。`answering=false`、`stopRequested=false`、`onStop` 空函数、`budgetNotice=null`。
5. **四条建议行**：紧贴输入框下方；结构 `emoji + 一句话`；整行可点、hover 浅粉底（`bg-pink-50`）、圆角 10px、无分割线；点击把整句填入输入框并把光标移到末尾，不发送；再点另一行则替换。文案在 `pages.planStart.suggestions`（数组，每项 `{ emoji, text }`），三语按四个场景类型各写：经典单作品长线、双城短线、自驾主题、开放式短途。中文初稿：
   - ⛩ 东京 5 天，把《你的名字。》的取景地走一遍
   - 🎺 京都、宇治两天，《吹响！上低音号》圣地巡礼
   - 🏕 山梨三天自驾，跟着《摇曳露营△》去富士五湖
   - 🎲 我只有一个周末，从东京出发帮我挑一条
6. **错误与登录**：错误条与登录弹窗位置、行为沿用现有实现。
7. `?draft=` 预填时建议行照常显示。

## 第 3 节：新对话行为、数据流与代码落点

**行为**
- 侧栏「新对话」改为普通链接，指向 `prefixPath('/plan/start', locale)`；侧栏内 `createPlan()` 删除。
- `/plan` 索引页不再创建默认计划：无论是否登录，307 到当前语言（`getLocale()`）的 /plan/start。页面保留 noindex。`DEFAULT_PLAN_TITLE` 与创建接口保留。
- `POST /api/me/plans` 不动，起始页仍用首条消息前 30 字做标题。

**数据流**
- `PlanStartPageContent` 读会话后，登录用户查 `listPlans`，映射 `{id,title,updatedAt: ISO}` 传给客户端；游客传 `[]`。侧栏 `PLANS_CHANGED_EVENT` 机制照旧。
- 用量/账户区依赖登录态，游客时不渲染，换成游客提示。

**代码落点**
- 新建 `components/plan/PlanStartView.tsx`（客户端）：组合 `PlanSidebar`、主区空状态、`PlanComposer`、`LoginModal`，承接现有 `app/(plan-start)/plan/start/ui.tsx` 的发送与交接逻辑；`ui.tsx` 删除。
- 抽取 `components/plan/PlanShell.tsx`：负责侧栏、手机端抽屉按钮与开合状态、主区容器（`data-layout-*` 与 `flex h-dvh`）；对话页 `app/(authed)/plan/[id]/ui.tsx` 与起始页共用。纯结构抽取，不改对话页行为。
- i18n 新 key：`pages.planStart.headline`、`pages.planStart.suggestions`、`pages.planStart.guestSidebarHint`、`pages.planStart.guestSidebarLogin`；三语同时补齐。
- `PlanSidebar` 新增可选 prop：`variant?: 'start' | 'plan'`（默认 `'plan'`；`'start'` 时「新对话」选中、`currentPlanId` 可为 `null`）与 `guest?: boolean`。

## 第 4 节：i18n、测试与验收

**i18n**：新 key 三语同时补齐，沿用字典对齐测试；emoji 放字典里，三语可各选各的；语言只来自路径绑定的 `locale` prop，不读 cookie。

**测试**
- 更新 `tests/plan/plan-start.test.tsx`、`tests/plan/start-page.test.tsx`：外壳渲染（侧栏存在、游客提示、登录态列表）、建议行点击填入且不发请求、`?draft=` 与建议行共存、发送流程与 sessionStorage 交接不变、H1 唯一且为入口名。
- 更新侧栏测试：「新对话」是指向本地化 /plan/start 的链接，不再有创建请求。
- 新增 `/plan` 索引页测试：登录与游客都 307 到 /plan/start，不调用 `createPlan`。
- 抽取 `PlanShell` 后跑 `tests/plan` 全量，确认对话页行为零变化。
- sitelinks 验收脚本再跑一遍：三语入口 200、title/canonical/hreflang、307 兼容、sitemap。

**验收**：本地 workerd 预览自测（三语、桌面与手机宽度、游客与登录侧栏、建议行、从侧栏「新对话」回到起始页、发送后进入对话的连贯感）；负责人确认后合并部署，生产复跑脚本。

## 不做的事

- 主区不放最近对话卡片；建议行不随机、不从数据库生成。
- 不改对话页的聊天、日程、地图等功能。
- 不动 SEO 元数据、路由、307 兼容与 sitemap。
