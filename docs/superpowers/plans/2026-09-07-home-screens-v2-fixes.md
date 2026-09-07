# 首页重做：预览走查修复（第一批）

日期：2026-09-07　分支：feat/home-screens-v2。前置文件 `2026-09-07-home-screens-v2.md` §0 的约束全部适用（不 commit、不改 lib/home/scripts/content/public/HomeHero*、数字全部真实、三语、行数预算）。完成标准同前：`npm run typecheck:app`、`node scripts/check-line-budget.mjs`、`npx vitest run tests/components/home tests/home tests/i18n tests/route`。

预览地址 https://home-seichigo.2921419306.workers.dev 走查发现以下问题，逐条修。

## F1 地图底图落到 OSM 栅格兜底（根因：客户端读不到 MapTiler key）

`components/route/mapStyleFailover.ts` 的 `readEnv(name)` 用 `process.env[name]` 动态取值，Next 只会内联**字面量**的 `process.env.NEXT_PUBLIC_*`，所以浏览器里 key 恒为空，永远落到 raster。改法：保留“调用时读取”的语义（测试要靠它切换 env），但把动态访问换成字面量：

```ts
function readEnv(name: EnvName): string {
  switch (name) {
    case 'NEXT_PUBLIC_MAPTILER_KEY': return String(process.env.NEXT_PUBLIC_MAPTILER_KEY || '').trim()
    case 'NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN': return String(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '').trim()
    case 'NEXT_PUBLIC_STADIA_MAPS_API_KEY': return String(process.env.NEXT_PUBLIC_STADIA_MAPS_API_KEY || '').trim()
    case 'NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER': return String(process.env.NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER || '').trim()
    case 'NEXT_PUBLIC_MAP_STYLE_FAILOVER_TIMEOUT_MS': return String(process.env.NEXT_PUBLIC_MAP_STYLE_FAILOVER_TIMEOUT_MS || '').trim()
  }
}
```

`EnvName` 是这五个字符串的联合类型；文件里其它 `readEnv(...)` 调用不变。`tests/route/route-preview-map-style.test.ts`必须继续通过（它们通过改 `process.env` 覆盖配置，字面量访问在 Node 里同样是运行时读取，所以不受影响）。

## F2 世界视角没有居中在日本

现象：`renderWorldCopies:false` 加上 zoom 1.2–1.8 时，整张世界比容器窄，MapLibre 无法把中心放到经度 140，画面被迫居中在非洲/欧洲，日本跑出画面。

改法（`components/home/HomeMapDatabase.tsx` + `homeMapDatabaseUtils.ts`）：

- `renderWorldCopies: true`；
- `zoomForWidth(width)` 改为：`Math.max(1.2, Math.log2(width / 256) + 0.08)`（世界宽度略大于容器，正好铺满且不出现第二份日本）；桌面 1150px 容器约 2.25；
- `center: [138, 28]`（日本略偏中上，下方留出东南亚与澳大利亚，左侧欧洲、右侧北美西岸都在画面内）；
- 点位 source 不变（世界副本只会在极窄容器时出现，可接受）。
- `HomeMapDatabase.test.tsx` 里 `renderWorldCopies === false` 的断言改为 `true`；`homeMapDatabaseUtils.test.ts` 的 `zoomForWidth` 用例按新公式改。

## F3 底图的地名文字没有隐藏

F1 修好后底图是 MapTiler `dataviz` 矢量样式，`load` 后隐藏所有 `symbol` 图层的逻辑要真正生效：遍历 `instance.getStyle().layers`，`type === 'symbol'` 的全部 `setLayoutProperty(id, 'visibility', 'none')`；同时把 `style.load` 也挂上（failover 切样式后重跑）。若 `getStyle()` 抛错或没有 layers（raster 兜底）静默跳过。测试里给 FakeMap 补 `getStyle()` 返回含一个 symbol 图层和一个 fill 图层的最小样式，断言只对 symbol 调了 `setLayoutProperty`。

## F4 城市标签没有出现

走查时 DOM 里没有任何城市胶囊。排查 `HomeMapDatabase.tsx` 第 95–180 行的 `labelChips` 计算：`project()` 结果要在 `load` **之后**、并在 `move`/`resize`/`idle` 时重算；确认 `labels` 为空数组时的早退没有误伤。修好后每个胶囊根元素加 `data-map-label`。在 FakeMap 上让 `project` 返回确定坐标并在测试里断言胶囊数量 > 0（碰撞规避把明显重叠的去掉）。

## F5 「覆盖 8 座城市」拖后腿

`HomeStats.cities` 只有 8（City 表条数），放在“全球数据库”标题下会削弱说服力。改法：

- 副标题改为「来自 {works} 部动漫作品 · 每天都在增加」（三语同步，删掉 `{cities}` 段）；
- 地图卡片左下角三个统计胶囊改为：「作品 {works}」「巡礼点位 {totalPoints}」（精确值，千分位）「攻略 {posts}」；图标分别 `Film`、`MapPin`、`BookOpen`；
- 相关 i18n 键与测试同步（`mapDbStatCities` 删除或改名为 `mapDbStatPoints`）。

## F6 第三屏两处小问题

`components/home/HomeShowcasePlan.tsx` / `homeShowcase.ts`：

1. 左栏底部大图现在取到的是酒店照片（Day 1 没有圣地）。改为「第一个 `type === 'point'` 且有图（`payload.media.displayUrl` 或 `point.image`）的条目」，全都没有再退回 `heroDemoItems(days, 1)`。
2. 默认选中的天改为「第一个含 `point` 条目的天」（当前数据是 Day 2），自动轮播从这一天开始往后循环；`homeShowcase.ts` 加纯函数 `defaultDayIndex(days)` 并单测。
3. Day 标签行：8 天时最后一个标签被挤出（截图只看到 Day 7），确认 `overflow-x-auto` 容器正常横向滚动且「查看完整行程」按钮不在滚动容器内被挤压——按钮固定在行右侧、标签区独立滚动。

## F7 收尾行动区数字格式

`homeFinalCtaUtils.ts`：`{works}` 用 `Intl.NumberFormat`（按 locale）加千分位（1,523），测试同步。

## 汇报

简短中文：改动文件、四条命令结果、需要确认的点。
