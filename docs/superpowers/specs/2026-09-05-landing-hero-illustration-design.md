# 首页首屏插画背景 + 手机演示设计（2026-09-05，第十四轮）

## 背景
第十三轮做了点阵地图 + 路线一笔画 + 整屏布局。用户随后用生图模型出了一版参考稿：
富士山 / 晴空塔 / 樱花的浅色插画做整屏背景，右侧一台手机里跑规划师演示（chip → 地图 → Day 列表），
底部三个半透明入口卡，再压一句 slogan。用户提供了两张**不带路线与图钉**的干净背景图：
横版 1672×941、竖版 941×1672（源文件在会话 scratchpad `r14-assets/`，脚本以 `--src` 传入）。

用户决定：手机演示节奏按建议"跑一次停住"；slogan 桌面端加，移动端不加（移动端首屏本来就不锁一屏）；
"注意首屏加载压力"。

## 目标
1. 首屏用插画背景替换点阵与光斑；标题两行、"AI 规划师"品牌色高亮；副标题 / 示例 chip / 作品滚动条沿用现有文案与数据。
2. 右侧手机壳里跑一遍真实数据的规划演示（东京《你的名字》Day，3 个点位），地图用我们自己地图的静态截图，不加载地图库。
3. 首屏加载压力可控：背景图 AVIF/WebP，桌面 ≤ 220 KB、移动 ≤ 160 KB；手机演示全是 DOM/SVG；不新增运行时依赖。
4. 保留第十三轮：整屏布局、入口卡收尾、滚动提示、JSON-LD 空白修复。

## 非目标
- 不动第二屏及之后。不做 scroll-snap。不接真实地图库进首屏。

## 数据契约（§0）
### `content/generated/home-hero-demo.json`（形状升级）
```ts
type HomeHeroDemo = {
  planTitle: string
  day: {
    dayIndex: number            // 演示里固定显示 "Day 1"，与来源计划的实际天序无关
    summary: string
    items: Array<{ id: string; title: string; time: string; imageUrl: string; lat: number; lng: number }>
    transit: Array<{ fromId: string; toId: string; mode: string; label: string }>  // 相邻两点之间各一条
  }
  map?: {
    src: string                 // '/images/home/hero-phone-map.webp'
    width: number; height: number   // CSS 像素（1x）
    markers: Array<{ itemId: string; x: number; y: number }>   // 在 src 上的 CSS 像素坐标
    attribution: string         // '© MapTiler © OpenStreetMap contributors'
  }
}
```
`parseHomeHeroDemo` 兼容：`transit` 缺省为空数组；`map` 缺省为 undefined（前端退化为无地图的列表演示）。
来源：东京 8 日计划 `cmtk6aetq0000psp7292p6uu8`，选**标题含「你的名字」的点位条目最多的那一天**（当前为 Day 2：
须贺神社男坂 / 信浓町步道桥 / 四谷见附桥），取前 3 个带图可路由条目。`time` 取 `schedule.start`，
没有就按顺序给 `09:30 / 10:20 / 11:10`。transit 取该天两点之间的交通段文案，没有就按直线距离
（80 m/分钟）算成 `步行 · 约 N 分钟`。

### 手机地图静态图 `public/images/home/hero-phone-map.webp`
用 Playwright 起一个只含 maplibre-gl 的本地 HTML（`node_modules/maplibre-gl` 的 js/css 直接读文件内联），
style 用 `https://api.maptiler.com/maps/dataviz/style.json?key=${NEXT_PUBLIC_MAPTILER_KEY}`（`.env.local`），
视口 320×240、deviceScaleFactor 2，`fitBounds` 三个点 padding 36，等 `idle` 后截图，
`map.project()` 得到 3 个点的 CSS 像素坐标写进 `map.markers`。不画标记、不画线（前端动态叠）。
输出 WebP q80，≤ 60 KB。attribution 由前端在图角落以 9px 灰字显示。

### 背景图 `public/images/home/hero-bg-{landscape,portrait}.{avif,webp}`
`scripts/generate-home-hero-bg.mts --landscape <png> --portrait <png>`：sharp 输出
横版 1672 宽 AVIF（q 50）+ WebP（q 78），竖版 941 宽 AVIF（q 50）+ WebP（q 78）；打印每个文件大小并在超预算时非零退出。

## 前端设计
### `HomeHeroBackground`
`absolute inset-0`，`<picture>`：`(min-width:1024px)` 用横版 avif/webp，否则竖版；`<img>` `object-cover`，
桌面 `object-position: right center`，移动 `center bottom`；`loading="eager" fetchPriority="high" decoding="async"`、`alt=""`。
叠三层渐变：桌面左侧白→透明（0–35% 纯白 0.95，60% 0.35，85% 0），顶部页眉下 64px 白→透明，
底部最后 18% 透明→白（接第二屏）；移动端改成自上而下白 0.92 → 55% 处 0.3 → 底部 0，再加底部 18% 白。
可选樱花花瓣：6 片 SVG 花瓣沿各自 keyframes 漂落（12–18s，`transform` 只做 translate/rotate），`lg` 以上显示，reduced-motion 关闭。

