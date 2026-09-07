# 首页第二屏改静态世界地图（预渲染图 + 真实点位数标签）

日期：2026-09-07　分支：feat/home-screens-v2。前置：`2026-09-07-home-screens-v2.md` §0 约束全部适用（不 commit / 不 stash、三语、行数预算、数字真实）。

背景：现在第二屏用 MapLibre 现场加载 MapTiler 瓦片，带宽和首屏压力大，且与定稿原型差异大（只显示了东京一个标签，浮动小卡位置与内容不对）。目标：**页面不再加载任何地图瓦片与 maplibre**，第二屏是一张预渲染的世界地图图片（陆地白、海洋淡蓝、粉色热力点位），上面用 HTML 叠加真实点位数的城市/地区标签，右上角挂原型里的「放大预览」小卡。

本文分两部分，由不同执行者完成：**A 部分（脚本与数据契约）**、**B 部分（前端组件）**。两部分靠 §1 的 JSON 契约衔接。

## 1. 数据契约：`content/generated/home-map-world.json`

```jsonc
{
  "generatedAt": "2026-09-07T…Z",
  "totalPoints": 50597,                       // 原样来自 home-map-clusters.json
  "image": {
    "src": "/images/home/map-world.webp",     // 1x，1208×441
    "src2x": "/images/home/map-world@2x.webp",// 2x，2416×882
    "width": 1208,
    "height": 441,
    // 图片覆盖的地理范围：等距圆柱投影，经度从 lngStart 起向东 lngSpan 度（跨 180° 回绕），纬度从 latTop 到 latBottom
    "bounds": { "lngStart": -22, "lngSpan": 345, "latTop": 74, "latBottom": -52 },
    "attribution": "底图：TUBS / Wikimedia Commons, CC BY-SA 3.0"
  },
  "labels": [
    // 按 count 降序；只给经纬度，像素位置由前端按 bounds 换算（纯函数）
    { "key": "tokyo", "name": { "zh": "东京", "en": "Tokyo", "ja": "東京" }, "count": 13959, "lng": 139.69, "lat": 35.69, "primary": true },
    { "key": "kyoto", "name": { "zh": "京都", "en": "Kyoto", "ja": "京都" }, "count": 4392, "lng": 135.77, "lat": 35.01 },
    { "key": "london", "name": { "zh": "伦敦", "en": "London", "ja": "ロンドン" }, "count": 612, "lng": -0.13, "lat": 51.51 }
  ]
}
```

像素换算（前端与脚本共用同一公式）：`x% = (((lng - lngStart) % 360 + 360) % 360) / lngSpan * 100`，`y% = (latTop - lat) / (latTop - latBottom) * 100`。

- 日本城市标签（东京/京都/镰仓/山梨/名古屋/饭能/大阪/沼津）直接沿用 `home-map-clusters.json` 的 `labels`（名字、count、lng/lat 原样）。
- 海外地区标签的 count = `cells` 中落在该地区中心 **半径 1.2°（经纬度）圆内** 的所有格子 `count` 之和（真实数据，口径写进脚本注释）。候选表（zh/en/ja 名与中心经纬度）固定写在脚本里：首尔 (126.98, 37.57)、上海 (121.47, 31.23)、台北 (121.56, 25.03)、香港 (114.17, 22.32)、曼谷 (100.50, 13.75)、新加坡 (103.82, 1.35)、悉尼 (151.21, -33.87)、洛杉矶 (-118.24, 34.05)、纽约 (-73.99, 40.73)、伦敦 (-0.13, 51.51)、巴黎 (2.35, 48.86)、威尼斯 (12.34, 45.44)、科尔马 (7.36, 48.08)、莫斯科 (37.62, 55.75)、檀香山 (-157.86, 21.31)。**count < 20 的不输出**。
- `primary: true` 只给 count 最大的一条（东京），前端把它的数字用粉色。
- 脚本硬断言：labels ≥ 6 条、每条经纬度在 bounds 内、两张图存在且 2x 图 ≤ 350 KB。

## A 部分：脚本 `scripts/generate-home-map-world.mts`（执行者：后端）

**不使用 MapLibre / Playwright / 瓦片。** 底图是现成的公开地图文件，脚本只做下载、重上色、裁切、烘焙点位、落盘。

