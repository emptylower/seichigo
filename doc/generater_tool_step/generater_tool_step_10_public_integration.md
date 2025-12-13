# 10｜公共站点接入：首页/文章页/作品聚合/sitemap/OG 支持 DB 已发布文章

## 目标
让“审核同意后立即可见”真正落地到公共页面：
- 首页“最新文章”包含 DB 已发布文章
- `/posts/[slug]` 能渲染 DB 已发布文章
- 作品聚合页统计/列表包含 DB 已发布文章
- sitemap/OG 覆盖 DB 已发布文章

## 交付物（建议新增聚合层）
新增 `lib/posts` 聚合模块（避免直接改动现有 `lib/mdx/*`）：
- `lib/posts/getAllPublicPosts.ts`
  - 返回：`MDX posts + DB(published) articles`
- `lib/posts/getPublicPostBySlug.ts`
  - 查找顺序：MDX 优先，其次 DB

并改造页面：
- `app/(site)/page.tsx`
- `app/(site)/posts/[slug]/page.tsx`
- `app/(site)/posts/[slug]/opengraph-image.tsx`
- `app/(site)/anime/page.tsx`、`app/(site)/anime/[id]/page.tsx`
- `app/sitemap.ts`

## 先写测试（Test First）
新增 `tests/public/posts-aggregate.test.ts`：
1. `getAllPublicPosts`：
   - 当 MDX 为空、DB 有 published → 返回 DB
   - 当二者都有 → 合并、按 publishDate/publishedAt 排序（规则需在测试明确）
2. `getPublicPostBySlug`：
   - slug 存在于 MDX → 返回 MDX
   - slug 仅存在于 DB(published) → 返回 DB
   - slug 仅存在于 DB(draft/review) → 返回 null（不可公开）

> 该测试使用 mock：MDX provider + Article repo（in-memory），不依赖真实文件/DB。

## 再实现
1. 聚合层实现
2. 页面改造：
   - 首页列表改用聚合层
   - 文章页：
     - MDX：沿用现有渲染
     - DB：渲染 `contentHtml`（已 sanitize）并展示 meta
3. 作品页：
   - 统计/列表需合并 DB published（animeId 为空的可归为 unknown 或不计）
4. sitemap/OG：
   - sitemap 加入 DB published url
   - OG image 支持 DB title/subtitle

## 根据测试结果修正
- 排序规则一旦确定（优先 publishDate/publishedAt），后续变更必须先改测试

## 验收（独立可测）
- `npm run test`：`tests/public/posts-aggregate.test.ts` 全绿
- 手动：管理员同意发布后，首页与 `/posts/<slug>` 立即可见

