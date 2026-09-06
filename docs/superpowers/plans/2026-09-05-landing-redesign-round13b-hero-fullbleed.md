# 第十三轮第二批：首屏通栏、顶部空白与背景几何修正（2026-09-05）

预览 `ccbba6c4` 上量到的问题（1440×900，页眉 65px）：
1. **首屏顶部多出 64px 空白**：`HomePageTemplate` 根 `div.space-y-16` 的第一个子元素是 `PlaceJsonLd` 的 `<script>`，
   `space-y` 把 64px 上边距加到了首屏上（`sectionTop=161 = 65 页眉 + 32 main padding + 64`）。
   这个 bug 在第十二轮就存在（老截图标题上方那片空白就是它）。
2. **首屏没有通栏**：`SiteShellPublic` 的 `<main>` 是 `max-w-5xl px-4 py-8`，首屏 section 被限制在 1024px 里，
   背景光斑在 section 左右边缘被 `overflow-hidden` 切出硬边（截图右上角能看到矩形边）。
3. **点阵/路线层几何不对**：点阵盒子 `left-35% right-0` 配 `xMidYMid meet` 后，日本群岛落在首屏中下部，
   东京那团高密度点（r 2.4、0.26）压在示例 chip 和滚动条上成了一坨粉；路线线宽 0.6 viewBox 单位在 640px 盒子里约 4px，太粗；
   城市名"京都""镰仓"和滚动条文字、演示卡片重叠。
4. 折叠线：因为 1+2，首屏底部到 997px 而不是 900px。

工作方式同上一批：先补/改失败测试再改实现；**不要 git commit / git add / git stash / git push**；不跑迁移；
每个源文件 ≤ 750 行。允许改：`components/home/**`、`styles/globals.css`（仅新增一条 `data-layout-flush` 规则）、
`tests/components/home/**`、`tests/layout/**`（若存在对应测试）。不要动 `lib/**`、`content/**`、`scripts/**`。

## 任务
### T1 顶部空白与通栏（`HomePageTemplate.tsx`、`styles/globals.css`）
- `HomePageTemplate` 根元素加 `data-layout-wide="true"`（`<main>` 变 `max-w-none px-0`），
  并新增 `data-layout-flush="true"`；在 `styles/globals.css` 紧挨着 `data-layout-immersive` 那条规则旁加：
  `.site-shell-public:has([data-layout-flush='true']) > .site-shell-public__main { padding-top: 0; }`
  （只去顶部内边距，底部保留，页眉页脚照常）。
- JSON-LD `<script>` 移到根元素**之外或最后**，不要再做 `space-y` 的第一个子元素。
- 首屏 `HomeHero` 直接通栏；其余各段（展示计划、地图预览、攻略、浏览、FAQ）包进一个
  `<div className="mx-auto w-full max-w-5xl space-y-12 sm:space-y-16">`，宽度与上线版本完全一致（不许因为通栏而变宽）。
- 首屏内部内容容器（主体网格与入口卡行）统一 `mx-auto w-full max-w-5xl`（不是 6xl），与下面各段对齐。
- 验收：桌面 1440×900 下 `section.top === 页眉高度`，`section.bottom === 900 ± 2`，`#home-showcase` 顶部在滚动一屏后位于页眉下方。

### T2 背景几何（`HomeHeroBackdrop.tsx`、`HomeHeroRoute.tsx`、`HomeHeroDots.tsx`）
- 点阵 + 路线共用的盒子改为**贴右上的正方形**：`absolute -top-[8%] -right-[6%] h-[112%] aspect-square`（`lg`），
  `sm` 以下 `h-[70%]`。用 `mask-image: radial-gradient(ellipse 62% 58% at 62% 42%, #000 0%, #000 45%, transparent 100%)`
  一次性做四周淡出（替换现在的两层线性 mask），确保文案列（x < 60% 视口）下面几乎看不到点。
- 点阵背景档透明度降为 0.10 / 0.15 / 0.22。
- 路线：主线与灰虚线 `strokeWidth 0.25`，主线 opacity 0.6；标记 r 1.0，光环 scale 到 3；城市名 `fontSize 2.2`、gray-400。
  城市名只在标记落在盒子右半（x ≥ 50）时渲染，避免与文案重叠；被演示卡片盖住的部分无所谓。
- 光斑保持，但右上那团改成 `-top-40 -right-40`，让硬边落在视口外；左下那团 `-bottom-40 -left-40`。
- 移动端（390 宽）：点阵盒子在右上角、只占 70% 高，不影响标题可读。

### T3 视觉自检（必须做）
本 worktree 已经 build 过，可以起 dev server：`nohup npx next dev -p 3457 > /tmp/claude-501/… 或自己的日志路径 2>&1 &`，
记下 pid，**结束时按 pid kill，不要按端口 kill**（3001 是别的进程）。
用 `node /private/tmp/claude-501/-Users-mac-Desktop-seichigo-worktrees-plan-agent-m1/7b118f9d-178b-4630-86d2-7ae471f70964/scratchpad/r13-shot.mjs http://localhost:3457 <输出目录>`
截图并读取输出的 PNG（桌面 zh / 桌面 reduced-motion / 移动 zh 三张），逐项对照：
- 首屏底部恰好是三个入口卡 + 滚动提示，标题上方无大片空白；
- 光斑无硬边；点阵集中在右上，不压文案；路线细、标记小、城市名不与任何文字重叠；
- 移动端无横向滚动、标题可读。
不满足就继续调参数再截，直到满足为止；汇报时列出最终参数。

## 完成标准
`npx vitest run tests/components/home` 全绿；`npx tsc -p tsconfig.app.json --noEmit` 无错；`npm run typecheck:tests` 无新增；
`node scripts/check-line-budget.mjs` 通过；dev server 已按 pid 停掉；简短中文汇报（含最终几何参数与截图路径）。
