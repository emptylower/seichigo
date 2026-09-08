# 执行简报：服务端卡片渲染 Track B（前端）

计划（必读）：`docs/superpowers/plans/2026-09-08-og-server-render.md`
设计：`docs/superpowers/specs/2026-09-08-og-server-render-design.md`

## 要做的
按计划 **Task B1 到 B5** 顺序执行。每个 Task：失败测试 → 确认失败 → 实现 → 通过 → commit（message 用计划里的）。
`lib/share/types.ts` 已含 A1 的 `buildCardImagePath`，只 import 不改。

## 约束
- 只动计划 File Structure 里标为 Track B 的文件（`components/share/**`、`lib/i18n/locales/*.json`、`tests/components/**`、`tests/i18n/**`）。不要碰 `lib/share/**`（import 除外）、`app/**`、`prisma/**`、`package.json`、`features/map/anitabi/MapDialogs.tsx`、`useAnitabiMapController.ts`。
- worktree `/Users/mac/Desktop/seichigo-wt-og-b`，分支 `feat/og-server-render-b`。不新建 worktree、不切分支、不 push、不 merge。
- 卡片渲染接口 `/api/share/card/...` 是 Track A 的产物，在此分支不存在，B4 的组件测试用 mock/桩，不要真实请求。
- 不跑 build / dev server / 部署。`node scripts/check-line-budget.mjs` 必须 OK。
- B5 删文件前先按计划改掉引用它们的测试（计划里逐行写明了）。
- 计划代码若有错，修到测试通过并在汇报里说明。

## 完成标准
B1–B5 全部 commit；`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿；`components/share/` 下不再有 PointShareCard/pointShareCardDraw/japanLocator。汇报每个 Task 的 commit sha、测试关键行、偏离处。
