# Step 10｜公共站点接入：DB 已发布文章（已完成）

## 目标
让“审核同意后立即可见”在公共页面生效：
- 首页“最新文章”包含 DB `published` 文章
- `/posts/[slug]` 支持渲染 DB `published` 文章
- 作品聚合页统计/列表包含 DB `published` 文章
- sitemap/OG 覆盖 DB `published` 文章

## 本次完成内容
- 新增公共文章聚合层（MDX + DB）：
  - `lib/posts/getAllPublicPosts.ts`：合并 MDX 与 DB(published)，按 `publishDate/publishedAt` 倒序排序，slug 冲突时 MDX 优先
  - `lib/posts/getPublicPostBySlug.ts`：按 “MDX 优先，其次 DB(published)” 查找
- 改造公共页面使用聚合层：
  - 首页：`app/(site)/page.tsx`
  - 文章页与 OG：`app/(site)/posts/[slug]/page.tsx`、`app/(site)/posts/[slug]/opengraph-image.tsx`
  - 作品页：`app/(site)/anime/page.tsx`、`app/(site)/anime/[id]/page.tsx`
  - sitemap：`app/sitemap.ts`
- 为满足“立即可见”，上述页面/路由增加动态渲染配置（避免缓存导致发布后不刷新）。

## 单测（Test First）
- 新增 `tests/public/posts-aggregate.test.ts`：
  - `getAllPublicPosts`：MDX 为空/二者合并排序
  - `getPublicPostBySlug`：MDX 优先、DB published 可见、DB 非 published 不可见

## 验收方式（独立可测）
- 运行：`npm run test`
- 预期：`tests/public/posts-aggregate.test.ts` 全绿，且全量测试保持全绿
- 手动：管理员同意发布后，首页与 `/posts/<slug>` 立即可见

