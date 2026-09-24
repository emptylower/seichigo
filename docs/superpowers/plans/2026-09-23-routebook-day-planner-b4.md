# 按天行程本 B4 派发单：天气 / 导出 / 导航深链（2026-09-23）

> 执行者须知：主计划 `docs/superpowers/plans/2026-09-23-routebook-day-planner.md`（先读顶部硬约束与「评审修订记录」，再读 **任务 20、21、22**）。B1–B3 已完成并提交在本分支。**A（后端）与 B（前端）并行**：A 只改 `lib/**`（不含 `lib/i18n`）、`app/api/**`、`tests/routeBook/**`、`tests/geo/**`、`tests/route/**`（node）、`tests/weather/**`、`package.json`/`package-lock.json`（仅为加 `fast-xml-parser`）；B 只改 `app/(authed)/me/**`、`app/(authed)/plan/[id]/lib/navigationLinks.ts`（改为 re-export）、`components/navigation/**`、`lib/i18n/locales/*.json`、`tests/routebooks/**`。各自 commit（不 push）。
>
> 完成标准：typecheck 0 错；A 跑 `npx vitest run tests/routeBook tests/geo tests/route tests/weather`，B 跑 `npx vitest run --project jsdom tests/routebooks` 与 `npx vitest run tests/i18n`；`npm test` 全绿；简短中文汇报。**不参考、不复制 AGPL 项目（TREK/T-T）的代码**，GCJ-02 与 2-opt 一样按公开公式自写。

## 代码现状（B3 之后）

- 详情页：`ui.tsx`（398 行）+ `components/DesktopLayout.tsx`、`MobileLayout.tsx`、`plannerNodes.tsx`、`DetailChrome.tsx`、`DialogsHost.tsx`；移动端 `components/mobile/{DayPillTrack,MobilePlanView,MobileDock,DaySummaryBar}.tsx`；`DayDetailCard.tsx` 已有住宿卡并给天气留了位置；`DayBlock.tsx` 底部工具条的「打开导航」目前只有 Google（用 `utils.buildGoogleDirectionsUrl`）；`RouteBookImmersiveMode.tsx` 单点导航也只有 Google；`MobileDock` 的「打开导航」是 action sheet 占位。
- `app/(authed)/plan/[id]/lib/navigationLinks.ts` 是 /plan 现有的 Google 深链工具（单点 + 多天分块）。
- `lib/routeBook/legCache.ts`（KV 表）、`lib/share/geocode*.ts`（MapTiler）可复用；`RouteBookApiDeps` 工厂在 `lib/routeBook/api.ts`。
- 详情响应 `GET /api/me/routebooks/[id]` 有 `days[].date`（ISO 或 null）、`items[]`、`places[]`、`lodgings[]`；点位预览（名/图/坐标）前端由 `usePointPreviews` 拉。
- 文案全部走 `t('routebook.*', locale)` 三语；行数预算 750。

## 契约

1. `GET /api/weather?lat=&lng=&from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ ok: true, days: [{ date, tMax, tMin, code }] }`；超出 16 天预报范围的日期不返回；失败 → `{ ok: true, days: [] }`；响应头 `Cache-Control: public, max-age=3600`。
2. `GET /api/me/routebooks/[id]/export.gpx?scope=all|day&dayIndex=N` → `application/gpx+xml` 附件；`GET /api/me/routebooks/[id]/export.ics` → `text/calendar` 附件；无日期行程的 ics → 400 `{ error: '行程没有日期，无法导出日历' }`。
3. `lib/route/navigationTargets.ts`（A 写，B 用）：
   ```ts
   export type NavProvider = 'google' | 'apple' | 'amap'
   export type NavTarget = { provider: NavProvider; url: string; appUrl?: string; note?: 'endpointsOnly' }
   export type NavStop = { lat: number; lng: number; name: string }
   export type NavMode = 'transit' | 'walking' | 'driving'
   export function buildSingleTargets(stop: NavStop, mode: NavMode): NavTarget[]
   export function buildDayTargets(stops: NavStop[], mode: NavMode): NavTarget[]   // 含住宿首尾由调用方传入
   export function orderTargets(targets: NavTarget[], ctx: { isIOS: boolean; isAndroid: boolean; locale: 'zh'|'en'|'ja' }): NavTarget[]
   ```
   `amap` 的 `appUrl` 是 `amapuri://…`（Android）或 `iosamap://…`（iOS）由 `ctx` 决定，`url` 是 `ditu.amap.com/dir` 网页回退；坐标已转 GCJ-02。B 的 `OpenInMapsMenu` 负责「先开 appUrl，1.6 秒内页面未 hidden 则跳 url」。

