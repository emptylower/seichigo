# complete 模式精灵表：改为视口驱动 + 字节预算

## 问题（生产实测证据）

上线后 `/map` 桌面端总字节 7.64MB，其中 **5.67MB（74%）是 4 张 anitabi ptheme 精灵表**：

```
 7497ms  1889KB  405785_100_76.webp
10110ms  1258KB  262897_100_76.webp
12593ms  1296KB  431767_100_76.webp
15084ms  1094KB  207195_100_76.webp
```

移动端实测 **0 张 / 总字节 2.93MB**（complete 模式只在桌面默认开启），所以问题只在桌面端。

根因在 `features/map/anitabi/useCompleteMode.ts:753` 的候选选择：

```js
const spriteCandidates = bangumiDataList              // 全量预载数据集（约 1500 番剧），无视口过滤
  .filter((bangumi) => isValidTheme(bangumi.theme))
  .sort((a, b) => b.points.length - a.points.length)  // 按点位总数降序 → 专挑最大的表
  .slice(0, COMPLETE_MODE_SPRITE_MAX_BANGUMI)         // 220
```

`bangumiDataList` 来自 `warmPointIndexByBangumiIdRef`（整个预载数据集，见同文件 643 行的循环），**没有任何视口过滤**；再按点位总数降序，等于精准挑出数据集里精灵表最大的那批下载，与屏幕上实际有什么无关。

上限 220 之所以只落地 4 张，是被 `COMPLETE_MODE_SPRITE_BUDGET_MS = 9000` 的**时间预算**截断的 —— 意味着**网速越快下得越多，字节量不可控**。

## 要做的事

### 1. 候选改为视口驱动

- 只选**在当前视口（可带一圈 padding）内确实有点位**的番剧。
- 排序键从「点位总数」换成**视口内点位数降序**（同数量时可用距视口中心距离兜底）——目标是"先下屏上最有用的"，而不是"先下最大的"。
- 参考现成实现：同文件 419 行 `completePointImageLoaderRef.current.updateViewport(loaderInput)` 与 211/691 行 `coverAvatarLoaderRef.current.updateViewport(coverCandidates)` 已经是视口驱动模式，沿用同一套口径，不要另起一套。

### 2. 加字节预算（时间预算之外）

- 现有 `COMPLETE_MODE_SPRITE_BUDGET_MS = 9000` 保留。
- **新增**一个累计字节预算常量（建议 1.5MB 量级，放 `shared.ts` 与其它 COMPLETE_MODE_* 常量并列）。
- 预算必须在**发起下载之前**用估算值判定，保证可预测：实测每格约 **1891 B**（`405785_100_76.webp` = 1,934,006 B / 1023 格），用 `points.length × 每格字节` 估算该番剧的表大小；累计超预算就停止取更多候选。把「每格字节」定义成带注释的常量，注明是实测值与出处。
- 单张表估算若本身就超预算，跳过它（该番剧的点位回落圆点），不要因为一张巨表把预算一次吃光。

### 3. 视口变化时增量补齐

- 地图移动后（`syncCompleteMode` 已在 moveend 链路里跑，见 503/555/681 行）应能为**新进入视口**的番剧补下精灵表，且**不重复下载**已加载的（现有 `map.hasImage(imageId)` 判断保留）。
- 每次补齐同样受字节预算约束（预算按「本次补齐」计，不要做成全局一次性额度，否则用户平移几次之后就再也不加载了）。

### 4. 保持不变

- `cutSpriteSheet` 失败时该番剧回落圆点的行为（现有 try/catch）。
- `yieldToMainThread` 让出主线程的节奏、abort 处理。
- `warmupMetricRef` 现有字段（`complete_sprite_cut_total/done/budget_hit`）继续上报；**新增**字节预算命中与跳过巨表的计数，便于线上观察。

## 验收

- 单测：候选只包含在视口内有点位的番剧；视口外的番剧不入选。
- 单测：排序按视口内点位数降序（不是点位总数）——构造一个「总数大但视口内少」与「总数小但视口内多」的用例，断言后者优先。
- 单测：累计估算字节超预算后停止取更多候选，且已取的不受影响。
- 单测：单张表估算超预算时被跳过，而不是吃光预算。
- 单测：视口变化后新番剧能被补齐，已加载的不重复下载。
- 回归：现有 complete 模式测试（`tests/map/completeMode.integration.test.tsx`、`completeModeLayers.test.ts`、`completeModeDemand.test.ts`、`completeModeCoverPolicy.test.ts`）全绿。
- `npm run typecheck` 与 `npm test`（含 check-line-budget）全绿。

## 约束

- 分支：从当前 `main` 新建 `perf/sprite-viewport-budget`（**不要**在 `perf/map-integration` 上继续，那个已合并进 main 并上线）。worktree `/Users/mac/Desktop/seichigo-wt-map-b`——先 `git checkout main && git pull` 再开新分支。
- 禁止 `git push`、禁止合并到 main、禁止任何部署命令，不要跑 `npm run build`。
- 不要碰 `lib/anitabi/**`、`features/map/anitabi/basemapStyle.ts`、`useWarmupProgressState.ts`（本次无关）。
- 不要改点位数据的预载逻辑（chunk 数量、并发度）——只改精灵表的候选选择与预算。
- 完成后用简短中文汇报：候选口径怎么定的、字节预算取值与依据、视口补齐怎么保证不重复、测试结果。
