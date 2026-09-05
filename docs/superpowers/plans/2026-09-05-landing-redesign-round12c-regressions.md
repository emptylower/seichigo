# 第十二轮第三批：验收回归修复（2026-09-05）

用户在预览 `b9226e14` 上的三个回归：
1. 作品名滚动条在日文站显示中文名（`heroData.ts:34` 取 `item.anime?.name`，未按 locale）。
2. 首屏微演示：四个勾走完才整体弹出结果卡，观感突兀；应一开始就有卡片壳，随步骤逐条填入。并且演示数据与第二屏用同一份计划，应换一份。
3. 第二屏静态模式点位图全部不显示：静态 `<img>` 直接用了 `item.point.image`（`https://image.anitabi.cn/...` 站外直链，被 403），只有生成时静态化过的 Google 图能显示。

工作方式同前：先补失败测试再改；**不要 git commit / git stash**；不跑迁移；line-budget ≤ 750。
- A（数据，glm-5.3）只碰 `lib/home/**`、`scripts/**`、`content/generated/home-*.json`、`public/images/showcase/**`、`tests/home/**`、`tests/scripts/**`。
- B（前端，Claude Opus）只碰 `components/home/**`、`app/(authed)/plan/[id]/components/{DayCards,ItemThumbnail}.tsx`（静态模式）、`lib/i18n/locales/*.json`、`tests/components/home/**`、`tests/plan/dayCards.static.test.tsx`、`tests/i18n/**`。
两边并行、文件不相交。

## §0 契约补充
- `content/generated/home-showcase.json`：所有**点位类条目**（`point`、以及任何 `item.point?.image` 非空的条目）在生成时也把图片静态化：从公开代理 `/api/anitabi/image-render`（用 `lib/anitabi/imageProxy.ts` 的 `getMapDisplayImageCandidates(image, { kind: 'point-thumbnail' })[0]` 得到的 URL，基于生产站 `https://seichigo.com` 抓取）下载到 `public/images/showcase/`，并写入 `payload.media = { source: 'anitabi', displayUrl: '/images/showcase/<hash>.jpg', attribution: 'Anitabi' }`（已有 `media` 的条目不动）。因此静态渲染只依赖 `media.displayUrl`；`point.image` 保留原值供非静态场景。
- 新文件 `content/generated/home-hero-demo.json`：
  ```ts
  { planTitle: string; day: { dayIndex: 1; summary: string; items: Array<{ id: string; title: string; time: string; imageUrl: string }>; transit: { mode: string; label: string } } }
  ```
  由计划 `cmth2dorw00048axy6oat70up`（京吹京都巡礼 3 日）的 Day 1 取前 3 个带图的可路由条目（图片按上面的规则静态化到 `public/images/showcase/`），`time` 取 `schedule.start`，`transit` 取前两条之间的交通段（`步行 N 分钟` 一类文案，没有则 `步行 · 约 10 分钟`）。前端 `HomeHeroDemo` 改读它，不再用 `data.showcase`。
- `HomePortalData` 增加 `heroDemo` 字段（同上形状）。

## A. 数据（glm-5.3）
### A1 点位图静态化（`lib/home/showcase.ts`、`scripts/generate-home-showcase.mts`）
按 §0 扩展 `rewriteShowcaseDays`：对 `item.point?.image` 非空且无 `media` 的条目，通过注入的 downloader 抓取代理 URL 并写 `media`；失败则保留无 `media`（前端兜底）。测试补：point 条目被写入 `/images/showcase/` 的 `media`，已有 `media` 的不覆盖，下载失败不写。重跑生成，`home-showcase.json` 仍 ≤ 100 KB，图片目录 ≤ 2.5 MB（新增约 28 张 h160 缩略图，很小）。
### A2 首屏演示数据（新文件 `scripts/generate-home-hero-demo.mts`、`lib/home/heroDemo.ts`）
按 §0 生成 `home-hero-demo.json`；`parseHomeHeroDemo` 形状校验；`getHomePortalData` 静态 import 并输出 `heroDemo`（失败即抛错，与其它源同口径）。测试：纯函数 `pickHeroDemo(days)` 的选取规则；`getHomePortalData.test.ts` 补字段。

完成标准：`npx vitest run tests/home tests/scripts` 全绿；`npx tsc --noEmit` 无错；line-budget 通过；简短中文汇报（含生成的 3 个条目标题）。

## B. 前端（Claude Opus）
### B1 滚动条按 locale 取作品名（`heroData.ts`、`HomeWorksTicker.tsx`）
`heroWorkNames(popular, locale)`：用与 `HomePopularAnime` 同一套显示名逻辑（找现有的 anime 多语言显示名 helper；ja 用日文原名，en 用英文名，缺失回退 zh）。测试补三语。
### B2 微演示渐进填充（`HomeHeroDemo.tsx`）
结果卡壳一开始就渲染（Day 1 徽标 + 三个空行骨架）；步骤 1 点亮后填第 1 条条目，步骤 2 填第 2 条，步骤 3 填第 3 条，步骤 4 点亮后出现交通线并把骨架收尾；每条填入用 150 ms 淡入。跑一轮后停在填满状态；`prefers-reduced-motion` 直接填满。数据改读 `data.heroDemo`（§0），`heroDemo` 缺省时组件不渲染。测试重写：假计时器下逐步填入的条目数 1→2→3，第 4 步后交通线出现。
### B3 静态模式图片兜底（`ItemThumbnail.tsx`）
静态模式下图片来源：`media.displayUrl` → 否则 `getMapDisplayImageCandidates(item.point.image, { kind: 'point-thumbnail' })[0]`（公开代理，绝不直接用 `point.image` 原始站外地址）→ 否则占位。测试补：无 media 的 point 条目在静态模式渲染代理 URL 而非 `image.anitabi.cn` 直链。

完成标准：`npx vitest run tests/components/home tests/plan/dayCards.static.test.tsx tests/i18n` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报。

## 主会话验收
日文站滚动条为日文原名；首屏演示卡片从空壳逐条填入且换成京吹京都计划；第二屏 Day 1/Day 2 点位图全部显示且 DevTools 无对 `image.anitabi.cn` 的直连请求。
