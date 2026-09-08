# 执行简报：分享 v2 Track B（前端）

计划文件（必读，代码与命令全在里面）：`docs/superpowers/plans/2026-09-08-share-v2.md`
设计文档：`docs/superpowers/specs/2026-09-08-share-v2-destination-panel-and-location-card-design.md`

## 要做的
按计划 **Task B1 到 B10** 顺序执行，每个 Task：失败测试 → 确认失败 → 实现 → 通过 → commit（message 用计划里的）。
`lib/share/types.ts` 已含 A1 的 `PointContextResponse` 等，只 import 不改。

## 约束
- 只动计划 File Structure 里标为 Track B 的文件。不要碰 `lib/share/**`（import 除外）、`app/api/**`、`app/s/**`、`prisma/**`、`package.json`、`features/map/anitabi/MapDialogs.tsx`、`useAnitabiMapController.ts`。
- 你在 worktree `/Users/mac/Desktop/seichigo-wt-share-b`，分支 `feat/share-v2-b`。不要新建 worktree、不要切分支、不要 push、不要 merge。
- 不跑 wrangler / opennextjs-cloudflare / npm run build / dev server。
- 计划代码若有错，修到测试通过并在汇报里说明。`node scripts/check-line-budget.mjs` 必须 OK。

## 完成标准
- B1–B10 全部 commit；`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿（`tests/lib/prisma-client-lifecycle.test.ts` 的 3 个既有错误与你无关）。
- 简短中文汇报：每个 Task 的 commit sha、测试关键行、偏离计划处。
