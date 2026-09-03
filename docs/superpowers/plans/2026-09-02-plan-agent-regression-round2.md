# plan agent · 回归修复第二轮（2026-09-02）

工作方式：先 `git status` / `git diff` 通读现状（工作树已有大量未提交改动，不要动无关文件）；每条先补失败测试再改实现；不要 git commit。A、B 由不同代理并行执行，文件互不重叠：A 只碰 `lib/**`、`tests/planAgent/**`、`tests/googlePlaces/**`、`tests/directions/**`、`lib/tripPlan/handlers/planById.ts`；B 只碰 `app/(authed)/plan/[id]/**`、`components/map/**`、`tests/plan/**`、`tests/map/**`。

## 取证结论（已用真实数据验证）

- **公交查不到**：对同一 key 直接调 Google Directions，新宿→浅草、新宿→河口湖 `mode=transit` 一律 `ZERO_RESULTS`（加 `region=jp`、`transit_mode` 也一样），伦敦对照 OK。这是 Google API 不提供日本公共交通数据的覆盖缺口，不是我们的 bug。天气之子计划里 7 次 transit 全部 zero_results，步行/自驾全部 OK。
- **归一化冲突**：真实报错为「河口湖站」(09:30–10:30) 与紧随其后的步行 transit 条目 (09:40–10:11) 重叠——模型给点位和交通段都写了显式时间。`lib/planAgent/schedule.ts` 对任何重叠都硬报错，模型只能整份重存。
- **点位图占位**：库里该计划 33 个作品点位全部有 `image.anitabi.cn` 图；`/api/anitabi/image-render` 在预览与生产都返回 200 image/jpeg，但单张 5–10 秒。浏览器侧 `NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED=1`、`NEXT_PUBLIC_MAP_IMAGE_HOST_POLICY_PROXY_AWARE=0`（.env.local，构建期内联），断路器按 host 记失败，而代理 URL 的 host 就是站点自身：2 次失败 → 该 host 全部图片超时降到 2 秒，10 秒内 3 次 → blocked（超时 0）。DayCards 点位图预算 8.5 秒，几十张图并发时必然级联失败，Google 地点图（同一 host）随之一起消失。
- **Google 地点图部分缺失**：25 条 `ExternalPlace` 中 24 条已 `mirrored`，R2 对象确实存在；缺失属于上一条的浏览器侧级联。
- **餐厅推荐**：Places Nearby Search（`type=restaurant`）用现有 key 可用，新宿 600 m 内返回 20 家，可按评分/评价数筛选。
- **断线后不再实时渲染**：`ui.tsx` 的 `postAndStream` 读流循环没有断线恢复；服务端 run 继续跑（刷新后能看到结果和 daymap）；`GET /api/me/plans/[id]` 不返回 busy 状态，前端无法知道"还在跑"。思维链组件只存在于内存，刷新即丢失（本轮不做持久化）。

---

## A. 后端（glm-5.3）

### A1 日本公交覆盖缺口的兜底（`lib/planAgent/tools.ts` `estimate_travel`、`lib/planAgent/travelHelpers.ts`、`lib/directions/googleClient.ts`）

- 新增判定 `isWithinJapan(lat,lng)`（bbox：lat 24–46，lng 122–146）。
- `estimate_travel` 收到 `mode='transit'` 且结果 `ZERO_RESULTS` 时：若起终点都在日本，**不再返回 zero_results 让模型去问用户**，而是走兜底：
  1. 再查一次 `mode='driving'`（已有 travel 函数）；
  2. 若自驾距离 ≤ 1.5 km → 直接返回步行结果（再查一次 walking）；
  3. 否则返回 `ok: true, mode: 'transit', estimated: true, provider: 'estimate', durationMin = round(drivingMin × 1.3 + 12), distanceKm = 自驾距离, transfers: null, legs: [], note: 'Google 路线服务不提供日本公共交通时刻，此为按道路距离推算的参考值；请以 Google 地图/乘换案内为准', mapsUrl: https://www.google.com/maps/dir/?api=1&origin=<lat>,<lng>&destination=<lat>,<lng>&travelmode=transit`；
  4. `transportPayload` 同步带 `provider: 'estimate'`、`estimated: true`、`mapsUrl`，供前端标注。
