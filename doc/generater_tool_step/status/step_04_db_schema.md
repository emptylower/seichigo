# Step 04｜数据模型：Article + Asset（已完成）

## 目标
新增 DB 模型与数据访问层（repo），为后续“富文本创作 → 审核 → 发布（DB 驱动）”提供基础能力：
- `Article`：覆盖草稿/审核/拒绝/发布全流程
- `Asset`：图片等媒体存储（DB bytes）

## 本次完成内容
- Prisma schema 新增模型：
  - `Article`：包含 `slug(unique)`、`status(draft/in_review/rejected/published)`、`contentJson/contentHtml`、`rejectReason/publishedAt` 等字段
  - `Asset`：包含 `bytes`、`contentType`、`ownerId` 等字段
  - `User` 增加关系：`articles`、`assets`
- 新增 Prisma migration：
  - `20251213153000_article_asset`（创建 `Article/Asset` 表与索引/外键）
- 新增 repo 层（接口 + InMemory 实现 + Prisma 实现）：
  - Article：`createDraft/findById/findBySlug/listByAuthor/updateDraft`
  - Asset：`create/findById`
  - slug 冲突：统一抛出 `ArticleSlugExistsError`（InMemory 与 Prisma 都对齐）
- repo 契约测试（不依赖真实 DB）：
  - `createDraft` 默认 `status=draft`
  - `findBySlug/listByAuthor/updateDraft` 行为正确
- 与 Step 03 的状态机对齐：
  - `Article.status` 在业务层使用 `ArticleStatus`（`draft|in_review|rejected|published`）
  - Prisma 字段类型保持 `String`（后续可升级为 enum；本步先确保 API/工作流可用）

## 变更文件
- `prisma/schema.prisma`
- `prisma/migrations/20251213153000_article_asset/migration.sql`
- `lib/article/repo.ts`
- `lib/article/repoMemory.ts`
- `lib/article/repoPrisma.ts`
- `lib/asset/repo.ts`
- `lib/asset/repoMemory.ts`
- `lib/asset/repoPrisma.ts`
- `tests/article/repo-contract.test.ts`

## 验收方式（独立可测）
- 运行：`npm run test`
- 运行：`npm run db:generate`
- （可选）运行：`npm run build`

