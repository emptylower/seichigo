# 执行简报：点位分享 Track A（后端）

计划文件（必读，所有代码、测试、命令都在里面）：`docs/superpowers/plans/2026-09-08-point-share-card-and-short-link.md`
设计文档（背景）：`docs/superpowers/specs/2026-09-08-point-share-card-and-short-link-design.md`

## 要做的

按计划文件里 **Task A1 到 A15** 逐个执行，顺序不能变。每个 Task 按它的 Step 走：先写失败测试、跑一次确认失败、写实现、跑通过、commit。commit message 用计划里给的。

**Task A1 完成并 commit 后立刻继续 A2**，不要停下来汇报。

## 约束

- 只能动计划 File Structure 里标为 Track A 的文件，加上 `lib/share/types.ts`。**不要碰任何 Track B 的文件**（`components/share/**`、`features/map/anitabi/DetailPanel.tsx`、`features/map/anitabi/MapDialogs.tsx`、`features/map/anitabi/AnitabiMapLayout.tsx`、`features/map/anitabi/useAnitabiMapController.ts`、`lib/i18n/locales/*.json`、`components/checkin/**`）。
- 可以 `git commit`（每个 Task 一次），**不要 `git push`，不要切分支，不要 merge**。当前分支 `feat/point-share-card`。
- Prisma 迁移只写文件，**不要对任何数据库执行 `prisma migrate deploy` / `migrate dev` / `db push`**。`prisma generate` 可以跑。
- 不要执行 `wrangler`、`opennextjs-cloudflare`、任何 deploy/upload 命令，不要起 dev server。
- `npm uninstall @vercel/og` 按计划里的步骤做。
- 如果某个 Step 的测试跑不过且计划里的代码明显有错，修到通过，并在最后汇报里写明改了什么、为什么。不要跳过测试。

## 完成标准

- A1 到 A15 全部 commit。
- `npx tsc -p tsconfig.app.json --noEmit` 0 错误。
- `npm test` 全绿（`tests/lib/prisma-client-lifecycle.test.ts` 的 3 个 typecheck:tests 错误是既有问题，与你无关）。
- 最后用简短中文汇报：每个 Task 的 commit sha、测试输出关键行、偏离计划的地方。
