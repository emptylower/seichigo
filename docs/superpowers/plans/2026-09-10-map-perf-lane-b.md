# 地图页性能优化 — Lane B（地图启动顺序 / 底图）

## 背景与实测证据

2026-09-10 用 Playwright 实测 `https://seichigo.com/map` 与对标站 `https://www.anitabi.cn/map`（同网络、日本出口）：

| 指标 | anitabi | seichigo |
|---|---|---|
| TTFB / FCP | 648ms / 2400ms | 1236ms / 2628ms |
| **底图首块瓦片到达** | **2910ms** | **4312ms** |
| 底图字节（z5 九块） | 0.14 MB | **0.99 MB** |

用户主观感受：anitabi 一两秒出图，我们要 5–10 秒。

本 Lane 负责「地图什么时候开始建」和「底图有多重」两件事。服务端数据缓存与图片变体由 **Lane A** 在另一个 worktree 并行处理，见下面「文件归属」。

---

## 任务 1（P0）：把底图启动提到最前，把预取和诊断推后

### 问题：启动顺序倒置

实测 waterfall：

```
1246ms  第一个 _next/static JS
1686ms  maplibre 主 chunk (264KB) 开始下载
2009ms  所有 JS 就绪
────────── 这里空了 1.6 秒 ──────────
2120ms  5 个 /api/anitabi/image-render 封面预取发出
2122ms  /api/map-image-diagnostics/config 发出（自身耗时 2570ms）
3662ms  ← maptiler style.json 才发出，地图这时候才开始建
4312ms  第一块 .pbf 瓦片
```

JS 在 2.0s 就绪，地图 3.66s 才开始构造。中间 1.6 秒被封面预取和诊断配置请求占掉了 —— 这两件事都不该排在底图前面。

### 根因位置

- **诊断配置**：`features/map/anitabi/useAnitabiMapController.ts:255` 的 `void fetch('/api/map-image-diagnostics/config', { method: 'GET' })`。
- **封面/点位图预取**：`features/map/anitabi/useAnitabiSelection.ts:194 / 215 / 216` 的 `warmPointImages(...)` 与 `prefetchImageUrl(...)`。
- **地图构造**：`features/map/anitabi/useMapStyleFailover.ts` 里 `useEffect` 中的 `new maplibregl.Map({...})`（70 行往后）。

### 要做的事

1. 确保 maplibre 的 `new maplibregl.Map()` 是 JS 就绪后**第一件**发起网络请求的事，不要被 bootstrap / 预取 / 诊断的 effect 排在前面。注意 effect 执行顺序与 `AnitabiMapPageClientImpl.tsx` 里各 hook 的调用次序有关。
2. `/api/map-image-diagnostics/config` 推迟到地图 `load` 事件之后，并包在 `requestIdleCallback`（带 setTimeout 回落）里。它是内部诊断，**绝不能挡首屏**。
3. 封面 / 点位图预取（`warmPointImages`、`prefetchImageUrl`）同样推迟到地图 `load` 之后再启动。
4. 保留现有的 `mapImageDiagManagerRef.recordAnchor(...)` 埋点语义（`map_shell_ready`、`bootstrap_ready` 等锚点），只是改触发时机，不要删指标。
5. 诊断配置没拿到时，`createMapImageDiagManager` 要能用默认配置先跑起来，不要因为配置迟到就丢埋点。

### 目标

`style.json` 发出时间 **3.66s → ~2.1s**，第一块瓦片 4.31s → ~2.8s。

---

## 任务 2（P1）：底图瘦身

### 问题一：瓦片太重

我们用 MapTiler `streets-v2` 样式 + `tiles/v3`（完整 OpenMapTiles schema）。z5 九块瓦片实测 **0.99MB**；anitabi 同样九块只有 **0.14MB**，7 倍差距。原因是 v3 带了全部 POI / 建筑 / 地形图层，而我们的样式根本不画这些。

### 问题二：三跳串行

```
3662ms  api.maptiler.com/maps/streets-v2/style.json
3772ms  api.maptiler.com/maps/streets-v2/sprite.png (92KB)
3895ms  api.maptiler.com/tiles/v3/tiles.json     ← 第二跳
3896ms  api.maptiler.com/maps/streets-v2/sprite.json
4312ms  api.maptiler.com/tiles/v3/5/28/13.pbf    ← 第三跳
```

`style.json → tiles.json → pbf` 三次串行 RTT。anitabi 把样式内联在 JS 里，直接打瓦片，省掉两跳。

### 涉及文件

