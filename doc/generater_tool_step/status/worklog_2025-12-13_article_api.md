# 本次对话工作记录（2025-12-13）

## 本次目标
- 完成 `doc/generater_tool_step/generater_tool_step_07_article_api.md`（文章 API：草稿 CRUD + 提交/撤回 + 审核同意/拒绝）

## 已完成：Step 07｜Article API
### 交付内容
- 作者侧 API（需要登录）：
  - `POST /api/articles`：创建草稿（默认 `status=draft`），并对 `contentHtml` 做服务端净化
  - `GET /api/articles?scope=mine&status=`：获取“我的文章”列表（可按状态过滤）
  - `GET /api/articles/[id]`：详情（仅作者或管理员可访问）
  - `PATCH /api/articles/[id]`：保存草稿（仅 `draft/rejected` 可编辑；`in_review` 返回 409）
  - `POST /api/articles/[id]/submit`：提交审核（`draft|rejected -> in_review`）
  - `POST /api/articles/[id]/withdraw`：撤回（`in_review -> draft`）
- 管理员侧审核 API：
  - `GET /api/admin/review/articles?status=in_review`：待审列表（默认 `in_review`）
  - `POST /api/admin/review/articles/[id]/approve`：同意发布（`in_review -> published`，写入 `publishedAt`）
  - `POST /api/admin/review/articles/[id]/reject`：拒绝（`in_review -> rejected`，必填 `reason`）

### 关键规则与实现点
- slug 约束（API 层锁死）：
  - slug 唯一：repo 层统一抛 `ArticleSlugExistsError`，API 映射 409
  - slug 不得与 MDX 冲突：创建/更新 slug/提交审核/同意发布都会校验（通过可注入的 `mdxSlugExists`）
- 状态机对齐：
  - submit/withdraw/approve/reject 统一走 `lib/article/workflow.ts`，并映射到 HTTP 状态码（403/409 等）
- 可测性与依赖注入：
  - 新增 `lib/article/api.ts` 作为依赖聚合（repo/session/mdxChecker/sanitize/now），并通过动态 import + 缓存避免测试环境加载 Prisma
  - repo 扩展：新增 `listByStatus`/`updateState` 并同步到 in-memory 与 Prisma 实现

### 测试
- 新增 `tests/article/api.test.ts` 覆盖：
  - 作者/管理员鉴权
  - 草稿创建/列表/详情/编辑限制
  - submit/withdraw/reject/approve 状态流转
  - slug 冲突：DB 已存在与 MDX 冲突（create/patch/submit/approve）

### 验证
- `npm run test` 全绿（包含 `tests/article/api.test.ts`）

## 相关状态文档
- `doc/generater_tool_step/status/step_07_article_api.md`