### `HomeHeroRoute`（改造）
不再依赖点阵与 labels：固定路径，viewBox `0 0 1672 941` + `preserveAspectRatio="xMidYMid slice"`，
与背景 `<img>` 同一盒子、同一 object-position（右中），这样路径始终贴在画面同一处。
路径沿海湾 / 城市天际线从左下往右到晴空塔脚下（约 `M 560 830 Q 800 760 1000 740 Q 1200 720 1350 690 Q 1450 670 1500 640`），
4 个标记（白心粉边 r 9，最后一个带定位图钉）。画线 2.4s、标记依次弹出、光环脉动，reduced-motion 直接终态。仅 `lg` 显示。

### `HomeHeroPhone`（替换 `HomeHeroDemo`）
外壳：`w-[300px] h-[600px]` 圆角 44px，深色边框 10px，顶部灵动岛，内屏白底圆角 34px，`shadow-2xl`，`lg` 以上略向左倾（`-rotate-1` 可选，默认不转）。
屏内自上而下：状态栏（时间取 `09:41`、信号图标纯 CSS）→ 4 个步骤 chip（沿用 `heroDemoStep1..4`）→ 地图（`map.src`，
上面一层 SVG：编号图钉 1/2/3 在 `markers` 坐标，两段路线用二次贝塞尔连相邻图钉；attribution 角标）→
`Day 1 · 3 处 · 步行约 N 分钟` 汇总行 → 三条条目（缩略图 + 标题 + 时间）与两条交通行（沿用 `HomeHeroDemo` 现有的骨架 → 填充逻辑）。
`map` 缺省时不渲染地图块。

时序（`STEP_MS = 700`，`useEffect` + `setInterval`，与现 `HomeHeroDemo` 相同的计数写法）：
- t0：chip1 亮；t1：chip2 亮，三个图钉每 250ms 弹出；t2：chip3 亮，地图路线 1.2s 画出，三条条目逐条填入（150ms 淡入）；
- t3：chip4 亮，两条交通行出现，汇总行补上步行时长；然后停住。
- reduced-motion：直接终态。`heroDemo` 缺省时组件不渲染。

### `HomeHero`
- 标题：`heroTitle` 改为带 `{accent}` 占位的两段文案，`accent` 用 `text-brand-600`；三语：
  zh「动漫圣地巡礼行程，{accent}帮你排好」/ accent「AI 规划师」；
  en「Anime pilgrimage itineraries, {accent}」/ accent「planned by an AI planner」；
  ja「アニメ聖地巡礼の旅程を、{accent}が組み立てる」/ accent「AIプランナー」。
  `lg` 以上标题用 `text-5xl`，在「，」/「、」/「, 」后强制换行（zh/ja 用 `<br className="hidden lg:block">`）。
- 入口卡：`bg-white/75 backdrop-blur-sm border-white/60`，hover 变 `bg-white/90`。
- slogan：入口卡下、滚动提示上，一行居中灰字，两侧各一枚 `Sparkles`/月桂枝（lucide `Award` 不合适，用文字符号 `❝ ❞` 或纯文本），
  i18n `pages.home.v2.heroSlogan`：zh「动漫迷做给动漫迷的圣地巡礼平台」/ en「A pilgrimage platform by anime fans, for anime fans」/
  ja「アニメファンによる、アニメファンのための聖地巡礼プラットフォーム」。`hidden lg:block`。
- 去掉 `HomeHeroBackdrop` / `HomeHeroDots` / `heroProjection`（及其测试）；`HomePageTemplate` 不再传 `dots`。
- 首屏整屏、入口卡收尾、滚动提示、JSON-LD 顺序保持第十三轮。

## 性能约束
背景 `<img>` 是首屏 LCP 候选：只此一张、SSR 直出、`fetchpriority=high`；不 preload 手机地图与缩略图之外的任何图；
手机内缩略图 `loading="lazy"` 不需要（首屏可见），但都走本地 `/images/showcase/`。首屏 JS 不增加依赖。

## 测试
- 数据：`pickHeroDemo` 选「你的名字」最多的一天、transit 数组长度 = items-1、坐标透传；`parseHomeHeroDemo` 兼容旧/新形状；
  bg 脚本超预算退出（用小图 fixture）。
- 前端：`HomeHeroBackground` 的 `<picture>` 两组 source + 渐变层；`HomeHeroPhone` 假计时器下 chip 1→4、图钉 0→3、条目 0→3、交通行在第 4 步出现，
  `map` 缺省不渲染地图，reduced-motion 直接终态；`HomeHero` 标题 accent 三语、slogan 仅 `lg`、入口卡 3 个；`HomePageTemplate` 无 dots。

## 验收
预览域名：桌面 1440×900 首屏一整屏（入口卡 + slogan + 提示在折叠线内）、背景清晰、文字可读、手机演示跑一遍停住；
`/`、`/en`、`/ja` 三语；移动 390 竖版背景、无横向滚动；DevTools 首屏图片总量 ≤ 400 KB。
