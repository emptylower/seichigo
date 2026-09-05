# 第十三轮：首屏背景动效与整屏布局（2026-09-05）

设计见 `docs/superpowers/specs/2026-09-05-landing-hero-backdrop-design.md`，按其执行，本文只列任务与边界。

工作方式：先补失败测试再改实现；**不要 git commit / git stash / git add**；不跑迁移；
不要启动 `next dev`；每个源文件 ≤ 750 行（`node scripts/check-line-budget.mjs`）。
只碰：`components/home/**`、`app/globals.css`（仅新增 `--site-header-h`）、
`lib/i18n/locales/{zh,en,ja}.json`（仅新增 `pages.home.v2.heroScrollHint`）、
`tests/components/home/**`、`tests/i18n/**`（如键完整性测试需要）。
不要改 `lib/home/**`、`content/generated/**`、`scripts/**`。

## 任务
### T1 `HomeHeroRoute.tsx`（新）+ 测试
纯服务端可渲染组件：props `{ labels: HomeMapLabel[]; bbox: [number,number,number,number]; locale: SiteLocale }`。
选 count 最高 4 个，按 lng 升序；坐标归一化到 `viewBox 0 0 100 100`（与 `HomeHeroDots` 同一公式，
抽一个小的共享 `projectToViewBox(lng, lat, bbox)` 到 `heroProjection.ts`，`HomeHeroDots` 也改用它）。
主路径 `pathLength="1"` + CSS 画线动画；灰色静态虚线底路；标记 + 光环 + 城市名。
动画类名与 keyframes 用组件内 `<style>`（沿用 `HomeHeroDemo` 的做法），
`prefers-reduced-motion` 由 CSS media query 处理（不要用 hook，避免 SSR/客户端差异）。

### T2 `HomeHeroBackdrop.tsx`（新）+ 测试
props `{ cells: HomeMapCell[]; labels?: HomeMapLabel[]; locale: SiteLocale }`。
内部 `computeCoreBounds(cells)` 得 bbox；三层：光斑（两个 `div` 用 radial-gradient + 漂移 keyframes）、
点阵（`HomeHeroDots` 用 core bbox，透明度提到 0.12/0.18/0.26，mask 向左与向下淡出）、路线（T1）。
cells 为空返回 `null`。

### T3 `HomeHero.tsx` 布局改造 + 测试更新
- `dots` prop 改为 `{ cells; labels? }`；新增 `stats?: HomeStats`。
- section：`relative flex flex-col overflow-hidden px-4 pt-8 sm:px-6 lg:min-h-[calc(100svh-var(--site-header-h))]`；
  主体网格包在 `my-auto` 容器；底部 `HomeEntryCards`（`mt-auto pt-8`）与滚动提示（`lg` 以上显示，链接到 `#home-showcase`）。
- `HomeEntryCards`：外层 `section`→`div`，`max-w-6xl`。
- `HomePageTemplate`：去掉单独的 `<HomeEntryCards>`，把 `stats` 与 `labels` 传给 `HomeHero`；
  `HomeShowcasePlan` 的 section 加 `id="home-showcase"`。
- `app/globals.css` 增加 `:root { --site-header-h: <量出的页眉高度> }`
  （页眉是 `HeaderPublic.tsx`，看其容器 padding + `min-h-11` 算出；大概率 4rem 附近，取实际值）。
- i18n 三语新增 `pages.home.v2.heroScrollHint`。

## 完成标准
`npx vitest run tests/components/home tests/i18n` 全绿；`npx tsc -p tsconfig.app.json --noEmit` 与
`npm run typecheck:tests` 无新增错误；`node scripts/check-line-budget.mjs` 通过。
最后用简短中文汇报：改了哪些文件、页眉高度取值、路线经过的 4 个城市。
