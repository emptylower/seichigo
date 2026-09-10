# 关闭封面 sprite sheet 路径（P0-1 落地后它变成净负优化）

## 背景：实测推翻了前提

2026-09-10 全量生成实测：

```
1520 图标 / 39×39 网格 / sheet 2,697,698 B (2.63MB) + atlas 24,262 B
```

`components/map/utils/coverSpriteSource.ts` 的命中路径是「一次 atlas 请求 + 一次 sheet 请求」，**整张表无条件下载**，没有分片。

盈亏平衡点：`2,697,698 ÷ 8,806（单张 h160 封面字节）≈ 306 个图标`。即一次会话需要用到 306 个以上**不同**番剧封面，sprite sheet 才比逐张划算。

实际用量（生产瀑布实测）：普通模式 22 张、complete 模式约 118 张。

| 场景 | 逐张 h160 | sprite sheet |
|---|---|---|
| 普通模式（22 张） | 190 KB | 2.63 MB（14× 差） |
| complete 模式（118 张） | 1.01 MB | 2.63 MB（2.6× 差） |

sprite sheet 的收益前提是「每张封面 325KB」。同一轮的任务 1 已把单张打到 8.6KB，前提不复存在。

## 要做的事

1. 在调用点把 sprite 路径关掉：`components/map/utils/coverAvatarLoader.ts:91` 处
   ```ts
   this.spriteSource = options.spriteSource === undefined ? <默认实例> : options.spriteSource
   ```
   把**默认值**改成关闭（即默认不启用 sprite source），保留 `options.spriteSource` 注入seam 不变，测试仍可显式注入替身。
2. **不要删除** `coverSpriteSource.ts`、`lib/anitabi/coverSpriteAtlas.ts`、`scripts/anitabi-cover-sprites.mts`、`app/api/anitabi/sprite/**` 及其测试 —— 代码是好的、有测试，只是当前不该启用。
3. 在关闭处写一段注释，把上面那张盈亏表和 306 的平衡点记下来，说明**重新启用的前提是先做分片**（按 viewport/zoom 只下需要的那批图标），否则灌表反而拉低性能。
4. `scripts/anitabi-cover-sprites.mts` 的文件头注释补一句：当前该表不在生产启用，灌桶前必须先确认分片方案，否则会退化。

## 验收

- 默认路径下不再发出 `/api/anitabi/sprite` 与 `/api/anitabi/sprite/sheet` 请求（加测试断言）。
- 显式注入 spriteSource 的既有测试仍然通过（注入 seam 未破坏）。
- `tests/map/coverAvatarLoader.test.ts`、`tests/map/coverSpriteSource.test.tsx`、`tests/anitabi/sprite-handlers.test.ts`、`tests/scripts/coverSpriteScript.test.ts` 全绿（必要时按新默认值调整断言，但不要削弱覆盖）。
- `npm run typecheck` 与 `npm test`（含 check-line-budget）全绿。

## 约束

- 分支 `perf/map-integration`，worktree `/Users/mac/Desktop/seichigo-wt-map-b`。只加新提交，不要 rebase。
- 禁止 `git push`、禁止合并到 main、禁止任何部署命令，不要跑 `npm run build`。
- 不要碰 `lib/anitabi/imageNormalize.ts` / `imageMirrorVariants.ts` / `preloadEdgeCache.ts` / `features/map/anitabi/basemapStyle.ts`（本次无关）。
- 完成后用简短中文汇报改动与测试结果。