## A. 后端（zhipuai glm-5.3）— 任务 20（lib）、21（lib+route）、22

- **A1 GCJ-02**：`lib/geo/gcj02.ts`（`wgs84ToGcj02`、`gcj02ToWgs84` 迭代反解 ≤30 次至 1e-7、`isOutsideChina`：经度 72.004–137.8347、纬度 0.8293–55.8271 之外为外）。测试 `tests/geo/gcj02.test.ts`：东京不转；上海 31.2304,121.4737 与拉萨 29.65,91.1 往返误差 < 1m；边界。
- **A2 导航深链**：`lib/route/navigationTargets.ts` 按契约 3。Google：单点 `https://www.google.com/maps/dir/?api=1&destination=lat,lng&travelmode=`；整天 `…/dir/?api=1&origin=&destination=&waypoints=a|b|c&travelmode=`（waypoints 超 9 个分块的逻辑从 `app/(authed)/plan/[id]/lib/navigationLinks.ts` 迁过来，那个文件改为 re-export——**这个 re-export 改动由 B 做**，A 只写新模块并保证导出名兼容）。Apple：`https://maps.apple.com/?daddr=lat,lng&dirflg=r|w|d`；整天只给起终点 `saddr/daddr` 并 `note:'endpointsOnly'`。高德：单点 `https://uri.amap.com/marker?position=lng,lat&name=…&coordinate=wgs84`；整天 Android `amapuri://route/plan/?sourceApplication=seichigo&dlat&dlon&dname&dev=0&t=1` + `vialons/vialats/vianames`（逗号分隔，最多 16 个），iOS `iosamap://path?sourceApplication=seichigo&dlat&dlon&dname&dev=0&t=1` + 同样途经点；网页回退 `https://ditu.amap.com/dir?from[lnglat]=lng,lat&from[name]=…&to[lnglat]=…&to[name]=…&via[0][lnglat]=…&type=bus|car|walk`；坐标经 `wgs84ToGcj02`。`orderTargets`：iOS → apple, google, amap；`zh` 非 iOS → amap, google, apple；其余 → google, apple, amap。测试 `tests/route/navigationTargets.test.ts`：三平台 URL；高德坐标为 GCJ-02（上海断言与 WGS 差 300–900m）；Apple 整天 endpointsOnly；排序三种；名称含逗号/中文正确编码。
- **A3 天气**：`lib/weather/openMeteo.ts`（`fetchDailyForecast({lat,lng,from,to})`，URL `https://api.open-meteo.com/v1/forecast?latitude&longitude&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo&start_date&end_date`；日期裁剪到今天..今天+15；失败返回 []）+ `app/api/weather/route.ts`（登录用户；`runtime='nodejs'`；Zod 校验；`Cache-Control: public, max-age=3600`；每用户 60 次/分钟）。测试 `tests/weather/openMeteo.test.ts`（mock fetch 解析、失败 []、日期裁剪）。
- **A4 GPX / ICS**：`npm i fast-xml-parser`（锁文件一起提交）。`lib/routeBook/exportGpx.ts`：`buildGpx(input: { title, days, items, places, previews: Map<pointId,{title,lat,lng}> , scope })` → 字符串：`<gpx version="1.1" creator="SeichiGo" xmlns="http://www.topografix.com/GPX/1/1">`，每个有坐标的 point/place 一个 `<wpt lat lon><name><desc>备注</desc><sym>kind</sym></wpt>`，每天一条 `<rte><name>Day N</name><rtept lat lon><name>…</name></rtept>…</rte>`（含住宿首尾）；`scope=day` 只输出该天。`lib/routeBook/exportIcs.ts`：`buildIcs(...)`：`BEGIN:VCALENDAR / VERSION:2.0 / PRODID:-//SeichiGo//RouteBook//ZH`，每天一个全天 `VEVENT`（`DTSTART;VALUE=DATE`、`SUMMARY` = 天标题或 `Day N`、`DESCRIPTION` = 当天条目清单，换行转义 `\n`），每条有 `timeStart` 的条目一个 `VEVENT`（`DTSTART;TZID=Asia/Tokyo:YYYYMMDDTHHMMSS`，`timeEnd` 缺省 +60 分钟），`UID:<itemId>@seichigo.com`，行按 75 字节折叠 `\r\n `。handler `lib/routeBook/handlers/export.ts` + 路由 `app/api/me/routebooks/[id]/export.gpx/route.ts`、`export.ics/route.ts`（`Content-Disposition: attachment; filename*=UTF-8''<encodeURIComponent(title)>.gpx`）；点位名/坐标用 `deps.pointCoords` + 一个 `deps.pointNames(pointIds)`（新增，Prisma 查 `AnitabiPoint` 的 `nameZh ?? name`）。测试 `tests/routeBook/exportGpx.test.ts`、`exportIcs.test.ts`（固定输入 `toMatchInlineSnapshot`；ics 无日期 400；GPX 名称含 `&`/`<` 正确转义）。

