# GA4 埋点：审查后修复（2026-09-21）

前置：`docs/superpowers/plans/2026-09-21-ga-custom-events.md` 已实现（未提交，改动都在工作区）。
独立审查发现埋点的**数据正确性**问题，本文件列出要修的项。硬约束与原任务书相同：
不 git commit、不改可见 UI/文案/样式/业务行为、埋点不抛错不 await 不阻塞、不上报 PII、不新增依赖、注释中文。

## F1（高）事件早于 `gtag('config')` 入队会被 gtag.js 丢弃

现状：`app/layout.tsx` 里 config 在 `strategy="lazyOnload"` 的内联脚本中；`lib/analytics/track.ts` 直接 push event。
从分享链接进 `/map?b=..&p=..` 时，`useAnitabiSelection.ts` 的 effect 在 hydration 时就入队，早于 config → 整类事件丢失。

修法（要确定性，不靠脚本加载时机）：
- `track.ts` 内新增 `ensureConfigured()`：若 `window.__seichigoGaConfigured !== true`，先按 gtag 方式 push `('js', new Date())` 与 `('config', 'G-F7E894BEWR')`，再置 `window.__seichigoGaConfigured = true`。`track()` 在 push event 前调用它。measurement id 提成 `track.ts` 里的导出常量。
- `app/layout.tsx` 的内联脚本同样先检查 `window.__seichigoGaConfigured`：未配置才 `js`+`config` 并置标记；已配置则跳过，保证 config 全局只发一次（否则 page_view 会重复）。域名守卫保留。
- 内联脚本那一段改 `strategy="afterInteractive"`（纯内联，无网络开销）；远端 `gtag/js` 仍 `lazyOnload`。
- 单测补：首次 track 时 dataLayer 顺序为 js → config → event；第二次 track 不再 push config；标记已置位时不 push config。

## F2（高）`plan_generated` 的 `days` / `points_count` 读到发起请求前的旧 plan

位置：`app/(authed)/plan/[id]/ui.tsx` 的 `reportPlanGenerated()`（闭包捕获旧 `plan`）。
修法：组件内 `const planRef = useRef(plan); planRef.current = plan`，`reportPlanGenerated` 读 `planRef.current`。
队列/观察流路径里 `plan_updated` 只是 `void refreshPlan()`，紧随的 `done` 仍可能读旧值：
`reportPlanGenerated` 改为在 plan 刷新落地后再读（例如 done 时若有在途 refresh 则等它 settle 后下一个 tick 上报；
实现方式自定，但不能阻塞 UI 收尾逻辑，也不能改变 onDone 原有副作用的时序）。拿不到就不传这两个参数，事件仍要发。

## F3（中）`plan_start` 把追问回答与错误重试也计入

`postAndStream` 被 `send()`、`onAnswerAsk`、`onRetry` 共用。只有 `send()` 的新请求发 `plan_start`；
回答 ask 卡片与错误重试不发。起始页交接（`fromStartPage`）仍不重复计。用显式的 kind 参数区分，不要靠猜 body。

## F4（中）恢复轮询收尾路径漏报 `plan_generated`

观察流退避用尽或内联读流被掐断 → `enterRunRecovery` → 轮询收尾走 `usePlanRunSync` 的 `onIdle`，那里没有上报。
修法：轮询收尾判定为「正常跑完」（非 stopped、非 interrupted、无 error）时同样调 `reportPlanGenerated()`；`planGeneratedRef` 继续负责去重。

## F5（中）纯追问轮不应计为 `plan_generated`

Agent 第一轮常是 `ask` + `done`，没有行程产出。只有本轮 run 里出现过行程产出信号（`daymap` / `plan_updated` 帧，
或轮询路径下 plan 的点位数/天数相对 run 开始时发生变化）才上报。内联 SSE、观察流、轮询三条路径都要覆盖。

## F6 / F7（中）`map_point_open` 的 source 两处漏标，被错记成 `url`

- `features/map/anitabi/useMapStyleFailover.ts`：全量模式（complete mode）点 marker 走 `openBangumiRef.current?.(...)` 的早退分支，补 `notePointOpenSource('marker')`。
- `features/map/anitabi/AnitabiMapLayout.tsx`：探索面板的 `onOpenPoint` 补 `notePointOpenSource('list')`。
顺带全仓搜一遍所有会改 `selectedPointId` / 调 `openBangumi(id, pointId)` 的用户交互入口，确认没有第三处漏标；汇报里列出检查过的入口。

## F8（低）`plan_start(start_page)` 改到计划创建成功之后发

`components/plan/PlanStartView.tsx` 的 `createPlanAndGo()`：建计划失败（429、网络错）不应计数。移到创建成功、跳转之前。

## F9 调试逃生门

域名守卫让本地与预览完全无法自测。`track.ts` 增加：当 `localStorage.getItem('ga_debug') === '1'` 时，
无论域名，都 `console.debug('[ga]', event, payload)`；非生产域名下仍然**不** push dataLayer（只打日志）。
读 localStorage 要 try/catch。单测覆盖：debug 开 + 非生产域名 → 有 console.debug、无 dataLayer push。

## 不修（记 backlog，不要动）

短 pointId 归一化二次触发；`plan_login_required` 关弹窗后重复；观察流 `after=0` 重放旧 done。

## 完成标准

```bash
npm run typecheck
npm test
```
两条都通过。`npm run lint` 在本仓库是空跑（eslint 未安装、脚本带 `|| true`），不要当作验证项汇报。

汇报（简短中文）：每个 F 项改了哪个文件哪个函数；F6/F7 检查过的入口清单；两条命令的关键输出行。
