# 执行简报：分享 v2 Track A（后端）

计划文件（必读，代码与命令全在里面）：`docs/superpowers/plans/2026-09-08-share-v2.md`
设计文档：`docs/superpowers/specs/2026-09-08-share-v2-destination-panel-and-location-card-design.md`

## 要做的
按计划 **Task A1 到 A8** 顺序执行，每个 Task：失败测试 → 确认失败 → 实现 → 通过 → commit（message 用计划里的）。A1 完成 commit 后立刻继续。

## 约束
- 只动计划 File Structure 里标为 Track A 的文件，加上 `lib/share/types.ts`。不要碰 `components/**`、`features/**`、`lib/i18n/locales/*.json`、`tests/components/**`、`tests/i18n/**`。
- 你在 worktree `/Users/mac/Desktop/seichigo-wt-share-a`，分支 `feat/share-v2`。不要新建 worktree、不要切分支、不要 push、不要 merge。
- 迁移只写文件，不对任何数据库执行 migrate。`prisma generate` 可以跑。
- 不跑 wrangler / opennextjs-cloudflare / npm run build / dev server。
- 测试里不得真实请求 api.maptiler.com，用 fixture。
- 计划代码若有错，修到测试通过并在汇报里说明。

## 完成标准
- A1–A8 全部 commit；`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿（`tests/lib/prisma-client-lifecycle.test.ts` 的 3 个 typecheck:tests 既有错误与你无关）。
- 简短中文汇报：每个 Task 的 commit sha、测试关键行、偏离计划处。
