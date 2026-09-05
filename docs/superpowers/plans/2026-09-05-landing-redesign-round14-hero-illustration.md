# 第十四轮：首屏插画背景 + 手机演示（2026-09-05）

设计见 `docs/superpowers/specs/2026-09-05-landing-hero-illustration-design.md`（含 §0 数据契约），按其执行。

工作方式：先补失败测试再改；**不要 git commit / git add / git stash / git push**；不跑迁移；不启动 build；
每个源文件 ≤ 750 行（`node scripts/check-line-budget.mjs`）。两条泳道并行、文件不相交：

- **A 数据（glm-5.3）**只碰 `lib/home/heroDemo.ts`、`scripts/**`、`content/generated/home-hero-demo.json`、
  `public/images/home/**`、`public/images/showcase/**`（只新增）、`tests/home/**`、`tests/scripts/**`。
- **B 前端（Claude Opus）**只碰 `components/home/**`、`lib/i18n/locales/*.json`、`tests/components/home/**`、`tests/i18n/**`。
  B 在 A 落盘前用测试 fixture 开发；`HomePortalData.heroDemo` 类型由 A 的 `heroDemo.ts` 提供，B 只读不改。

## A 数据
### A1 `heroDemo.ts` 形状升级 + `pickHeroDemo` 选天规则（§0）
新增 `lat/lng`、`transit[]`、可选 `map`；`parseHomeHeroDemo` 兼容旧形状；`pickHeroDemo(days, { anime: '你的名字' })`
选标题含该词的点位条目最多的一天，取前 3 个带图可路由条目；transit 取交通段文案，缺省按直线距离算步行分钟。
### A2 `scripts/generate-home-hero-demo.mts` 改造并重跑
默认 `--plan cmtk6aetq0000psp7292p6uu8 --anime 你的名字`；图片静态化规则不变（生产站代理 → `public/images/showcase/`）。
### A3 新脚本 `scripts/generate-home-hero-phone-map.mts`
按 §0 用 Playwright（`@playwright/test` 已装，chromium 已装）+ maplibre-gl 截 320×240@2x 的地图，
写 `public/images/home/hero-phone-map.webp`（sharp 转 webp q80，≤ 60 KB）并把 `map` 写回 `home-hero-demo.json`。
读 `.env.local` 的 `NEXT_PUBLIC_MAPTILER_KEY`。headless 需要 `--use-angle=swiftshader --enable-unsafe-swiftshader`。
### A4 新脚本 `scripts/generate-home-hero-bg.mts`
`--landscape /private/tmp/claude-501/-Users-mac-Desktop-seichigo-worktrees-plan-agent-m1/7b118f9d-178b-4630-86d2-7ae471f70964/scratchpad/r14-assets/bg-landscape.png --portrait .../bg-portrait.png`
→ `public/images/home/hero-bg-landscape.{avif,webp}`、`hero-bg-portrait.{avif,webp}`，预算见 §0，超预算非零退出。

完成标准：A1–A4 都实际跑出文件；`npx vitest run tests/home tests/scripts` 全绿；`npx tsc -p tsconfig.app.json --noEmit` 无错；
line-budget 通过；汇报：选中的天与 3 个条目标题、markers 坐标、每个图片文件大小。

## B 前端
### B1 `HomeHeroBackground.tsx`（新）+ 花瓣
### B2 `HomeHeroRoute.tsx` 改造为固定路径（与背景同盒同 slice）
### B3 `HomeHeroPhone.tsx`（新，替换 `HomeHeroDemo`；后者删除连同测试）
### B4 `HomeHero.tsx` / `HomePageTemplate.tsx` / i18n：标题 accent、半透明入口卡、slogan（lg）、去掉点阵与光斑
在 A 落盘前用 `tests/components/home/fixtures.ts` 里的 `heroDemoFixture()`（自己补 `lat/lng/transit/map`）开发；
背景图路径按 §0 写死，图片文件由 A 产出，本地看不到图时用纯色占位不影响开发。

完成标准：`npx vitest run tests/components/home tests/i18n` 全绿；`npx tsc -p tsconfig.app.json --noEmit` 无错；
`npm run typecheck:tests` 无新增；line-budget 通过。等 A 落盘后主会话再做视觉自检与预览。
