# 07｜文章 API：草稿 CRUD + 提交/撤回 + 审核同意/拒绝

## 目标
提供后续 UI 需要的最小 API 集：
- 作者：创建/编辑草稿、提交审核、撤回、查看自己稿件列表
- 管理员：查看待审列表、同意发布、拒绝（含原因）

## 交付物（建议路由）
### 作者侧
- `POST /api/articles`：创建草稿
- `GET /api/articles?scope=mine&status=`：我的列表（draft/in_review/rejected/published）
- `GET /api/articles/[id]`：详情（仅作者或管理员）
- `PATCH /api/articles/[id]`：保存草稿（仅 draft/rejected）
- `POST /api/articles/[id]/submit`：提交审核（draft/rejected -> in_review）
- `POST /api/articles/[id]/withdraw`：撤回（in_review -> draft）

### 管理员侧
- `GET /api/admin/review/articles?status=in_review`：待审列表
- `POST /api/admin/review/articles/[id]/approve`：同意发布
- `POST /api/admin/review/articles/[id]/reject`：拒绝（必须 reason）

## 关键规则（必须在测试里锁死）
- slug 唯一：DB `Article.slug` unique
- slug 不得与 MDX 冲突：
  - 保存/提交/发布前都要检查（推荐在“提交审核”与“保存 slug”时检查）
- `in_review` 不可编辑（PATCH 应返回 409/400）
- 管理员不能编辑内容（只 approve/reject）
- reject 必须填写原因

## 先写测试（Test First）
新增 `tests/article/api.test.ts`（可拆文件），覆盖：
1. 鉴权：
   - 未登录：作者侧 API 401
   - 非管理员访问 admin review API：403
2. 草稿 CRUD：
   - 创建后 `status=draft`
   - `PATCH` 在 `draft` 成功；在 `in_review` 失败
3. 状态流转：
   - submit：`draft -> in_review`
   - withdraw：`in_review -> draft`
   - reject：`in_review -> rejected` 且记录 `rejectReason`
   - approve：`in_review -> published` 且 `publishedAt` 不为空
4. slug 校验：
   - DB 已存在同 slug：提交/保存失败
   - MDX 已存在同 slug：提交/保存失败（通过 mock 一个 “mdxSlugExists” 依赖）

> 推荐实现方式：Route 文件导出 `createHandlers(deps)`，测试用 in-memory repo + stub session/mdxChecker。

## 再实现
1. 新增 service 层（建议）：
   - `lib/article/service.ts`：组合 repo + workflow + sanitize
2. 新增 route handlers：
   - `app/api/articles/...`
   - `app/api/admin/review/...`
3. 入参校验：使用 `zod`（沿用现有风格）
4. 输出：
   - 列表返回必要字段（id/slug/title/status/updatedAt 等）
   - 详情返回 contentJson/contentHtml + meta

## 根据测试结果修正
- 所有边界行为变更必须先改测试

## 验收（独立可测）
- `npm run test`：`tests/article/api.test.ts` 全绿