## B. 前端（kimi k3）— 任务 20（UI）、21（UI）、22（UI）

- **B1 导航菜单**：`components/navigation/OpenInMapsMenu.tsx`（桌面下拉 / 移动端 action sheet；props：`targets: NavTarget[]`、`locale`；显示 Google / Apple 地图 / 高德地图 三项，Apple `endpointsOnly` 时标「仅起终点」；高德项：`window.location.href = appUrl`，`setTimeout(1600)` 内 `document.visibilityState !== 'hidden'` 则 `window.open(url)`）。接入 `DayBlock` 工具条、`MobileDock`、`RouteBookImmersiveMode`（单点）、`PointDetailCard`（单点，替换现有「Google 地图」按钮）。`ctx` 由 `navigator.userAgent` + locale 算。`app/(authed)/plan/[id]/lib/navigationLinks.ts` 改为从 `lib/route/navigationTargets.ts` re-export 同名函数（保持 /plan 行为不变——先看它导出了什么，A 会保证同名导出存在；如有差异以不破坏 /plan 为准）。
- **B2 天气**：`components/WeatherBadge.tsx`（code → emoji：0 ☀️、1–3 ⛅、45/48 🌫️、51–67 🌧️、71–77 ❄️、80–82 🌦️、95–99 ⛈️；显示 `⛅ 22°/15°`）；`hooks/useWeather.ts`（有日期行程才请求；坐标取第一个有坐标条目或住宿；按行程本缓存 1 小时于内存）；接入 `DayBlock` 标题行、`DayDetailCard`、`DaySummaryBar`、`DayPillTrack`（可选小 emoji）。
- **B3 导出入口**：`DayPlanSidebar` 工具栏「导出 ▾」：GPX 整程 / GPX 当天（选中天时）/ ICS（无日期时禁用并提示）；`MobileDock` 更多菜单同样三项；都是 `<a href download>` 指向契约 2 的路由。
- 三语文案 `routebook.export.*`、`routebook.nav.*`、`routebook.weather.*`。
- 测试（jsdom）：`OpenInMapsMenu.test.tsx`（三项渲染、endpointsOnly 标注、高德回退计时用 fake timers）、`WeatherBadge.test.tsx`（code 映射）、`useWeather.test.tsx`（无日期不请求）。
