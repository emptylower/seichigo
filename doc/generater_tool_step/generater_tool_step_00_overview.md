# 00｜总览：富文本创作 → 审核 → 立即发布（DB 驱动）

## 背景（基于当前仓库）
- 文章目前只从本地 MDX 读取：`content/<lang>/posts/*.mdx`（`lib/mdx/getAllPosts.ts`、`lib/mdx/getPostBySlug.tsx`）。
- 投稿目前只写 DB：`Submission`（`app/api/submissions/route.ts`、`prisma/schema.prisma`），没有“审核通过=站点可见”的发布通路。

## 目标（已确认）
实现站内完整闭环：
1. **任何登录用户**可在 `/submit` 进行**富文本创作**（轻量飞书式：标题/引用/加粗/下划线/字体颜色（调色板）/字体（常见字体）/列表/链接/表格/代码块/图片等；不含分割线与视频）。
2. 作者点击“提交审核”后进入管理员审核队列（`in_review`）。
3. 管理员只能“同意发布 / 拒绝（含原因）”，**不能直接改稿后发布**。
4. 作者可“撤回→编辑→重新提交”；被拒后进入作者草稿箱并可继续修改。
5. 管理员同意后**立即在站点可见**（不依赖 git 提交/重新部署）。
6. 图片存储在数据库。
7. slug 由作者手填；必须唯一；并且**不得与现有 MDX 文章 slug 冲突**。
8. 图片允许外链（仍需通过服务端净化白名单校验协议与属性）。

## 设计原则
- **DB 发布即上线**：新增 DB `Article`（覆盖 draft/review/rejected/published），公共页面读取“MDX + DB(published)”并集。
- **安全优先**：富文本最终渲染走“服务端净化后的 HTML”（防 XSS/恶意样式）。
- **测试先行**：每个里程碑都先写测试，再实现，再用测试回归修正。
- **低耦合可测**：业务逻辑拆到 `lib/*` service 层，Route 只做入参/鉴权/调用；对 Route 提供可注入依赖的工厂函数，便于测试。

## 核心对象与状态机（建议）
### Article（单表覆盖全流程）
状态（`ArticleStatus`）：
- `draft`：可编辑、可提交审核
- `in_review`：只读；作者可撤回
- `rejected`：可编辑；需展示拒绝原因；可再次提交审核
- `published`：对外可见（MVP 先做“已发布不可直接编辑”；后续可做“从 published 派生新 draft”）

状态流转：
- 作者：`draft|rejected -> in_review`（提交审核）
- 作者：`in_review -> draft`（撤回）
- 管理员：`in_review -> published`（同意发布）
- 管理员：`in_review -> rejected`（拒绝+原因）

### Asset（图片等媒体）
- 上传需要登录；读取公开（至少对已发布文章要可访问）。
- 存 DB（二进制 bytes + mime + filename）。

## 技术选型（建议，后续步骤会落地）
- 测试：`vitest` + `@testing-library/react`（组件/route/业务逻辑），覆盖 Node 运行时。
- 富文本编辑器：TipTap（ProseMirror）+ 必要 extensions（table/code/image/underline/textStyle/color等）。
- HTML 净化：`sanitize-html`（严格白名单 + style 白名单，禁用 `<hr>`/`<video>` 等）。

> 注：以上是实现建议；如你希望换成 Lexical/Slate 或 node:test，可在 `01` 步前调整。

## 里程碑地图（每步独立可测试）
按顺序执行以下文档：
1. `doc/generater_tool_step/generater_tool_step_01_test_harness.md`
2. `doc/generater_tool_step/generater_tool_step_02_auth_signin_ui.md`
3. `doc/generater_tool_step/generater_tool_step_03_workflow_domain.md`
4. `doc/generater_tool_step/generater_tool_step_04_db_schema.md`
5. `doc/generater_tool_step/generater_tool_step_05_richtext_sanitize.md`
6. `doc/generater_tool_step/generater_tool_step_06_asset_api.md`
7. `doc/generater_tool_step/generater_tool_step_07_article_api.md`
8. `doc/generater_tool_step/generater_tool_step_08_author_ui.md`
9. `doc/generater_tool_step/generater_tool_step_09_admin_review_ui.md`
10. `doc/generater_tool_step/generater_tool_step_10_public_integration.md`

## 并行开发建议（基于依赖关系）
> 前提：`01`（测试基建）必须先完成，否则各条线都无法做到“测试先行”与统一验收。

### 依赖关系（简化）
- `01` → 所有步骤
- `02`（登录 UI）独立：仅依赖 `01`
- `03`（状态机/权限）独立：仅依赖 `01`
- `05`（sanitize）独立：仅依赖 `01`
- `04`（DB schema + repo 契约）弱依赖 `03`（需要对齐 status 字符串/字段）
- `06`（asset API）依赖 `04`（至少需要 repo 接口/实现）
- `07`（article API）依赖 `03 + 04 + 05`
- `08`（作者 UI）依赖 `06 + 07`（可在接口稳定后并行推进 UI）
- `09`（审核 UI）依赖 `07`（可与 `08` 并行）
- `10`（公共接入）依赖 `04 + 07`（聚合层的纯逻辑测试可提前写，但落页面改造要等接口/字段定型）

### 推荐并行拆分（3 条线的最小冲突方案）
- **A 线（基础与规则）**：`01` → `03`（状态机/权限）→（协助对齐 `04/07` 的规则与错误码）
- **B 线（安全与富文本）**：`01` → `05`（sanitize 白名单/调色板/字体）→（协助 `07/08/10` 的渲染策略）
- **C 线（数据与接口）**：`01` → `04`（DB + repo）→ `06`（图片）→ `07`（文章 API）

当 `07` 的 API 契约稳定后：
- **D 线（作者 UI）**：`08`（可与 `09` 并行）
- **E 线（审核 UI）**：`09`
- **F 线（公共接入）**：`10`（与 `08/09` 并行，但最终合并前要统一字段/排序规则）
