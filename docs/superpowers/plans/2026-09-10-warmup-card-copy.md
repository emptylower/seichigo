# 加载卡片文案：只反映 map/cards，去掉内部黑话

## 背景

上一个提交（`f319ac31`）已把**可见百分比**改为只跟 `map`+`cards`，卡片停留从 32 秒降到约 2.1–2.5 秒（生产实测）。但**说明文字没跟着改**，导致百分比与文字对不上，并且仍在向 C 端暴露内部机制。

生产实测的卡片文本采样：

```
4480ms  正在预加载地图数据 0%  初始化地图底图
6007ms  正在预加载地图数据 60% 点位分块 (0/8)      ← 百分比是 map+cards，文字却是后台任务
6085ms  正在预加载地图数据 60% 点位分块 (2/8) · 9865
```

`点位分块 (n/8)`、`图片预热 (n/116)` 是后台预取的内部进度，用户既不关心也无法据此判断"还要等多久"。本项目既有原则：内部机制（质量门控/阶段/补齐报告）只进服务端与日志，C 端只看结果。

## 要做的事

**只改文案与文案来源，不要改任何进度计算、任务权重、加载逻辑。**

1. **卡片说明文字只由 `map` / `cards` 两个任务驱动。** `details` / `images` 的 detail 文本不再进入可见卡片。
2. **`warmupMetricRef.last_progress_detail` 等内部指标保持现状**，继续记录四任务的细粒度文本（含 `点位分块 (n/8)`、`图片预热 (n/116)`），服务端与日志口径零变化。
3. **顺带把面向用户的文案去黑话化**（`features/map/anitabi/shared.ts`，**zh / en / ja 三种语言都要改**）：
   - `preloadTitle` 现为 `正在预加载地图数据` —— "预加载"是实现细节，改成用户视角的表述（如「地图加载中」/ `Loading map` / 「地図を読み込み中」）。
   - `preloadCards` 现为 `四板块卡片` —— "四板块"是纯内部命名，改成用户能懂的（如「载入作品列表」/ `Loading titles` / 「作品リストを読み込み中」）。
   - `preloadMapPreparing` / `preloadMapTiles` / `preloadMapDone` 现有表述基本可用，按整体语气统一即可。
   - `preloadDetails`（点位分块）/ `preloadImages`（图片预热）**保留 key 不删**——它们仍用于内部指标文本；只是不再出现在卡片上。
   - en / ja 的对应文案同步，不要只改中文。
4. complete 模式的 `preloadIconsTitle` / `preloadIconsDetail`（图标准备提示）是另一条独立链路，行为与文案保持不变。

## 验收

- 新增测试：`details` / `images` 任务推进时，**卡片可见 detail 文本不变**（不出现 `点位分块` / `图片预热` 字样）。
- 新增测试：`map` / `cards` 推进时卡片文本随之更新。
- 新增测试：`warmupMetricRef.last_progress_detail` 在 details/images 推进时**仍然**记录细粒度文本（内部口径未被削弱）。
- 三种语言的 label 集合 key 完全一致（不要漏 en/ja），可用现有 i18n 一致性测试或新增断言保证。
- 上一提交的可见百分比行为（map+cards 到 100 即收尾、后台推进不回拉）回归不破。
- `npm run typecheck` 与 `npm test`（含 check-line-budget）全绿。

## 约束

- 分支 `perf/map-integration`，worktree `/Users/mac/Desktop/seichigo-wt-map-b`。只加新提交，不要 rebase。
- 禁止 `git push`、禁止合并到 main、禁止任何部署命令，不要跑 `npm run build`。
- 不要碰 `lib/anitabi/**`。
- 不要改任务权重、进度计算、加载顺序与并发度。
- 完成后用简短中文汇报：最终选用的三语文案、文字来源怎么限制到 map/cards、测试结果。
