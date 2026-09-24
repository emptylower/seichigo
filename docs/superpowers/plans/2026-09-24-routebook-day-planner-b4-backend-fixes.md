# 按天行程本 B4 后端审查修复（2026-09-24）

> 执行者须知：先读主计划 `docs/superpowers/plans/2026-09-23-routebook-day-planner.md` 顶部硬约束。**只改** `lib/geo/**`、`lib/route/**`、`lib/weather/**`、`lib/routeBook/**`、`app/api/weather/**`、`app/api/me/routebooks/[id]/export.*/**`、`tests/geo/**`、`tests/route/**`、`tests/weather/**`、`tests/routeBook/**`。另一会话同时在改 `app/(authed)/**` 与 `lib/i18n/**`，不要碰，`git add` 只加自己的文件。不 push、不 migrate。完成标准：typecheck 0 错；`npx vitest run tests/geo tests/route tests/weather tests/routeBook` 全绿；`npm test` 全绿；简短中文汇报。

## Blocker

- **X1 高德 `t` 参数**：`lib/route/navigationTargets.ts:72-76` 按高德 URI API：`t` 0=驾车、1=公交、2=步行（3=骑行、4=火车不用）。改为 `{ driving: 0, transit: 1, walking: 2 }`；网页回退 `type=car|bus|walk` 保持。每种 mode 一个断言。
- **X2 高德途经点与起点**：`:180-182`、`:200-202` `vialons/vialats/vianames` 用 `|` 分隔（不是逗号），并加 `vian=<数量>`；`sanitizeListName` 改为把名称里的 `|` 替换掉（逗号无需处理）；Android/iOS 深链都加 `slat/slon/sname`（`stops[0]` 的 GCJ 坐标与名称），否则高德从当前位置出发、第一站丢失。测试：多途经点断言分隔符与 `vian`；起点参数存在。
- **X3 `isOutsideChina` 误伤日本西部**：`lib/geo/gcj02.ts:13-15` 的矩形（经度 72.004–137.8347）把京都/大阪/飞驒都当成中国（偏移 ~500m）。在应用矩形前先排除日本（纬 24–46、经 122.9–146）与韩国（纬 33–38.7、经 124.5–131）——落在这两个框内直接视为境外不转。测试：京都 35.0116,135.7681、飞驒古川 36.2381,137.1866、首尔 37.5665,126.978 不转；上海、拉萨仍转。
- **X4 天气窗口**：`lib/weather/openMeteo.ts:54-57` 上限改为 `min(东京今天, UTC 今天) + 15`（Open-Meteo 以 UTC 日期计窗口，JST 0–9 点会整段 400）；或改为请求 `forecast_days=16` 再在本地按 `[from,to]` 过滤（推荐后者，更稳）。测试：用 fake 时间 JST 01:00 断言请求不越界。

## Should-fix

- **X5** `openMeteo.ts:38-40,73-82` `numArray` 不能过滤 null（会错位），非有限值映射为 `undefined`/`null` 保持索引对齐；测试中间为 null 的用例。
- **X6** `lib/weather/handlers/weather.ts:17-18,56-57` 缺 `lat/lng` 不能变成 0：`get('lat') ?? undefined` + `z.string().min(1).pipe(z.coerce.number())`。
- **X7** `lib/routeBook/exportIcs.ts` 加 VTIMEZONE（`BEGIN:VTIMEZONE / TZID:Asia/Tokyo / BEGIN:STANDARD / DTSTART:19700101T000000 / TZOFFSETFROM:+0900 / TZOFFSETTO:+0900 / TZNAME:JST / END:STANDARD / END:VTIMEZONE`）放在 CALSCALE 之后；快照更新。
- **X8** `lib/routeBook/exportGpx.ts:118` 住中日（start.placeId===end.placeId）也要输出回酒店的终点；只有当天没有任何条目时才避免连续重复。`anchors.ts:51` `resolveDayAnchorStops` 无标题住宿用默认名「住宿」，并从 `resolveDayAnchors` 派生而不是复制逻辑。
- **X9** `exportIcs.ts:123-129` `endMin <= startMin` 时用 `startMin + 60`。

## Nit

- **X10** `handlers/export.ts:14` 文件名 RFC 5987：额外编码 `'()*!`；标题为空时用 `routebook`。
- **X11** `exportGpx.ts:61-71` 未使用的 `itemTitle` 接进去（无点位名时用条目标题）；GPX 文本剔除 XML 非法控制字符 `[\x00-\x08\x0B\x0C\x0E-\x1F]`。
- **X12** `exportIcs.ts:93` PRODID 用 `SeichiGo`；加 `X-WR-CALNAME:<title>`。
- **X13** `navigationTargets.ts:169` 途经点超过 16 个时截断并在返回值加 `note:'viaTruncated'`（类型里加这个可选值）。
- **X14** 天气 handler 补一个 `lib/weather/api.ts` deps 工厂（与其它域一致），限流 Map 顺带清过期项。