- 起终点不在日本时保持现有 zero_results + ask_user 行为。
- 提示词（`lib/planAgent/prompt.ts`）：在交通规则处补一句"日本境内公交查询若返回 estimated:true 的参考值，直接采用并在 reason 里注明是参考估算，不要再为此发起是否改自驾的提问"。
- 测试 `tests/planAgent/toolsM3.test.ts`（或新建 `tests/planAgent/transitFallback.test.ts`）：mock travel：transit→ZERO_RESULTS、driving→ok 20 km/25 min → 返回 estimated transit 44 分钟且含 mapsUrl；自驾 1.2 km → 返回 walking；日本外 → 仍 zero_results。

### A2 归一化自愈（`lib/planAgent/schedule.ts`）

- transit 条目的显式开始时间若早于当前游标（与前一个条目重叠），忽略显式值、从游标开始，`confidence: 'estimated'`。
- 重叠扫描改为：仅当两个重叠区间**都是非 transit 且都是显式时间**时才报错；其他任何重叠一律把后者顺延到前者结束（级联，`confidence: 'estimated'`），不报错。
- 提示词补一句："transit 条目不要写 timeHint 或 payload.schedule，时间由服务端按前后点位推导"。
- 测试 `tests/planAgent/schedule.test.ts`：复现真实用例（点位 09:30–10:30 显式 + 步行 09:40 显式 11 分钟）→ ok，步行顺延到 10:30–10:41，confidence estimated；两个显式点位 09:00–10:00 与 09:30–10:30 → 仍报错；既有用例回归。

### A3 餐厅推荐工具（新建 `lib/googlePlaces/nearby.ts`，接入 `lib/planAgent/tools.ts`、`serverDeps.ts`）

- `createNearbySearch({ apiKey, fetchImpl, rateKey, store })`：Places Nearby Search `location=lat,lng&radius=<默认800>&type=restaurant&language=zh-CN`（可选 `keyword`）。筛选 `rating ≥ 4.2 && user_ratings_total ≥ 80`，不足 3 家时放宽到 `≥ 4.0 && ≥ 30`；按 `rating × log10(reviews + 10)` 降序取前 5。每家组装成 `ResolvedPlace`（placeId/name/address/lat/lng/mapsUri/photo）并 `store.upsert(place, null)`，同时写入 resolver 的内存缓存（出处校验能命中），附 `rating`、`userRatingsTotal`、`priceLevel`。限速与 resolver 共用同一 rateKey 窗口。
- 新工具 `find_restaurants`：参数 `lat`、`lng`（必填，取用餐前最后一个点位坐标）、`radiusM`（可选）、`keyword`（可选，如"拉面"）；返回 `{ ok, restaurants: [...], optionProvenance 同 resolve_place }`；无结果返回 typed 错误。
- 提示词：安排 `meal` 条目时必须先用 `find_restaurants` 以用餐前最后一个点位为中心搜索，选评分最高且顺路的一家写入 `payload.place`（照抄返回对象）、`payload.media` 照抄，`note` 里列出另外 1–2 家备选（名称+评分）；不要凭记忆编店名。
- `lib/planAgent/placeBackstop.ts`：不变（meal 缺 place 时仍按 placeQuery/title 兜底）。
- 测试 `tests/googlePlaces/nearby.test.ts`：筛选/放宽/排序/upsert 入库；`tests/planAgent/toolsM3.test.ts` 补 `find_restaurants` 返回形状与出处。

### A4 计划 GET 暴露运行状态（`lib/tripPlan/handlers/planById.ts`）

- GET 响应增加 `agentBusy: boolean`（`agentBusyUntil` 存在且晚于 now）。测试 `tests/tripPlan/*` 中对应 handler 用例补断言。

