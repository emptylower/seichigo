# 计划页改造：传统 AI Chat 布局（左侧会话列表 + 居中对话列 + 悬浮输入胶囊）

用户反馈（2026-09-02，预览 5b3bcd5c 截图）：
- 输入区外层是一条通栏白色底板（连同顶部 h-14 的白色顶栏），textarea 变高时整条白板跟着变高，突兀；不要"上下页眉页脚白块"的设计。
- 整个 /plan 页改成传统 AI Chat：左侧会话列表，没有上一级列表页；不要"我的/群组"之类的分类；任何已创建的对话都必须立刻出现在列表里（用户退出对话后回来能找到）。

工作方式：先通读 `app/(authed)/plan/**`、`components/layout/SiteShell*.tsx`（`data-layout-wide`/`data-layout-immersive` 的作用）与 `tests/plan/**`；每条先补失败测试再实现；不要 git commit；只碰 `app/(authed)/plan/**`、`tests/plan/**`，不碰 `lib/**`、`tests/planAgent/**`。完成标准：`npx vitest run tests/plan tests/map` 全绿；`npx tsc --noEmit` 无错；`node scripts/check-line-budget.mjs` 通过（ui.tsx 已 500+ 行，新组件放 `app/(authed)/plan/[id]/components/`）。

## 目标结构

```
┌────────────┬──────────────────────────────────────────┐
│ 侧栏 260px │  对话列（居中 max-w-3xl，768px）           │
│ [+ 新建对话]│  标题行（透明，仅文字）                     │
│ 会话 1 ●   │  消息流 …                                  │
│ 会话 2     │  daymap 卡片 …                             │
│ …          │  ┌────────────────────────────────┐        │
│            │  │ 悬浮输入胶囊（圆角、描边、阴影） ➤ │        │
│            │  └────────────────────────────────┘        │
└────────────┴──────────────────────────────────────────┘
```

### 1. 路由
- `app/(authed)/plan/page.tsx`：不再渲染列表页。服务端逻辑：取用户计划列表，若有则 `redirect('/plan/<最新 updatedAt 的 id>')`；若没有则 `deps.repo.createPlan({ userId, title: DEFAULT_PLAN_TITLE })` 后 redirect 到它。`CreatePlanButton.tsx` 删除（逻辑并入侧栏）。
- `app/(authed)/plan/[id]/page.tsx`：除现有 plan/chat 外，额外取 `listPlans(userId)` 映射为 `{ id, title, updatedAt }[]` 传给 `PlanPlanner`（新增 prop `plans`）。

### 2. 侧栏 `components/PlanSidebar.tsx`（新建，client）
- 桌面（`lg:` 以上）常驻 260px，`border-r`，浅色背景（与站点粉色系一致：`bg-pink-50/40`）；顶部"＋ 新建对话"按钮（`POST /api/me/plans`，成功后 `router.push('/plan/<id>')`），下方按 `updatedAt` 倒序列出全部计划：标题（空或默认标题显示"新对话"）+ 相对时间（今天/昨天/M月D日）；当前计划高亮；点击 `router.push`。
- 移动端：侧栏隐藏，对话列标题行左侧放一个菜单按钮打开抽屉（同一组件，`fixed inset-y-0 left-0 w-72` + 遮罩）。
- 列表刷新：组件挂载时以 props 初始化；收到父组件 `onPlansChanged` 触发（`plan_updated` 事件与标题生成后）时 `GET /api/me/plans` 重新拉取，保证新对话的标题从"新对话"变成生成的标题。

### 3. 对话列（`ui.tsx` 改造）
- 删除现在的 `h-14` 白色顶栏与底部 `border-t bg-white` 的通栏输入条。
- 标题行：在对话列顶部，`sticky top-0`，透明背景 + `backdrop-blur-sm`，只放：移动端菜单按钮、计划标题（单行截断）、右侧保留现有"…"菜单（若有）。无边框、无白底。
- 消息流容器保持 `mx-auto w-full max-w-3xl px-4`，底部留出输入胶囊高度的 padding（约 `pb-40`）。
- 输入区改为**悬浮胶囊**：`sticky bottom-0` 的包裹层背景是 `bg-gradient-to-t from-[页面底色] via-[页面底色]/80 to-transparent`（页面底色沿用当前粉白渐变的底色），**没有边框、没有整幅白块**；胶囊本体在 `max-w-3xl` 列内：`rounded-3xl border border-gray-200 bg-white shadow-sm px-4 py-3`，内含 textarea（自动增高，最多 6 行，超出内部滚动）与右侧圆形发送按钮；胶囊变高时只有胶囊变高。busy 时发送按钮变为加载态，与现有行为一致。
- 同步横幅（断线/运行中）改为在标题行下方的一条圆角提示条，宽度随对话列。
- 保留 `data-layout-wide` / `data-layout-immersive`（用于隐藏站点 header/footer）。

### 4. 兼容与清理
- 站点导航里指向 `/plan` 的链接不用改（会 redirect 到最新对话）。
- `app/(authed)/me/page.tsx` 里"我的巡礼计划"入口不动。
- 删除不再使用的列表页样式与 `CreatePlanButton`；相关测试同步更新或删除。

### 5. 测试（`tests/plan/`）
- `plan-sidebar.test.tsx`（新）：渲染 3 个计划，当前项高亮；空标题显示"新对话"；点击"新建对话"调用 `POST /api/me/plans` 并跳转；`onPlansChanged` 后重新拉取。
- `plan-timeline.test.tsx`：更新布局断言——不存在全宽 `border-t` 输入条；输入胶囊在 `max-w-3xl` 容器内；textarea 增高不改变胶囊外层容器的类名（只断言结构，不断言像素）。
- `plan-page-redirect.test.ts`（node，若现有测试目录里有对 server component 的测试写法则沿用；否则跳过并在汇报里说明）。

汇报：改动文件、删除文件、测试结果、以及任何与现有 `tests/plan` 用例冲突的取舍。