- `features/map/anitabi/media.ts` — `buildMapStyleCandidate()`（456 行附近，maptiler 分支）、`buildFallbackRasterStyle()`（389 行附近）、`getMapStyleCandidates()`
- `features/map/anitabi/shared.ts` — `MAP_STYLE_PROVIDER_ORDER` / `MAP_VECTOR_ENABLED` / `MAPTILER_KEY` 等开关（50–54 行）
- `features/map/anitabi/useMapStyleFailover.ts` — 样式应用与 failover

### 要做的事

1. **内联样式省一跳**：不再指向 `https://api.maptiler.com/maps/streets-v2/style.json`，改成把一份自定义 StyleSpecification 对象内联进 bundle，`sources.openmaptiles` 直接写 `tiles: [...]` 数组（而不是 `url:` 指向 tiles.json），这样 `style.json` 和 `tiles.json` 两跳都省掉，JS 一就绪就能直接打瓦片。
2. **精简图层**：自定义样式只保留 land / water / road / boundary / place-label 这几类，砍掉 POI、建筑、地形、等高线等我们根本不渲染的图层。目标把 z5 九块从 0.99MB 降到 0.2–0.3MB 量级。
3. **sprite / glyphs**：内联样式仍需 sprite 和 glyphs URL。精简后 sprite 里用不到的图标也可以裁（92KB 的 sprite.png 能明显变小）；glyphs 保持能正常显示中日文标签。
4. **保住现有 failover 机制**：`MAP_STYLE_PROVIDER_ORDER`（maptiler → mapbox → stadia → raster）、`MAP_STYLE_FAILOVER_TIMEOUT_MS`（9000ms）、错误突发阈值、`styleimagemissing` 兜底这一整套**必须继续工作**。新样式只是替换 maptiler 分支产出的 style，不改 failover 骨架。
5. satellite 模式的行为不变。

### 验收

- z5 九块瓦片总字节明显下降（在汇报里给出改造前后实测数字）。
- 地图视觉上仍然可用：水域、陆地、道路、行政边界、城市标签都在，中日文标签正常。
- 把 maptiler key 置空 / 让 maptiler 请求失败时，仍能按顺序 failover 到下一个 provider 最终落到 raster，不白屏。
- `tests/map/` 下与样式、failover 相关的测试全绿。

---

## 全局约束

### 文件归属（Lane A 正在另一个 worktree 并行改这些，**绝对不要碰**）

- `lib/anitabi/imageNormalize.ts`
- `lib/anitabi/imageMirrorVariants.ts`
- `lib/anitabi/imageProxy.ts`
- `lib/anitabi/handlers/**`
- `lib/anitabi/read.ts`
- `app/api/anitabi/preload/**`
- `components/map/utils/spriteRenderer.ts`
- `components/map/utils/coverAvatarLoader.ts`
- `features/map/anitabi/useCompleteMode.ts`

如果任务确实需要改上面任一文件，**不要改，在最终汇报里写清楚需要什么改动**，由人去协调。

### 其他

- 当前分支 `perf/map-boot-basemap`，worktree `/Users/mac/Desktop/seichigo-wt-map-b`。
- **AdSense / GTM 不在本次范围内**，用户明确说不用管，不要动广告和分析脚本。
- 可以在本分支 `git commit`（小步、原子），但**禁止 `git push`、禁止合并到 main、禁止任何部署命令**（`wrangler deploy` / `opennextjs-cloudflare deploy` / `npm run cf:deploy` 一律不许跑）。
- 需要起本地 dev server 时用端口 **3457**，不要用 3001（被别的服务占用）；停进程按 pid 停，不要按端口 kill。
- `NEXT_PUBLIC_*` 环境变量必须**字面量**访问 `process.env.NEXT_PUBLIC_XXX` 才会被 Next 内联，`process.env[name]` 在浏览器里恒为空 —— 这个坑本仓库踩过，务必遵守。
- 无头 Chromium 测地图页要加 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`，否则 MapLibre 拿不到 WebGL 直接进错误边界。
- 每个文件有行数预算，`npm test` 里的 `scripts/check-line-budget.mjs` 会卡；文件写长了要拆模块而不是放宽预算。

### 完成标准（三条都必须绿）

```bash
npm run typecheck
npm test
npx vitest run tests/map
```

### 汇报

完成后用简短中文汇报：改了哪些文件、底图瓦片字节改造前后的实测数字、style.json/首块瓦片发出时间的变化、测试结果、以及任何你判断需要人来决策的点。
