# 把 main 合入 feat/plan-agent-m1（2026-09-03）

目标：在这个 worktree（分支 `feat/plan-agent-m1`）里，把当前全部未提交改动按逻辑分组提交，然后 `git merge main` 并解决冲突，最后跑全量验证并修好合并引入的任何破坏。**不要 push**，**不要 rebase**，**绝对不要用 `git stash`（stash 栈与其他 worktree 共享，会弹掉别人的东西）**，不要 `git checkout -- <file>` 丢弃改动，不要跑数据库迁移，不要部署。

## 背景
- 分叉点 `f87edc8`（2026-08-26）。本分支比 main 多 45 个提交（计划页重写、plan agent 各轮修复）+ 169 个未提交文件（第四到第六轮修复、模型接入面板、地点库等）。
- main 比本分支多 20 个提交（2026-08-31 到 09-01）：anitabi bulk 数据包同步管线、出口探测器、bgm 封面 URL 归一、`df23b4f` "image.anitabi.cn 直连 403 统一走投递域"（改了 `lib/anitabi/imageProxy.ts`、`features/map/anitabi/media.ts`、`features/map/anitabi/DetailPanel.tsx`、`ExplorerPanelContent.tsx`、`components/resources/RouteDirectory.tsx`、`app/(authed)/me/favorites/ui.tsx` 与相关测试）。
- 已知必然冲突：`lib/anitabi/imageProxy.ts`——本分支第六轮 E2 把 `buildProxyImageUrl`/`buildRetryProxyUrl` 改成对 `url` 参数 `encodeURIComponent` 双重编码（配合 `lib/anitabi/handlers/imageServeTarget.ts` 的服务端解析）；main 的 `df23b4f` 在同文件加了直连走投递域的逻辑。**两者都要保留**。
- 可能冲突：`tests/map/thumbnailUrl.test.ts`、`tests/anitabi/imageProxy.bgmLadder.test.ts`、`tests/map/anitabiMedia.test.tsx`、`tests/map/useAnitabiDerivedState.test.tsx`（main 改了直连断言，本分支改了双重编码断言）；`.env.example`（两边都加了注释）；`lib/anitabi/imageNormalize.ts`（main 的 `8588f5b` 改 bgm 封面归一，本分支第六轮 A1 改点位变体）。

## 第一步：分组提交当前未提交改动（在 merge 之前）
先 `git status --short` 通读。按下面分组各提交一次（`git add` 精确列文件，不要 `git add -A` 把 `scratch/`、`x`、日志类文件带进去；`scratch/` 整个目录不要提交）：
1. `feat(googlePlaces): 地点库 ExternalPlace + 照片多序号 + 点位 Google 兜底图`：`lib/googlePlaces/**`、`app/api/google/**`、`prisma/schema.prisma`、`prisma/migrations/20260902*/**`、`tests/googlePlaces/**`
2. `feat(planAgent): M4 编排/门控/补齐层、去重、用餐归一、餐厅必达、补齐续跑`：`lib/planAgent/**`、`lib/tripPlan/**`、`tests/planAgent/**`、`tests/tripPlan/**`
3. `feat(plan-ui): 侧栏聊天布局、图片稳定性、缩略图变体`：`app/(authed)/plan/**`、`components/map/**`、`tests/plan/**`、`tests/map/**`
4. `fix(anitabi): 点位图变体根因、镜像投递域与清理、代理 url 双重解码、诊断状态码`：`lib/anitabi/**`、`lib/mapImageDiag/**`、`app/api/admin/anitabi/**`、`workers/anitabi-mirror/**`、`tests/anitabi/**`、`line-budget.allowlist.json`、`docs/api.md`、`docs/runbooks/**`
5. `feat(llm): 自定义 LLM 供应商面板与接管`：`lib/llm/**`、`app/api/admin/llm/**`、`app/(authed)/admin/llm/**`、`components/admin/Sidebar.tsx`、`lib/translation/**`、`prisma/migrations/20260903000000_add_llm_provider/**`、`tests/llm/**`、`tests/admin/**`、`tests/translation/**`、`.env.example`
6. `docs: 2026-09-02/03 各轮设计与实施计划`：`docs/superpowers/**`
7. 其余零散文件（如 `lib/db/**`、`scripts/**`、`.github/**` 的删除等）按内容归入最贴近的一组，或单独 `chore:` 提交。
每条提交信息末尾都加这两行：
```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011b9YCwCgPzJ7hf5hoZiLkx
```
提交完 `git status --short` 应只剩 `scratch/` 一类不该入库的东西（`x` 文件若存在直接删除）。

## 第二步：`git merge main --no-ff -m "merge: 合入 main（anitabi bulk 同步与投递域修复）"`
- 冲突逐个解决，原则：**两边的功能都保留**。`imageProxy.ts` 里：直连候选走投递域（main）+ 代理 `url` 参数双重编码（本分支）；测试断言按合并后的行为改（直连 URL 是 `img-tc.anitabi.cn`，代理 URL 的 `url` 参数解码两次后等于目标）。
- `imageNormalize.ts`：保留 main 的 bgm 封面归一改动，同时保留本分支的 `isAnitabiPointImagePath` 与点位变体规则（point/point-preview → `w=640&q=80`，point-thumbnail → `plan=h160`，无 h320）。
- 解决完 `git add` 冲突文件并 `git commit`（沿用 merge 信息 + 上面两行 trailer）。

## 第三步：验证并修复合并引入的破坏
依次跑：`npx vitest run`（全量）、`npx vitest run workers/anitabi-mirror/src/__tests__`、`npx tsc --noEmit`、`npm run typecheck:tests`（只允许 `tests/lib/prisma-client-lifecycle.test.ts` 的 3 条存量）、`node scripts/check-line-budget.mjs`。任何失败先判断是合并冲突解决不当还是两边语义冲突，修到全绿；修复作为单独一次 `fix(merge): …` 提交。
特别复核（写进汇报）：
- main 的 bulk 同步：`tests/anitabi/**` 里 bulk/sync 相关测试全过；
- main 的投递域直连：`tests/map/anitabiMedia.test.tsx`、`thumbnailUrl.test.ts` 过；
- 本分支的第六轮：`tests/anitabi/imageServeTarget.test.ts`、`imageNormalize.test.ts`、`imageMirrorVariants.test.ts`、`mirror-*.test.ts`、`tests/map/resilient-map-image*.test.tsx`、`tests/plan/dayCards.test.tsx` 过；
- 本分支的第四五轮与模型接入：`tests/planAgent/**`、`tests/googlePlaces/**`、`tests/llm/**`、`tests/translation/**`、`tests/admin/**` 过。

## 汇报
简短中文：提交列表（hash + 标题）、冲突文件与解决方式、各项验证结果、`git log --oneline main..HEAD | wc -l` 与 `git log --oneline HEAD..main | wc -l`（后者应为 0）。
