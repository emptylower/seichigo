# 本次对话工作记录（2025-12-13）

## 本次目标
- 完成 `doc/generater_tool_step/generater_tool_step_10_public_integration.md`（公共站点接入 DB 已发布文章）

## 已完成：Step 10｜Public Integration（公共页面接入 DB）
### 交付内容
- 新增公共文章聚合层（避免侵入现有 `lib/mdx/*`）：
  - `lib/posts/getAllPublicPosts.ts`：合并 `MDX posts + DB(published) articles`；slug 冲突时 MDX 优先；按 `publishDate/publishedAt` 倒序排序
  - `lib/posts/getPublicPostBySlug.ts`：查找顺序为 MDX 优先，其次 DB（仅 `published` 可公开）
  - `lib/posts/defaults.ts`：默认 repo 获取（无 `DATABASE_URL` 时降级为仅 MDX）
  - `lib/posts/types.ts`：公共聚合类型定义

### 页面改造（公共侧）
- 首页最新文章接入聚合层：`app/(site)/page.tsx`
- 文章详情页接入聚合层：
  - MDX：沿用现有 RSC/MDX 渲染
  - DB：渲染 `Article.contentHtml`（由保存接口做 sanitize）
  - `app/(site)/posts/[slug]/page.tsx`
- OG Image 支持 DB：`app/(site)/posts/[slug]/opengraph-image.tsx`
- 作品聚合页统计/列表包含 DB published：`app/(site)/anime/page.tsx`、`app/(site)/anime/[id]/page.tsx`
- sitemap 覆盖 DB published：`app/sitemap.ts`

### “同意发布后立即可见”
- 为避免缓存导致“发布后不刷新”，相关页面/路由增加动态渲染配置（以 DB 为准实时读取）。

## 测试（Test First）
- 新增 `tests/public/posts-aggregate.test.ts`（完全 mock MDX provider + in-memory Article repo，不依赖真实文件/DB），覆盖：
  - `getAllPublicPosts`：MDX 为空/二者合并排序
  - `getPublicPostBySlug`：MDX 优先、DB published 可见、DB 非 published 不可公开

## 验证
- `npm run test` 全绿（包含 `tests/public/posts-aggregate.test.ts`）

## 相关状态文档
- `doc/generater_tool_step/status/step_10_public_integration.md`

