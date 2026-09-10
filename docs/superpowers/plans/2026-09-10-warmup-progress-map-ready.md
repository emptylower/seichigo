# 加载进度卡片改为「地图可用即完成」

## 背景

`/map` 左上角的预热进度卡片（`components/map/MapLoadingProgress.tsx`，由 `features/map/anitabi/AnitabiMapLayout.tsx:328` 渲染）是真实进度，但它汇报的是**全量预热完成度**，而不是「地图能不能用了」。

权重定义在 `features/map/anitabi/shared.ts:43`：

| 任务 | 权重 | 实际在等什么 |
|---|---|---|
| `map` | 20 | 地图实例 + 首批瓦片 |
| `cards` | 30 | 侧栏作品卡片列表 |
| `details` | **35** | 6 个 preload chunk 全下完（约 2.5MB 点位数据） |
| `images` | **20** | 封面图逐张预取完 |

`details` + `images` 占 55%，但这两件事跟用户能否拖动/缩放/点选地图无关。实测（生产环境预热后）点位数据要到 **9.5 秒**才下完，进度条就一路爬到那时才满 —— 地图其实 2–3 秒就能用了。结果是如实汇报了一件用户不该关心的事，让站点显得比实际慢。

对标站 anitabi 后台同样在下 2.7MB 点位数据（实测 9.2 秒下完），但**不展示这个过程**。

本项目既有原则也一致：内部机制（质量门控/阶段/补齐报告）只进服务端与日志，C 端只看结果。

## 要做的事

**只改「进度指示器反映什么」，不要改任何实际加载逻辑、顺序或并发度。**

1. 用户可见的进度卡片改为只跟 `map` + `cards` 两个任务的完成度；这两个跑完就判定完成、卡片按现有的 400ms 收尾动画消失。
2. `details` 与 `images` **照常在后台继续跑**，只是不再计入可见进度、不再让卡片停留。
3. **内部指标口径不变**：`warmupMetricRef` 里的各项（`last_progress_*`、`progress_regression_blocked`、四任务各自 percent 等）继续按原来的四任务模型记录并上报，服务端/日志侧看到的东西不变。也就是说「内部四任务进度」与「对外可见进度」要拆成两个概念。
4. 现有的单调不回退保护（`updateWarmupTask` 里 incoming < current 时不回退并计数）要保留。
5. complete 模式的 `iconPreppingActive`（`AnitabiMapLayout.tsx:138`，强制显示 99%）保持现有行为不变——那是另一条独立的图标准备提示。
6. **顺带清理（可选，但不得改变行为）**：`warmupUiBlocking` / `warmupBlockingUiRef` 这套状态目前是死代码——`useAnitabiWarmup.ts:339` 会把它置为 `!background`，但 `AnitabiMapLayout.tsx:457` 把 `warmupOverlay` 硬编码成 `null`，阻塞遮罩从不渲染。可以删掉这条死链路；如果删除会牵连过多，就原样保留并加注释说明它不生效，**不要**顺手把遮罩接回去。

## 验收

- 新增测试：`map` 与 `cards` 均达 100 而 `details`/`images` 仍在进行时，**可见进度为 100 且卡片进入收尾**。
- 新增测试：`details`/`images` 的后台推进**不影响**可见进度（不会把已完成的卡片重新拉回未完成）。
- 新增测试：内部四任务指标仍按原模型记录（`warmupMetricRef` 的关键字段在 details/images 推进时仍会更新）。
- 回归：单调不回退保护仍生效；complete 模式 `iconPreppingActive` 的 99% 行为不变。
- 实际加载行为零变化：preload chunk 的下载数量、并发度、图片预取队列长度都不许动（可用现有测试保证）。
- `npm run typecheck` 与 `npm test`（含 check-line-budget）全绿。

## 约束

- 分支 `perf/map-integration`，worktree `/Users/mac/Desktop/seichigo-wt-map-b`。只加新提交，不要 rebase。
- 禁止 `git push`、禁止合并到 main、禁止任何部署命令，不要跑 `npm run build`。
- 不要碰 `lib/anitabi/**`（本次无关，那边刚做完边缘缓存改动）。
- 完成后用简短中文汇报：改了哪些文件、可见进度与内部指标是怎么拆开的、测试结果。