允许改动：`scripts/generate-home-map-world.mts`（新）、`scripts/homeMapWorldScript.ts`（新，纯函数：海外聚合、标签裁剪、经纬度→像素、断言、SVG 上色替换）、`lib/home/mapWorld.ts`（新，`parseHomeMapWorld(raw): HomeMapWorld | null`，形状校验，参考 `lib/home/mapClusters.ts`；同时导出上面的像素换算纯函数 `projectMapWorld(bounds, lng, lat): { xPct, yPct }` 供前端复用）、`lib/home/types.ts`（加 `HomeMapWorld`/`HomeMapWorldLabel`/`HomeMapWorldBounds` 类型，`HomePortalData` 加可选 `mapWorld?: HomeMapWorld | null`）、`lib/home/generatedHomeFiles.ts` 与 `lib/home/getHomePortalData.ts`（读取 `home.mapWorld`，缺失时为 null、不影响其它数据）、`package.json` 的 scripts（加 `"generate:home-map-world"`）、`tests/home/**`、`tests/scripts/**`。**不要改任何 `components/**`。** 依赖只用仓库里已有的 `sharp`（看 `scripts/generate-home-hero-phone-map.mts` 怎么用），不要新增依赖。

脚本步骤：

1. **下载底图**：`https://upload.wikimedia.org/wikipedia/commons/b/b0/World_location_map_%28equirectangular_180%29.svg`（TUBS，CC BY-SA 3.0，2520.631×1260.315，viewBox 正好是经度 -180..180、纬度 90..-90 的等距圆柱投影——已验证）。用 `fetch` 下载到 `.omc/cache/world-location-map.svg`（gitignore 目录，二次运行直接用缓存），请求头带 `User-Agent: seichigo-dev/1.0 (contact@seichigo.com)`。脚本文件头注释写明来源、作者与许可。
2. **重上色**（对 SVG 文本做字符串替换，已验证这几个色值就是全部）：陆地 `#FDFBE5`→`#FFFFFF`；海洋 `#C9EBFC`→`#DCEBFA`；海岸线描边 `#1178AC`→`#B9D3EA`；国界 `#646565` 与 `#656565`→`#E3E6EB`；`#C12838`（一个红圈标记）与 `#F7BC60`（一个橙色小方块）→`none`。
3. **栅格化**：`sharp(Buffer.from(svg), { density })` 渲染成 2520×1260 的位图（背景 `#DCEBFA`）。
4. **裁成太平洋居中视角**：目标范围 `lngStart -22、lngSpan 345、latTop 74、latBottom -52`。等距圆柱下像素是线性的：先按经度把 -22..180 与 -180..(-22+345-360=-37) 两段 `extract` 出来横向拼接（`sharp` 的 `composite` 到一张 2416 宽的画布上），再按纬度 `extract` 出 74..-52 那一段，得到 2416×882。
5. **烘焙点位**：把 `home-map-clusters.json` 的 `cells` 用同一公式换算成像素，生成一张同尺寸的 SVG 叠层（`sharp` 会用 librsvg 渲染）：每个格子三层 `<circle>`，颜色 `#ec4899`——光晕 r 按 count 插值 6→22、opacity 0.12；中层 r 2→8、opacity 0.35；核心 r 1.2→3.5、opacity 0.9（2x 图上半径乘 2）。**不要用 SVG filter**（librsvg 对 blur 支持不稳），光晕用 `<radialGradient>`（中心 #ec4899 不透明度 0.35 → 边缘 0）代替模糊。`composite` 到底图上。
6. **落盘**：`public/images/home/map-world@2x.webp`（2416×882，q 82）与 `public/images/home/map-world.webp`（缩到 1208×441，q 82）；2x 超过 350 KB 就降 q 到 74 再试，仍超则非零退出、不落盘。
7. **标签**：按 §1 规则计算，写 `content/generated/home-map-world.json`（包含 `bounds` 与 `attribution`）。
8. 脚本写完后实际运行一次，两张图与 JSON 都要进 git（B 部分依赖）。运行失败如实报告，不要造假图。

测试：`scripts/homeMapWorldScript.ts` 的纯函数（海外半径聚合、`< 20` 裁剪、primary 唯一、经纬度→像素含跨 180° 回绕、SVG 色值替换、断言）与 `lib/home/mapWorld.ts` 的形状校验 + `projectMapWorld` 各写单测；`tests/home/getHomePortalData.test.ts` 补「`home.mapWorld` 缺失时 `mapWorld` 为 null 且其它数据不受影响」。

完成标准：`npm run typecheck:app`、`node scripts/check-line-budget.mjs`、`npx vitest run tests/home tests/scripts`，以及 `content/generated/home-map-world.json` 与两张图真实存在、`ls -la` 出来的大小在预算内。

