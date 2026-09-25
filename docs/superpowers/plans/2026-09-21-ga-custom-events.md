# GA4 自定义事件埋点（2026-09-21）

## 背景

GA4（`G-F7E894BEWR`，在 `app/layout.tsx` 里用 next/script lazyOnload 加载 gtag）目前只有增强测量的默认事件，
/plan 使用、地图交互、注册、外跳导航、分享、结账全都量不到。站点真实流量只有 35–45 会话/天，
所以要知道每个访客到底做了什么。本任务只加前端埋点，不改任何业务行为。

## 约束（硬性）

- 不要 git commit，不要 push，不要部署，不要跑 `cf:build` / `cf:deploy`。
- 不改任何用户可见 UI、文案、样式；不改 API、DB、middleware。
- 埋点调用永远不能抛错、不能阻塞交互：全部 fire-and-forget，不 await。
- 不上报任何个人信息：不传邮箱、用户 id、用户输入的 prompt 文本、计划 id。
- 注释密度、命名风格跟周围代码一致（项目注释用中文）。
- 不新增 npm 依赖。

## A. 统一封装

新建 `lib/analytics/track.ts`：

```ts
export type AnalyticsEvent = /* 下表 9 个事件名的字面量联合 */
export function track(event: AnalyticsEvent, params?: Record<string, string | number | boolean | undefined>): void
```

- SSR 下（`typeof window === 'undefined'`）直接返回。
- 只在生产域名上报：`location.hostname` 为 `seichigo.com` 或以 `.seichigo.com` 结尾才发，其余（localhost、预览域名）no-op。
  GA 里现在有 `localhost:3457 / referral` 这种开发污染，这条就是为了挡它。
- gtag 是 lazyOnload，事件可能早于 gtag 脚本：不要依赖 `window.gtag` 存在，直接
  `window.dataLayer = window.dataLayer || []` 后按 gtag 的方式 push `arguments` 对象
  （注意：必须 push arguments 对象而不是数组，GA 才认；写一个内部 `function gtag(){ dataLayer.push(arguments) }`）。
- 过滤掉值为 `undefined` 的参数；字符串参数截断到 100 字符。
- 整体 try/catch 吞错。
- 自动附带 `locale`（从 `location.pathname` 前缀判断：`/en`→en、`/ja`→ja、其余 zh），调用方传了就以调用方为准。

同时把 `app/layout.tsx` 里的 `gtag('config', ...)` 也加同样的域名守卫（非生产域名不 config），
这样开发/预览环境连 page_view 都不发。内联脚本保持简单字符串即可。

## B. 事件清单

事件名与参数名一律 snake_case。能用 GA4 推荐事件名的就用推荐名（sign_up / login / share / begin_checkout）。

注意：`source`/`medium`/`campaign` 等是 GA4 流量归因保留参数，事件参数不能用这些名字（`track.ts` 的 `AnalyticsParams` 已加类型护栏拦掉，需要类似语义时换名，如 `open_source`）。

| 事件 | 触发时机 | 参数 | 已知位置（自行确认，可能不全） |
|---|---|---|---|
| `plan_start` | 用户提交一次规划请求（发起 agent run 的那一下，请求发出前） | `entry`: `start_page`\|`plan_page`；`suggestion`: 是否点的建议行（boolean） | `app/(authed)/plan/[id]/ui.tsx` 里 POST `/api/me/plans/${planId}/agent`；`/plan/start` 的 PlanStartView |
| `plan_login_required` | 未登录用户在 /plan/start 提交后被引导去登录（loginIntent 路径） | `entry` | PlanStartView / loginIntent 相关代码 |
| `plan_generated` | 一次 agent run 正常结束并产出结果（观察流收到完成帧） | `points_count`（数字，拿得到才传）、`days`（同） | plan 页的观察流 / SSE 完成处理 |
| `sign_up` | 邮箱验证码注册成功 | `method`: `email_code` | `app/auth/signup/ui.tsx`、`components/auth/useEmailCodeLogin.ts` |
| `login` | 登录成功 | `method`: `email_code`\|`credentials` | `app/auth/signin/ui.tsx`、`components/auth/useEmailCodeLogin.ts` |
| `map_point_open` | 地图上选中一个点位（打开点位详情/面板） | `bangumi_id`（数字）、`open_source`: `marker`\|`list`\|`overlay`\|`url` 能区分就传，分不清传 `unknown`（不能用 `source`，那是 GA4 归因保留参数） | `features/map/anitabi/useAnitabiSelection.ts` 的 setSelectedPointId 路径；`components/map/*Overlay.tsx` 的 onPointClick |
| `map_anime_select` | 地图上选中一部作品 | `bangumi_id` | 同上 selection hook |
| `outbound_navigation` | 点击跳到 Google Maps / Apple Maps 等外部导航 | `surface`: `map`\|`plan`\|`article`\|`resource`；`provider`: `google`\|`apple`\|`other`；`kind`: `place`\|`directions`\|`streetview` | `features/map/anitabi/media.ts`（生成链接处的使用方）、`app/(authed)/plan/[id]/components/DayPointCard.tsx`、`TransitConnector.tsx`、`lib/navigationLinks.ts` 的使用方、`components/resources/MapAssetView.tsx`、`RouteDirectory.tsx` |
| `share` | 分享/复制链接成功 | `method`: `native`\|`copy`；`content_type`: `article`\|`point`\|`route`\|`comparison`\|`resource` | `components/content/ArticleShareButtons.tsx`、`components/share/shareClient.ts`、`components/share/RouteBookCard.tsx`、`components/resources/CopyLinkButton.tsx`、`components/comparison/ComparisonImageGenerator.tsx` |
| `begin_checkout` | 点击付费档位的结账按钮（调结账接口前） | `tier` | `components/pricing/PricingCtas.tsx` |

细则：

- `map_point_open`：同一个点位重复设置（渲染抖动、URL 同步回写）不要重复上报——只在 pointId 真的变化且非 null 时发一次。
  页面首次加载时由 URL 参数恢复出来的选中也算一次，`open_source` 传 `url`。不要在 effect 里因依赖变化反复触发。
- `outbound_navigation`：链接是 `<a target="_blank">` 的，加 onClick 即可，不要 preventDefault，不要改成 JS 跳转。
  服务端组件里的链接如果要埋，抽一个极小的 client 组件包一层 `<a>`，不要把整个父组件改成 client。
  如果某处改动代价明显偏大（要把大块服务端组件客户端化），跳过并在汇报里列出来。
- `plan_generated`：只在正常完成时发；用户手动停止、报错不发。同一 run 只发一次（注意观察流重连）。
- `sign_up` 与 `login` 区分不了时（同一个 email-code 流程对新老用户一样）统一发 `login`，
  只有走 `/auth/signup` 页面成功的发 `sign_up`。

## C. 测试

- 给 `lib/analytics/track.ts` 写单测（项目现有测试框架，参考仓库里已有的 `*.test.ts` 写法与位置）：
  非生产域名 no-op；生产域名 push 的是 arguments 形态且 `[0]==='event'`；undefined 参数被过滤；
  长字符串被截断；内部抛错不外泄；locale 自动推断。
- 不要求给每个埋点位置写测试，但不能弄挂现有测试。

## D. 完成标准

在 worktree 根目录依次通过（先 `npm install`，该 worktree 还没装依赖）：

```bash
npm install
npx tsc --noEmit
npm run lint
npm test -- --run   # 若项目测试命令不同，以 package.json 为准
```

汇报（简短中文）：改动文件清单；10 个事件各自落在哪些文件；跳过了哪些位置及原因；三条命令的结果。
