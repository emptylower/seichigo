# 首页首屏背景与整屏布局设计（2026-09-05，第十三轮）

## 背景
第十二轮上线后用户反馈：首屏"空荡荡的，没有背景"，且首屏没有占满一屏，
第二屏（三个入口卡）的头部混进了第一屏。讨论后选定方向：
**全幅点阵地图底纹 + 一笔画出的巡礼路线动画，底下垫两团很淡的品牌色光斑**；
首屏锁定为一整屏，三个入口卡收进首屏底部作为收尾行。

## 目标
1. 首屏不再是纯白：有可感知但不抢焦点的装饰，讲"圣地地图 + 规划路线"的产品故事。
2. 桌面端首屏 = 视口高度减页眉，内容恰好到折叠线；第二屏从「看看规划师做出来的行程」干净开始。
3. 零新增依赖、零额外请求；全部动效尊重 `prefers-reduced-motion`；不引入 hydration 不一致。

## 非目标
- 不改第二屏及之后各段的内容与高度；不做 scroll-snap。
- 不改输入框、微演示、滚动条的行为。
- 移动端不锁首屏高度，按内容流式排。

## 设计

### 1. 背景层 `HomeHeroBackdrop`
绝对定位铺满 `<section>`，`aria-hidden` + `pointer-events-none`，三层自下而上：

- **光斑层**：两团用 `radial-gradient` 画的软色块（不用 `filter: blur`，移动端代价太高），
  一团 brand-300 偏杏色在右上，一团淡蓝在左下，透明度 ≤ 0.35。
  各自 `transform: translate` 缓慢漂移（约 18s / 22s，alternate 往返），reduced-motion 下静止。
- **点阵层**：复用 `HomeHeroDots`，但用 `computeCoreBounds(cells)`（日本核心范围）代替全球 bbox，
  让日本群岛铺满整层；位置整体右偏（`left: 35%`），层高等于 section 高度。
  透明度三档提到 0.12 / 0.18 / 0.26。
  用 CSS `mask-image` 做两段淡出：向左（文案与输入框区域）线性淡出，向下（进入入口卡）淡出到透明。
- **路线层** `HomeHeroRoute`：一条 SVG 路线经过 4 个城市，坐标用与点阵层**同一套 bbox 归一化**，
  所以标记与底纹上的密集点重合。城市取 labels 里 count 最高的 4 个，按经度从西到东排序
  （现数据下即 大阪→京都→镰仓→东京）。
  - 路径：相邻城市之间用二次贝塞尔曲线，控制点向北偏移 4 个单位，形成微弧。
    `pathLength="1"`，`stroke-dasharray: 1; stroke-dashoffset: 1 → 0` 做"画出来"动画，
    2.4s ease-in-out，延迟 0.4s，只跑一次并停留在画完状态。不需要 JS 量路径长度。
  - 标记：每个城市一个实心小圆（r=1.4，brand-500）外加一圈脉动光环
    （r 从 1.4 放大到 4.5、透明度 0.5→0，3s 循环）。标记按路径顺序依次在
    0.4s + i × 0.6s 时淡入；光环只在画完后才开始循环。
  - 城市名：标记右侧 `font-size: 3`（viewBox 单位）的 gray-500 文字，按 locale 取 `label.name[locale]`，
    只在 `sm` 以上显示。
  - reduced-motion：路径直接画满、标记直接显示、无光环动画。
  - 路线颜色 brand-500，`stroke-width: 0.6`，`stroke-dasharray` 动画用 CSS 类，
    dashed 视觉用第二条叠加的 gray-300 虚线（`stroke-dasharray: 1.5 1.2`，静态）表示"计划中的路线"。

数据入口：`HomeHero` 的 `dots` prop 扩为 `{ cells, labels }`；bbox 不再从外部传入，
由 `computeCoreBounds` 在背景层内部算一次（服务端渲染，纯函数）。

### 2. 首屏整屏布局
- `HomeHero` 的 `<section>` 改为 `flex flex-col`，`lg:min-h-[calc(100svh-var(--site-header-h))]`；
  页眉高度在 `globals.css` 里定义 `--site-header-h: 4rem`（与现有页眉实际高度对齐，实现时量一次）。
- 主体网格（文案 + 微演示）放在 `my-auto` 的容器里，垂直居中于可用空间。
- `HomeEntryCards` 改为由 `HomeHero` 在底部渲染（`mt-auto pt-8`），`HomePageTemplate` 不再单独渲染它；
  `HomeHero` 新增 `stats` prop 透传。`HomeEntryCards` 外层由 `section` 改为 `div`，最大宽度与首屏网格一致（`max-w-6xl`）。
- 入口卡下方居中一个向下滚动提示：`ChevronDown` 图标，2s 上下浮动，reduced-motion 静止；
  它是一个指向 `#home-showcase` 的链接（`HomeShowcasePlan` 的 section 加该 id），
  `aria-label` 用新 i18n 键 `pages.home.v2.heroScrollHint`（zh「向下看看」/ en「Scroll down」/ ja「下へ」）。
  只在 `lg` 以上显示。
- 顶部留白由 `pt-10/sm:pt-14` 改为 `pt-8`，垂直居中后不再需要大留白。

### 3. 可访问性与性能
- 背景所有元素 `aria-hidden`；焦点顺序不变。
- 点阵 ≤ 400 个节点（现有上限），路线 SVG 十几个节点；无 JS 动画循环，无 `filter`。
- 所有动画只用 `transform` / `opacity` / `stroke-dashoffset`。
- SSR 与客户端输出完全一致（无 `Math.random`、无时间、无 window 读取）。

## 测试
- `HomeHeroRoute`：4 个城市 → 1 条主路径（`pathLength="1"`）+ 4 个标记 + 4 个光环；
  城市按经度排序；locale 取对应名字；reduced-motion 下不带动画类。
- `HomeHeroBackdrop`：`aria-hidden`，包含点阵 `svg` 与路线 `svg`；cells 为空时不渲染。
- `HomeHero`：传入 `stats` 时底部出现 3 个入口链接；`HomePageTemplate` 里入口链接恰好 3 个（不重复渲染）。
- 既有 `HomeHero.test.tsx` 中 circle 数量断言按新的 prop 形状更新。

## 验收
预览域名上：桌面 1440×900 首屏底部恰好是三个入口卡 + 滚动提示，滚动一屏后第二屏标题在顶部；
背景能看到日本点阵与画出的路线；`prefers-reduced-motion: reduce` 下无动画；
移动端 390 宽无横向滚动、无锁高。