## B 部分：前端 `components/home/HomeMapDatabase.tsx` 改静态（执行者：前端）

前提：A 部分产物已存在。允许改动：`components/home/HomeMapDatabase.tsx`、`components/home/homeMapDatabaseUtils.ts`、`components/home/HomePageTemplate.tsx`（只改传参）、三语 locale、`tests/components/home/**`。**不要改 `lib/home/**`、`scripts/**`、`content/generated/**`、`public/images/**`、`HomeHero*.tsx`。**

改法：

1. Props 改为 `{ locale; world: HomeMapWorld | null; stats?: HomeStats; demo?: HomeHeroDemoLike }`；`HomePageTemplate` 传 `data.mapWorld`。`world` 为 null 时整段不渲染（与现在 `cells` 为空的行为一致）。**删除** maplibre 的全部代码：动态 import、IntersectionObserver、FakeMap 测试、`zoomForWidth`、碰撞规避里依赖 `project()` 的部分；`homeMapDatabaseUtils.ts` 只保留还在用的纯函数（千位取整、副标题、标签碰撞判定改成基于 JSON 里的 x/y）。
2. 地图卡片：`relative overflow-hidden rounded-3xl border border-gray-200 shadow-*`，内部是 `<img>`（`src` 1x、`srcSet` 2x、`width/height` 写死避免 CLS、`loading="lazy"`、`decoding="async"`、`alt=""`、`aria-hidden`），`aspect-ratio: 1208/441`（用 `image.width/height`），`w-full h-auto`。移动端（`< md`）同一张图 `object-cover` 固定高度 `h-72`、居中裁切，并**隐藏所有标签**。
3. 标签：每条 `labels` 渲染一个白色胶囊（`absolute rounded-full bg-white/95 px-2.5 py-1 text-xs shadow`，`data-map-label`），定位用百分比：用 `lib/home/mapWorld.ts` 导出的 `projectMapWorld(world.image.bounds, lng, lat)` 得到 `xPct/yPct`，`left: xPct%`，`top: yPct%`，`transform: translate(-50%, calc(-100% - 8px))`（胶囊悬在点位上方）。内容「{name[locale]} {count 千分位}」，`primary` 的数字 `text-brand-600 font-bold`，其它 `text-gray-900 font-semibold`。碰撞规避：按 count 降序，先把百分比换算成桌面基准宽度 1208px 下的像素，再用估计宽高（现有 `estimateMapLabelWidth`）做矩形相交判定，相交则跳过——保留纯函数并单测。桌面上东京、京都、大阪、镰仓四个日本标签会挤在一起，允许只留东京 + 京都/大阪中的一两个，但海外的（伦敦、首尔、洛杉矶等）必须都能显示出来；若日本标签把海外标签挤掉了，说明碰撞判定有 bug。
4. 统计胶囊：保持现在的三个（作品 / 巡礼点位 / 攻略），位置在地图卡片左下角 `absolute left-4 bottom-4`（移动端改到卡片下方横排，现有行为）。
5. 「放大预览」小卡按原型重做：`absolute -top-8 -right-6 w-[300px]`（挂在地图卡片右上角、**溢出卡片边缘**，所以外层 section 不能 `overflow-hidden`，卡片本身的 `overflow-hidden` 只裁图片，小卡放在卡片的**兄弟**层级而不是子级），`rounded-2xl bg-white p-3 shadow-xl border border-gray-100`。内部：
   - 上半：`demo.map.src` 静态缩略图（`hero-phone-map.webp`）`rounded-xl h-40 object-cover`；在图上按 `demo.map.markers` 画粉色小圆点，另外**再撒 8 个装饰性小圆点**（位置写死在组件常量里，`aria-hidden`；原型允许图像不写实），其中 `markers[0]` 用大一号带白边的粉色圆点表示「选中」；右上角胶囊「东京 · 新宿区」。
   - 下半：一张点位小卡（`demo.day.items[0]` 的缩略图 + 标题「{title}」+ `ChevronRight`），标题后面加作品名「· 《你的名字》」——作品名从 title 的「・」前段取（复用 `homeShowcase.ts` 里的作品名提取函数）。
   - 底部一行小字 + 小图标（`MousePointerClick`）：「每一个点都能点开看」。
   - `demo` 或 `demo.map` 缺失时不渲染小卡；`< lg` 隐藏。
6. 副标题、大数字、按钮等其它部分不变。
7. 地图卡片右下角加一行极小的灰字（`text-[10px] text-gray-400`）显示 `world.image.attribution`（底图许可要求署名）。

