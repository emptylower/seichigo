# 《你的名字》三篇人工文章：slug 改为纯 ASCII + 旧 slug 永久 301

分支：`feat/ascii-slugs-your-name`（当前 worktree 已在此分支）。**不要 git commit，不要 git push，不要 deploy，不要对任何数据库执行写操作**（脚本只允许在 `--apply` 下写，而 `--apply` 由人来跑，你只跑 dry-run）。

## 背景

DB 里三篇 `Article`（每篇 zh / ja / en 三行，`@@unique([slug, language])`，同一篇三语共用同一个 slug，hreflang 依赖"三语同 slug"）目前 slug 含中文：

| 旧 slug（三语共用） | 新 slug（三语共用） |
|---|---|
| `你的名字-your-name-seichigo-tokyo-shinjuku` | `your-name-pilgrimage-part1-tokyo-shinjuku` |
| `你的名字-your-name-tokyo-minato-ward` | `your-name-pilgrimage-part2-tokyo-minato` |
| `你的名字-your-name-tokyo-from-hida-to-suwa` | `your-name-pilgrimage-part3-hida-to-suwa` |

对外 URL：`/posts/<slug>`、`/ja/posts/<slug>`、`/en/posts/<slug>`。旧 URL 在 Google 有排名，必须 301 到新 URL（同 locale）。

现有机制（先读）：
- `lib/posts/getPublicPostBySlug.ts`：按 slug 查 MDX 快照 → DB（`findBySlugAndLanguage`）。DB slug 改掉后，旧 slug 会查不到 → 404，所以要加一层"旧 slug → 新 slug"映射。
- `app/(site)/posts/[slug]/page.tsx`、`app/ja/posts/[slug]/page.tsx`、`app/en/posts/[slug]/page.tsx`：三个页面同构。`PostPage` 开头先查 `resolvePublicOverrideForPost`，然后 `getPublicPostBySlug`；找到 DB 文章后若请求 key ≠ `article.slug` 会 `permanentRedirect` 到 canonical（约第 182–191 行）。`generateMetadata` 也按 slug 取文章。
- `lib/publicOverride/service.ts` 的 redirect 带 `expiresAt`，是临时机制，**不要用它做这次的永久 301**。
- `lib/article/slug.ts`：`isValidArticleSlug` / `normalizeArticleSlug`，新 slug 必须通过 `isValidArticleSlug`。
- `lib/seo/alternates.ts`：hreflang 由同一路径加 `/ja` `/en` 前缀得到，所以三语必须同 slug。
- `app/sitemap.ts` 从 DB 动态读，不用改。

## 要做的

### 1. 新建 `lib/posts/legacySlugs.ts`

```ts
export const LEGACY_POST_SLUGS: Readonly<Record<string, string>> = { /* 上表三对 */ }
/** 输入原始路由参数（可能是 percent-encoded），命中旧 slug 时返回新 slug，否则 null */
export function resolveLegacyPostSlug(rawSlug: string): string | null
```
实现：safe-decodeURIComponent（参考 page.tsx 里的 `safeDecodeURIComponent`）→ trim → 直接查表；再用 `normalizeArticleSlug` 归一化后查一次。不命中返回 null。

### 2. 三个 post 页面接入

在 `generateMetadata` 和 `PostPage` 两处，**取到 `slug` 之后、任何查询之前**：
```ts
const legacyTarget = resolveLegacyPostSlug(slug)
if (legacyTarget) permanentRedirect(`/posts/${encodeSlugForPath(legacyTarget)}`)   // ja 页用 `/ja/posts/…`，en 页用 `/en/posts/…`
```
三个文件各自的 locale 前缀不要弄错。`encodeSlugForPath` 三个文件里已有。

### 3. 新建脚本 `scripts/rename-article-slugs.ts`

用 `import { prisma } from '@/lib/db/prisma'`（参考 `scripts/update-ja-article-seo.ts` 的写法与 `--apply` 约定）：
- 对 `LEGACY_POST_SLUGS` 的每一对：`findMany({ where: { slug: old } })` 列出所有语言行（期望每个 old 有 zh/ja/en 三行）；检查 `findMany({ where: { slug: new } })` 为空（有冲突就报错退出，不写）。
- 默认 dry-run：打印每行 `id / language / title / old → new`，末尾打印 `DRY RUN, nothing written`。
- `--apply`：在一个 `prisma.$transaction` 里 `update` 这 9 行的 `slug`；完成后再 `findMany` 打印新 slug 的行数作为验证。
- 无论哪种模式都不要碰 `ArticleRevision`、`PublicOverride`。
- **你只跑 dry-run**：`npx tsx scripts/rename-article-slugs.ts`（它默认连 `.env` 的开发库，开发库里可能没有这三篇，打印 0 行也算通过；脚本不能因为 0 行而崩）。

### 4. 测试

在 `tests/public/` 下新增 `post-legacy-slug.test.tsx`（参考同目录 `post-ai-notice.test.tsx` 的 mock 方式）：
1. 请求旧 slug（原文与 percent-encoded 两种）时，zh 页面对 `permanentRedirect` 的调用参数是 `/posts/your-name-pilgrimage-part1-tokyo-shinjuku`；ja 页面是 `/ja/posts/…`；en 页面是 `/en/posts/…`。
2. 请求新 slug 时不触发 legacy 重定向（走原有查询路径）。
另加 `tests/posts/legacySlugs.test.ts`（纯函数）：三对映射命中、encoded 命中、非旧 slug 返回 null、三个新 slug 都通过 `isValidArticleSlug`。

现有测试文件里出现的 `你的名字-your-name-…` 字面量只是 fixture，**不要改它们**；如果因为加了 legacy 重定向导致某个现有测试（尤其 `tests/public/post-ai-notice.test.tsx`、`tests/public/db-public-notice.test.ts`、`tests/seo/alternates.test.ts`）用旧 slug 做 fixture 而被重定向打断，把那些 fixture 改成不在映射表里的别的 slug（例如 `你的名字-fixture-tokyo`），并在汇报里列出改了哪些。

## 不要做

- 不改 `prisma/schema.prisma`、不生成 migration。
- 不改 MDX、不改 `content/generated/*`。
- 不改 `scripts/update-ja-article-seo.ts` / `repair-*.ts` / `find_ids.ts` 里的旧常量（一次性脚本，留着）。
- 不跑 `npm run build`、不起 dev server。

## 完成标准

依次通过：
```
npm run typecheck
npx vitest run tests/public tests/posts tests/seo
npm run lint
npx tsx scripts/rename-article-slugs.ts     # dry-run，不带 --apply
```

汇报（中文，简短）：改动文件列表、四条命令的结果、dry-run 输出摘要、有没有改现有测试 fixture。
