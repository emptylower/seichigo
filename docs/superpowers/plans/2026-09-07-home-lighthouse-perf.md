# 首页 Lighthouse 性能修复（移动端 66 → 目标 85+）

日期：2026-09-07　分支：perf/home-lighthouse（当前 worktree）

本地 Lighthouse 复现：移动端 66（FCP 4.0s、LCP 5.5s、Speed Index 6.6s），桌面端 91。诊断结论与修法如下，全部做完。约束：不 git commit / 不 stash；三语不涉及；`node scripts/check-line-budget.mjs`、`npm run typecheck:app`、`npx vitest run tests/components tests/lib tests/asset tests/home` 要绿。

## 1. 第三方脚本不再抢首屏（`app/layout.tsx`）

现状：AdSense `strategy="beforeInteractive"`（240 KB 广告脚本在水合前以最高优先级加载）、gtag 171 KB 无策略（默认 afterInteractive）、`@vercel/speed-insights` 在 Cloudflare 上 404。

改法：
- AdSense `<Script>` 改 `strategy="lazyOnload"`（保留 `async`、`crossOrigin`）。
- gtag `<Script src=…gtag/js>` 与内联 `google-analytics` 都改 `strategy="lazyOnload"`（GA 延后几秒不影响统计口径，page_view 仍会发）。
- 删除 `SpeedInsights` 的 import 与 `<SpeedInsights />`；若 `package.json` 里 `@vercel/speed-insights` 只在这里用，把依赖也从 `package.json` 去掉（不要跑 `npm install`，只改 package.json，并在汇报里说明需要 `npm install` 同步 lock）。
- JSON-LD 的两个 `beforeInteractive` `<Script>` 保留。

## 2. 移动端 LCP 元素加优先级（`components/home/HomeHeroPhone.tsx`、`components/home/HomeHero.tsx`）

移动端 LCP 是首屏手机演示里的静态小地图 `<img src="/images/home/hero-phone-map.webp">`（已 `loading="eager"`），Lighthouse 指出缺 `fetchpriority=high`，加载延迟 2.1s。

改法：
- 该 `<img>` 加 `fetchPriority="high"`。
- 在 `HomeHero.tsx`（服务端组件）里对这张图与首屏插画各做一次 `preload`（`import { preload } from 'react-dom'`，`preload(src, { as: 'image', fetchPriority: 'high' })`；插画有横竖两张，按 `media` 无法在 preload 里区分时只预加载竖版 `hero-bg-portrait.avif`，因为移动端才是短板；桌面已达标）。`HomeShowcasePlan.tsx` 里已有 preload 用法可参考。
- 测试：`HomeHeroPhone.test.tsx` 断言 `fetchpriority="high"`。

## 3. 卡片图片按尺寸下发（桌面端 1.8 MB 浪费）

`/assets/<id>` 路由已支持 `?w=<px>&q=<1-95>` 输出 webp（`lib/asset/handlers.ts`），但首页与列表卡片直接用原图（900×1200、335 KB 塞进 200 px 卡片）。`components/anime/AnimeCard.tsx`、`components/city/CityCard.tsx`、`components/resources/ResourceCard.tsx`、`components/bookstore/BookCover.tsx` 各自复制了一份 `optimizeAssetCoverSrc`，且宽度写死 900。

改法：
1. 新建 `lib/asset/coverSrc.ts`，导出：
   - `assetCoverSrc(src, { width, quality = 75 })`：只对 `/assets/<id>`（相对或 `https://seichigo.com/assets/…` 绝对）加 `w`/`q`，其它 URL 原样返回；已有 `w` 的不覆盖。把四处重复实现删掉改为 import。
   - `assetCoverSrcSet(src, widths: number[], quality?)`：返回 `"…?w=320&q=75 320w, …?w=640&q=75 640w"`；非 `/assets/` URL 返回 `undefined`。
   - 单测 `tests/asset/coverSrc.test.ts`。
2. 用到卡片图的地方统一改成 `src = assetCoverSrc(cover, { width: 640 })` + `srcSet = assetCoverSrcSet(cover, [320, 640, 960])` + 合理的 `sizes`：
   - `components/home/HomeGuides.tsx`（攻略封面，`sizes="(min-width:1024px) 300px, (min-width:768px) 45vw, 100vw"`）
   - `components/home/HomeBrowse.tsx`（作品海报 `sizes="(min-width:1024px) 120px, 45vw"`，城市封面同）
   - `components/posts/PostsIndexTemplate.tsx`（若渲染封面）
   - `components/anime/AnimeCard.tsx`、`components/city/CityCard.tsx`、`components/resources/ResourceCard.tsx`、`components/bookstore/BookCover.tsx`（把写死的 900 改成 640 + srcSet）
   所有这些 `<img>` 保持 `loading="lazy"`、`decoding="async"`（首屏可见的攻略段第一行可以 eager，其余 lazy）。
3. 不要碰 `lib/asset/handlers.ts` 的行为；只用它已有的参数。

## 4. 汇报

简短中文：改动文件、命令结果、需要人工确认的点（例如 package.json 去依赖后需要 `npm install`）。