测试：重写 `tests/components/home/HomeMapDatabase.test.tsx`：渲染 `<img>` 且 `srcSet` 含 2x；标签数量 = 碰撞后应保留数、海外标签全部在（fixture 里放东京/京都/伦敦/首尔/洛杉矶，东京与京都经度只差 4°、纬度只差 0.7°）；`primary` 数字带 `text-brand-600`；`world` 为 null 返回 null；无 `demo.map` 不渲染小卡。`homeMapDatabaseUtils.test.ts` 同步。`HomePageTemplate.test.tsx` 传参同步。

完成标准：`npm run typecheck:app`、`node scripts/check-line-budget.mjs`、`npx vitest run tests/components/home tests/home tests/i18n`；并确认 `grep -rn "maplibre" components/home/` 只剩 `HomeHeroRoute`/`HomeHeroPhone` 等原有引用、`HomeMapDatabase.tsx` 里没有。

## 汇报

各自用简短中文汇报：改动文件、命令结果、需要人工确认的点。

## A-2 点位半径修正（看图后的调整）

首次产出的图里日本糊成一整块、欧洲是一团团大圆斑，与原型的「细密小点 + 微光」差距大。原因是 0.1° 格子在 2416px 宽的图上只有约 0.7px 间距，半径给到 6→22 必然糊。改为（2x 图上的像素值，1x 由缩图得到）：

- 光晕层：r 按 count 对数插值 2.5 → 7，径向渐变中心 opacity 0.22 → 边缘 0；
- 中层：r 1.2 → 3，opacity 0.28；
- 核心：r 0.7 → 1.6，opacity 0.9。

目标：日本仍是最亮的一片，但能看出由很多小点组成、有疏密纹理；伦敦/巴黎/首尔/洛杉矶是清晰的小簇而不是大圆斑。改完重新运行脚本落盘两张图，`ls -la` 报大小，测试同步。

## A-3 点位强度回调（第二次看图）

A-2 之后在页面上（1x 约 1150px 宽显示）日本只剩一条细粉带、欧洲几乎看不见，太淡了。取 A-1 与 A-2 之间：

- 光晕层：r 3.5 → 10，径向渐变中心 opacity 0.30 → 边缘 0；
- 中层：r 1.6 → 4，opacity 0.34；
- 核心：r 0.8 → 1.8，opacity 0.92。

目标：在 1x 显示下日本是一片明显发亮、但仍能看出内部疏密纹理的粉色区域；伦敦/巴黎/首尔/洛杉矶是一眼能看到的小簇。重新运行脚本落盘，报 `ls -la` 大小，测试同步。只改 `scripts/**` 与 `tests/scripts/**`。

## B-2 标签放置与小卡文案（第二次看图）

只改 `components/home/HomeMapDatabase.tsx`、`components/home/homeMapDatabaseUtils.ts`、`tests/components/home/**`。

1. **标签放置改成四方位回退**：每个标签按 count 降序依次尝试「上方（现有）→ 右侧 → 下方 → 左侧」四个锚位，取第一个不与已放置矩形相交的；四个都相交才跳过。锚位与胶囊的偏移：上方 `translate(-50%, calc(-100% - 8px))`、右侧 `translate(8px, -50%)`、下方 `translate(-50%, 8px)`、左侧 `translate(calc(-100% - 8px), -50%)`。估计宽度里的左右 padding 余量从 22 降到 16。目标：真实数据下桌面至少能同时显示 东京、京都或大阪、首尔或上海、伦敦、巴黎、香港、新加坡、洛杉矶、纽约、悉尼 中的 9 个以上；测试用真实 `content/generated/home-map-world.json` 的 labels 做一条断言（≥ 9 且含首尔或上海、含巴黎或威尼斯）。
2. **避开右上角小卡**：桌面上小卡占据地图卡片右上角约 `width 300px × height 300px`（相对 1208px 基准换算），落在这个矩形内的标签在四方位都试不出来时跳过；把该矩形作为「已占用」预置进碰撞列表即可。
3. **小卡里的点位名**：标题 `demo.day.items[0].title` 形如「你的名字・须贺神社男坂」，显示成「须贺神社男坂 · 《你的名字》」——即「・」后的点位名 + 作品名书名号；没有「・」就原样显示标题。`line-clamp-1`。
4. 标签胶囊字号在 `lg` 以下不显示（现有），`lg` 上 `text-xs`；`primary` 的胶囊整体略大一号（`text-[13px] px-3`）。
