# 执行简报：点位分享 Track B（前端）

计划文件（必读，所有代码、测试、命令都在里面）：`docs/superpowers/plans/2026-09-08-point-share-card-and-short-link.md`
设计文档（背景）：`docs/superpowers/specs/2026-09-08-point-share-card-and-short-link-design.md`

## 要做的

按计划文件里 **Task B1 到 B9** 逐个执行，顺序不能变。每个 Task 按它的 Step 走：先写失败测试、跑一次确认失败、写实现、跑通过、commit。commit message 用计划里给的。

`lib/share/types.ts` 已经存在（Track A 的 A1 产物），**只 import，不要改它**。

## 约束

- 只能动计划 File Structure 里标为 Track B 的文件。**不要碰任何 Track A 的文件**（`lib/share/**` 除 import 外、`app/api/share/**`、`app/s/**`、`prisma/**`、`lib/anitabi/share.ts`、`app/(site)/map/page.tsx`、`app/ja/map/page.tsx`、`app/en/map/page.tsx`、`app/ja/posts/**`、`app/en/posts/**`、`app/ja/anime/**`、`app/en/anime/**`、`app/ja/city/**`、`app/en/city/**`、`package.json`）。
- 你在一个独立的 git worktree 里，当前分支 `feat/point-share-card-b`。可以 `git commit`（每个 Task 一次），**不要 `git push`，不要切分支，不要 merge**。
- `features/map/anitabi/useAnitabiMapController.ts` 有行数预算限制（`line-budget.allowlist.json` 里是 883 行，当前正好 883），计划里写了怎么在不增加行数的前提下改，严格照做，改完跑 `wc -l` 核对。
- 不要执行 `wrangler`、`opennextjs-cloudflare`、任何 deploy/upload 命令。B9 的浏览器冒烟需要 `next build` + `next start -p 3457`，按计划里的命令做，做完必须停掉 server（按 pid kill，不要按端口 kill）。
- 如果某个 Step 的测试跑不过且计划里的代码明显有错，修到通过，并在最后汇报里写明改了什么、为什么。不要跳过测试。

## 完成标准

- B1 到 B9 全部 commit。
- `npx tsc -p tsconfig.app.json --noEmit` 0 错误。
- `npm test` 全绿（`tests/lib/prisma-client-lifecycle.test.ts` 的 3 个 typecheck:tests 错误是既有问题，与你无关）。
- 最后用简短中文汇报：每个 Task 的 commit sha、测试输出关键行、冒烟结果、偏离计划的地方。
