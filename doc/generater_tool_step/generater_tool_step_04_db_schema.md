# 04｜数据模型：Article + Asset（Prisma/Postgres）

## 目标
新增 DB 模型以支撑：
- 富文本文章（草稿/审核/拒绝/发布）
- 图片等资源存储（DB bytes）

## 交付物
1. Prisma schema 新增：
   - `Article`
   - `Asset`
2. 迁移文件（`prisma/migrations/*`）
3. 数据访问层（repo）：
   - `lib/article/repo.ts`（接口定义）
   - `lib/article/repoPrisma.ts`（Prisma 实现）
   - `lib/asset/repo.ts`、`lib/asset/repoPrisma.ts`

## 表结构建议（你可在实现时微调字段名）
### Article
- `id` cuid
- `authorId`（User.id）
- `slug`（unique）
- `title`
- `animeId`（可选；优先做成 string）
- `city`（可选）
- `routeLength`（可选）
- `tags`（`String[]`：Postgres array）
- `contentJson`（`Json`：TipTap doc）
- `contentHtml`（Text：服务端净化后的 HTML）
- `status`（string：`draft|in_review|rejected|published`）
- `rejectReason`（Text，可空）
- `publishedAt`（DateTime，可空）
- `createdAt/updatedAt`

### Asset
- `id` cuid
- `ownerId`（User.id）
- `contentType`
- `filename`（可空）
- `bytes`（Bytes）
- `createdAt`

## 先写测试（Test First）
由于 Prisma schema 变更本身不易用“单测”表达，建议采用两层测试：
1. **repo 接口的单测（不依赖 DB）**
   - 新增 `tests/article/repo-contract.test.ts`
   - 使用 InMemoryRepo（测试内实现）验证：
     - `createDraft` 生成默认 `status=draft`
     - `findBySlug`、`listByAuthor`、`updateDraft` 行为正确
   - 目的：先锁定 repo 行为契约
2. **schema 校验作为 gate**
   - 在 CI/本地把 `npm run db:generate` / `prisma validate` 作为里程碑验收的一部分（属于“可重复验证的检查”）

> 注意：本里程碑先让“接口契约测试”变红；实现 InMemoryRepo 让它变绿；再落 Prisma schema 和 PrismaRepo。

## 再实现
1. 新增 repo 接口与 InMemoryRepo（仅供测试）
2. 修改 `prisma/schema.prisma` 增加新模型，并生成迁移
3. 实现 PrismaRepo（调用 `prisma.article.*`、`prisma.asset.*`）
4. 不删除现有 `Submission`（避免影响已有功能；后续里程碑再决定是否移除/重定向）

## 根据测试结果修正
- 若 repo 契约在后续里程碑发现缺字段/缺方法：
  - 先补测试，再扩接口与实现

## 验收（独立可测）
- `npm run test`：repo 契约测试全绿
- `npm run db:generate` 成功（Prisma Client 生成无报错）
