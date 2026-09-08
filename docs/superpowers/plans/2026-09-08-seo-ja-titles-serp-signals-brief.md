# 执行简报：日文标题摘要 + SERP 信号修复

设计文档（必读，改动清单与文案全在里面）：`docs/superpowers/specs/2026-09-08-seo-ja-titles-and-serp-signals-design.md`

## 要做的

按设计文档 A、B、C、D、E 五节实现。文案一字不改，照设计文档抄。

- A：`lib/seo/alternates.ts` 双重编码修复 + 新增 `tests/seo/alternates.test.ts`。
- B：`app/layout.tsx` 删除两个 next/script JSON-LD，Organization 改用 `lib/seo/placeJsonLd.tsx` 的默认导出组件渲染；WebSite 不再在 layout 输出。`buildWebSiteJsonLd` 无其他调用方则一并删除。
- C：三个首页文件的 `TITLE` 常量。
- D：两篇 MDX 的 `seoTitle` 与 `description`。
- E：只新建 `scripts/update-ja-article-seo.ts`（默认 dry-run，`--apply` 才写），**不要运行它**，不要连任何数据库。参考 `scripts/repair-english-article.ts` 的 Prisma 连接写法。

## 约束

- 不要 `git commit`、不要 `git push`、不要切分支。当前分支 `feat/seo-ja-titles-serp-signals`，直接在工作区改。
- 不要碰 `components/map/**`、`lib/planAgent/**`、`prisma/schema.prisma`。
- 不要改任何页面正文、`DESCRIPTION` 常量、MDX 的 `title` 字段。
- 不要执行 `wrangler`、`opennextjs-cloudflare`、任何 deploy/upload 命令。
- 不要启动 dev server。

## 完成标准

- `npm run typecheck` 通过。
- `npm test` 通过（含新增的 alternates 测试）。
- 最后用简短中文汇报：改了哪些文件、测试输出的关键行、有没有拿不准的地方。
