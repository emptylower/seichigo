# Agent 最终产物地图容错修复委托

## 执行上下文

- 工作目录：`/Users/mac/Desktop/seichigo-worktrees/plan-agent-m1`
- 分支：`feat/plan-agent-m1`
- 这是计划页最终产物中的 inline 地图，不是主 `/map` 页面。
- 当前 worktree 在委托开始前只有预存在的未跟踪 `scratch/`，不要修改、删除或覆盖它。
- 不要提交 git commit；完成后保留工作区改动并报告文件、测试和残余风险。

## 已复现事实

预览版本 `6e60a215-0c55-4ff4-9970-47c21fa1617b` 的计划页：

`https://6e60a215-seichigo.2921419306.workers.dev/plan/cmthwli8c000385xydnz9hmoy`

页面通过 `DayCards` 的“地图”按钮渲染 `RoutePreviewMap`。MapTiler 账户重新激活后再次测试：

- `https://api.maptiler.com/maps/dataviz/style.json?...` 返回 `200`。
- `tiles/v3/tiles.json`、`sprite.json`、`sprite.png` 都返回 `200`。
- 地图显示了 MapTiler 底图、实际道路路线和序号标记。

账户恢复解释了本次灰底现象，但当前代码仍有同样的单点故障：账户再次休眠、key 被撤销、配额或服务临时不可用时，地图会重新永久灰屏。

此前账户休眠期间同一个预览版本的浏览器网络和控制台记录是：

- `GET https://api.maptiler.com/maps/dataviz/style.json?key=...` 返回 `403 Invalid key`。
- MapLibre 创建了 canvas，但 `load` 没有成功完成。
- `RoutePreviewMap` 的容器背景为 Tailwind `bg-gray-100`，所以用户看到的是灰色底面。

路线接口不是这次灰屏的根因。恢复后的同一计划中，3 个请求全部 `200`，观测耗时约为 2.26 秒、3.61 秒、3.64 秒。`DayCards` 已经后台并行预取各天路线，不能让 UI 等待所有天数后才渲染底图；实际道路路线应继续异步覆盖到地图上。

## 当前实现定位

主要文件：

- `components/route/RoutePreviewMap.tsx`
- `app/(authed)/plan/[id]/components/DayCards.tsx`
- `features/map/anitabi/media.ts`
- `features/map/anitabi/useMapStyleFailover.ts`

`RoutePreviewMap.tsx` 当前行为：

1. `getMapStyleUrl()` 只要 `NEXT_PUBLIC_MAPTILER_KEY` 非空，就直接返回 MapTiler `dataviz` style URL；只有 key 缺失时才使用 OSM raster 对象。
2. 没有 `map.on('error')` 的 provider failover，也没有样式加载超时保护。
3. 自定义 GeoJSON source、路线图层、示意线、跨城跳转标签、序号 marker 和 `fitBounds` 主要在 `map.on('load')` 中同步。
4. `map.setStyle()` 后需要重新同步这些自定义资源，否则切换 fallback 后只会有底图而没有路线和点位。
5. 主 `/map` 逻辑在 `features/map/anitabi/media.ts` 与 `useMapStyleFailover.ts` 已有 provider candidates、超时和 OSM fallback，但该 mega-hook 不应直接耦合到 `RoutePreviewMap`。

## 需要实现的修复

请做最小、生产可用的改动，范围限于 agent 最终产物地图及必要的纯 helper/test：

1. 保持当前正常路径：配置有效时 MapTiler 仍是首选，实际道路路线、示意线、编号点位、`interactive={false}` 行为和现有视觉表现不能回归。
2. 为 `RoutePreviewMap` 增加 style provider candidates/failover：
   - 按现有配置顺序优先尝试 MapTiler；如项目当前 provider order 暗含其他可用 provider，可复用纯候选构建逻辑。
   - OSM raster 必须是无 key 依赖的最终 fallback。
   - 对 MapLibre style/资源错误中代表认证或服务不可用的情形及时切换：HTTP 401、403、429、invalid/unauthorized API key、quota、rate limit 等。
   - 初始 style 长时间不触发成功加载时，也要按 `NEXT_PUBLIC_MAP_STYLE_FAILOVER_TIMEOUT_MS`（与现有地图默认值保持一致；必要时提供合理默认值）切换，而不是永久灰屏。
3. fallback 使用 `setStyle` 后，必须在新 style 加载后重新同步：
   - route geometry GeoJSON
   - 无 geometry 时的 schematic/jump fallback 线
   - jump label
   - numbered markers
   - bounds/fitBounds
   - 最新 props，而不是只使用初始闭包值
4. 避免重复 marker、过期 timer、多个错误事件造成的 provider 竞态，以及组件卸载后的监听器/定时器泄漏。
5. 现有 `DayCards` 路线异步加载保持不变：不要等待所有天数才显示 base map；路线成功时覆盖真实道路线，失败时保留已有示意线/重试行为。
6. 优先抽取或复用 `features/map/anitabi/media.ts` 中与 mega-hook 无关的纯 style candidate/fallback helper；如果抽取会扩大风险，可在 `RoutePreviewMap` 内实现小型等价 helper。不要重构无关的 `/map` 页面。
7. 增加聚焦测试，覆盖能覆盖的纯候选/fallback 和 failover 状态逻辑；遵守严格 TypeScript、现有 Vitest 分层和 800 行文件预算。不要用 `as any`、`@ts-ignore` 或跳过类型检查来规避问题。

## 验收标准

- MapTiler key 有效时，agent 计划页地图仍使用 MapTiler，并能显示实际道路路线与编号点位。
- 模拟/单测 MapTiler style 403、401、429 或超时后，地图能在可接受时间内切换 OSM raster，不再无限灰底。
- fallback 后仍有路线图层、示意线/标签（按数据情况）、编号 marker 和正确视野。
- 在 `interactive={false}` 的 DayCards inline 场景下页面滚动手势没有回归。
- 路线 geometry 请求仍是异步叠加，不阻塞底图首次渲染。
- 运行并报告：
  - `npm run typecheck:app`
  - 与改动相关的窄范围 Vitest（至少现有 plan/route geometry 相关测试；如新增测试也运行）
- 最终报告列出实际修改文件、测试命令及结果、未解决限制；不要提交 commit。

## 参考提交与背景

- `71486ce` 已记录路线请求的缓存、inflight 去重和三天预取，以及当时 MapTiler key 对所有 referer 返回 403 的环境问题。
- 该提交不是本任务的充分修复：本任务要补齐 agent `RoutePreviewMap` 在 provider 失效时的运行时容错。

## 实现后复核追加项

实现时特别复核 MapLibre 事件时序：`load` 只保证地图实例的首次完整加载，`setStyle()` 后不应依赖再次触发 `load`。若 `styledata` 回调中的 `isStyleLoaded()` 在新样式首次事件时仍为 false，必须监听可靠的每次样式完成事件（例如 `style.load`，或等价的可验证机制），确保 fallback 后一定重新挂载自定义 source/layer、路线、标签、marker 和视野。补充/调整 focused test 或可测试的状态逻辑，避免只在单测中覆盖状态机而遗漏这个运行时事件时序。
