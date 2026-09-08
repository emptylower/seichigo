# 执行简报：服务端卡片渲染 Track A（后端）

计划（必读，代码与命令全在里面）：`docs/superpowers/plans/2026-09-08-og-server-render.md`
设计：`docs/superpowers/specs/2026-09-08-og-server-render-design.md`

## 要做的
按计划 **Task A1 到 A16** 顺序执行（注意 A11 排在 A10 之前，计划里已写明）。每个 Task：失败测试 → 确认失败 → 实现 → 通过 → commit（message 用计划里的）。A1 完成 commit 后立刻继续，不要停下汇报。

## 约束
- 只动计划 File Structure 里标为 Track A 的文件。不要碰 `components/**`、`features/**`、`lib/i18n/locales/*.json`、`tests/components/**`、`tests/i18n/**`。
- worktree `/Users/mac/Desktop/seichigo-wt-share-b`，分支 `feat/og-server-render`。不要新建 worktree、不切分支、不 push、不 merge。
- 不跑 wrangler / opennextjs-cloudflare / npm run build / dev server / 部署。
- 测试里不得真实请求 api.cloudflare.com，用 mock。
- `.env` 与 `.env.local` 已含 `BROWSER_RUN_TOKEN` 与 `CF_ACCOUNT_ID`，不要修改或打印它们的值。
- 计划代码若有错，修到测试通过并在汇报里说明。

## 完成标准
A1–A16 全部 commit；`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿。汇报每个 Task 的 commit sha、测试关键行、偏离处。