完成标准：`npx vitest run tests/planAgent tests/googlePlaces tests/directions tests/tripPlan` 全绿；`npx tsc --noEmit` 与 `npm run typecheck:tests` 对本次改动文件无新增报错。

---

## B. 前端（kimi k3）

### B1 图片断路器不得把站点自身 host 拉黑（`components/map/utils/mapImageHostPolicy.ts`、`components/map/ResilientMapImage.tsx`）

- `readMapImageEffectiveHost`：对站内代理 URL 一律返回"上游标识"而不是站点 host：`/api/anitabi/image-render` 取 `url` 参数的 host（现有 `readMapImageUpstreamHost`）；`/api/google/place-photo` 返回固定标识 `'google-place-photo'`。去掉 `NEXT_PUBLIC_MAP_IMAGE_HOST_POLICY_PROXY_AWARE` 的开关判断（行为恒开）。
- `ResilientMapImage`：站内代理 URL 且 `kind` 为 `point` / `point-preview` 时请求预算 8.5 秒 → 20 秒；断路器对代理 URL 记录失败时使用上面的上游标识。
- 测试 `tests/map/mapImageHostPolicy.proxyAware.test.ts`（去掉对开关的依赖）、`tests/map/resilient-map-image.test.tsx`：Google 代理 URL 失败两次后，anitabi 代理 URL 的超时预算不受影响；点位代理 URL 在 15 秒时仍未超时。

### B2 断线恢复与运行状态（`app/(authed)/plan/[id]/ui.tsx`）

- `postAndStream` 读流循环包一层 try/catch：网络中断/reader 抛错（非 HTTP 错误、非用户中止）时进入 `reconnecting` 状态：保留已渲染的聊天与思维链，显示横幅"连接中断，正在同步进度…"，`busy` 保持 true。
- 轮询 `GET /api/me/plans/${planId}`（每 3 秒）：用返回的 `chat` 与本地对齐——维护 `serverEntryCount`（初始为服务端渲染进来的 chat 长度；每收到一条会落库的 SSE 消息时不必精确维护，简单策略：轮询时若 `chat.length > 本地已知服务端条数`，把多出来的条目追加到本地并更新计数；daymap 条目按 revisionId 去重）；同时更新 `plan`。当返回 `agentBusy === false` 时结束轮询、`busy=false`、横幅消失。
- 首次挂载时若服务端返回 `agentBusy === true`（另一标签页或刷新中断了流），直接进入同样的轮询态并显示"规划仍在进行中…"。
- 测试 `tests/plan/plan-timeline.test.tsx`：mock fetch 的流在两帧后抛 `TypeError('network')` → 出现横幅、随后 GET 轮询返回新增 assistant 条目与 `agentBusy:false` → 条目出现、横幅消失、输入框恢复可用；已渲染的思维链条目仍在。

### B3 交通段"参考估算"标注（`app/(authed)/plan/[id]/components/itemPayload.ts`、`DayCards.tsx`）

- `TransportPayload` 增加 `estimated?: boolean`、`mapsUrl?: string`；`formatTransportText` 对 `estimated` 追加"（参考估算）"；transit 行有 `mapsUrl` 时渲染一个"在 Google 地图查看"外链（`target=_blank rel=noopener`）。测试 `tests/plan/itemPayload.test.ts`、`tests/plan/dayCards.test.tsx`。

完成标准：`npx vitest run tests/plan tests/map` 全绿；`npx tsc --noEmit` 无错。

---

## 未纳入本轮（记录）
- 预览 worker 对 anitabi 图片始终 `upstream-with-r2-write`、生产为 `r2-primary`（同一 key、同一对象、同一 vars）。需要在 Cloudflare 控制台 Workers Logs 里筛 `image-render` 看 `cache_hit`/异常事件定位；也可能随合并 main 消失（本分支落后 main 20 个提交，含 anitabi 图片链路修复）。
- 思维链（ThinkingChain）持久化：刷新后恢复需要把每轮工具时间线落库，另立任务。
- 日本公交的真实时刻表数据源（NAVITIME / 駅すぱあと 等付费 API）。
