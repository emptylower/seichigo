# Step 07｜文章 API：草稿 CRUD + 提交/撤回 + 审核同意/拒绝（已完成）

## 目标
提供后续 UI 需要的最小 API 集：
- 作者：创建/编辑草稿、提交审核、撤回、查看自己稿件列表
- 管理员：查看待审列表、同意发布、拒绝（含原因）

## 本次完成内容
- 新增作者侧 API：
  - `POST /api/articles`：创建草稿（`status=draft`）
  - `GET /api/articles?scope=mine&status=`：我的列表（可按 status 过滤）
  - `GET /api/articles/[id]`：详情（仅作者或管理员）
  - `PATCH /api/articles/[id]`：保存草稿（仅 `draft/rejected`）
  - `POST /api/articles/[id]/submit`：提交审核（`draft|rejected -> in_review`）
  - `POST /api/articles/[id]/withdraw`：撤回（`in_review -> draft`）
- 新增管理员侧审核 API：
  - `GET /api/admin/review/articles?status=in_review`：待审列表（可按 status 查询）
  - `POST /api/admin/review/articles/[id]/approve`：同意发布（`in_review -> published`，写入 `publishedAt`）
  - `POST /api/admin/review/articles/[id]/reject`：拒绝（`in_review -> rejected`，必填 `reason`）
- 关键规则落地：
  - slug 唯一：repo 层统一抛 `ArticleSlugExistsError`，API 映射为 409
  - slug 不得与 MDX 冲突：创建/改 slug/提交审核/同意发布均校验（通过可注入 `mdxSlugExists`）
  - `in_review` 不可编辑：`PATCH` 返回 409
  - 非管理员访问审核 API：403；未登录作者 API：401
- 单测先行并覆盖鉴权、CRUD、状态流转、slug 冲突（DB + MDX）等场景。

## 变更文件
- API Routes：
  - `app/api/articles/route.ts`
  - `app/api/articles/[id]/route.ts`
  - `app/api/articles/[id]/submit/route.ts`
  - `app/api/articles/[id]/withdraw/route.ts`
  - `app/api/admin/review/articles/route.ts`
  - `app/api/admin/review/articles/[id]/approve/route.ts`
  - `app/api/admin/review/articles/[id]/reject/route.ts`
- 支撑：
  - `lib/article/api.ts`
  - `lib/mdx/slugExists.ts`
  - `lib/article/repo.ts`
  - `lib/article/repoMemory.ts`
  - `lib/article/repoPrisma.ts`
- Tests：
  - `tests/article/api.test.ts`

## 验收方式（独立可测）
- 运行：`npm run test`
- 预期：`tests/article/api.test.ts` 全绿，且全量测试保持全绿

