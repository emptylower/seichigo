# 分享 v2：目的地驱动面板 + 带位置的卡片 + 点位卡 2×2

日期：2026-09-08
状态：站长确认方向，待出实施计划
前置：v1 已上线（spec `2026-09-08-point-share-card-and-short-link-design.md`，deploy/2026-09-08T10-27-33Z）

## 站长反馈（原话要点）

1. 分享面板「复制图片」「复制文案」「保存图片」「X / Reddit / LINE / 小红书 / 微信」八个按钮平铺，用户要自己脑补每个平台需要哪几步，体感差。要么按场景一次点完，要么只分「图片 / 文案」两种。
2. 卡片只写了作品信息，没有点位信息（在哪、是什么），分享出去没用。
3. 点位详情面板四个动作按钮排成 3+1，应为 2×2。

## 决策

- 面板改为**目的地驱动**：每个目的地按钮做完该平台所需全部动作；手段类动作（复制图 / 复制文案 / 保存图）收进「更多」。
- 卡片补**位置与说明**：地址行（反向地理编码，按点位缓存）、日本轮廓定位小图、点位说明摘要、点位名去作品名前缀；文案同步带位置。
- **不用 MapTiler 静态地图**：该接口免费套餐不可用（文档明说 "Static maps don't work with a free plan"），最低付费档约 25 美元/月，站长未订阅。定位小图用 Natural Earth 50m 日本轮廓（公有领域），已入库 `components/share/data/japan-outline.json`（`{bbox:[minLon,minLat,maxLon,maxLat], rings:[[lon,lat][]][]}`，34 环 1,097 点）。若日后订阅 MapTiler 付费档，可把定位小图换成静态地图，卡片其它部分不变。
- 反向地理编码用 MapTiler Geocoding（免费套餐可用，已验证三语返回），结果**服务端缓存到新表**，每个点位只查一次。

## 一、目的地驱动的分享面板

### 布局

```
手机（底部抽屉）                       桌面（居中弹窗）
┌────────────────────────┐            ┌──────────────────────────────┐
│ 卡片预览                │            │ 卡片预览                      │
│ 版式 [竖版][横版] 添加实拍 │            │ 版式 [竖版][横版]     添加实拍  │
│ 文案 《…》圣地巡礼｜… ›  │  ← 一行摘要，点开可编辑
│ ┌────────────────────┐ │            │ [ X ] [Reddit] [LINE]         │
│ │  分享到…（主按钮）    │ │            │ [小红书] [微信] [保存图片]      │
│ └────────────────────┘ │            │ 更多 › 复制图片 · 复制文案      │
│ [X][Reddit][LINE][小红书][微信] │      └──────────────────────────────┘
│ 更多 › 保存图片 · 复制文案 │
└────────────────────────┘
```

「手机 / 桌面」的判定：`navigator.canShare?.({ files: [blob] })` 为 true 视为手机路径（能带图走系统分享），否则桌面路径。不按 UA 判断。

### 每个按钮的动作（一次点击做完）

| 按钮 | 手机路径 | 桌面路径 |
|---|---|---|
| 分享到… | `navigator.share({ files:[卡片], text: 文案, url: 短链?c=sys })` | 不显示 |
| X | 同「分享到…」但 `c=x`（系统面板里用户选 X） | 1) 卡片图写剪贴板 2) 打开 `twitter.com/intent/tweet?text=<文案含短链 c=x>`；toast「图片已复制，在推文里粘贴」。剪贴板写图失败 → 改为下载图片，toast「图片已下载，拖进推文即可」 |
| Reddit | 同上 `c=rd` | 打开 `reddit.com/submit?url=<短链 c=rd>&title=<标题>`；图片靠短链 OG，不额外动作 |
| LINE | 同上 `c=ln` | 打开 LINE 网页分享 `url=<短链 c=ln>&text=<文案>` |
| 小红书 | 同上 `c=xhs` | 1) 下载图片 2) 文案写剪贴板；toast「图片已保存、文案已复制，打开小红书粘贴」 |
| 微信 | 同上 `c=wx` | 同小红书，toast 文案换微信 |
| 保存图片 | 下载 `c=save` | 下载 |
| 更多 › 复制图片 | 隐藏（手机不需要） | 卡片图写剪贴板 |
| 更多 › 复制文案 | 文案写剪贴板 `c=copy` | 同 |

约束：
- 「写剪贴板 + 打开新窗口」必须在同一次 click 事件同步链路里完成：先 `window.open` 拿到窗口引用（或先 `open('about:blank')` 再设 `location`），再 `await` 剪贴板写入，避免弹窗拦截。实施时以现有 `shareClient.ts` 的能力为基础改。
- 每个动作前确保短链已创建（v1 已实现），未就绪时按钮禁用态。
- 文案框默认折叠为一行摘要（前 40 字 + `…`），点击展开成 textarea 可编辑；编辑后的文案用于所有动作。
- 「更多」默认折叠，点击展开一行小按钮。

### i18n

新增 / 调整 `share.*` key：`shareTo`（分享到…）、`more`（更多）、`toastImageCopiedPasteInPost`、`toastImageDownloadedDragIntoPost`、`toastSavedAndCopiedOpenApp`（带 `{app}` 占位）、`captionCollapsed` 无需 key（直接截断）。三语齐全，`tests/i18n/shareKeys.test.ts` 同步。

## 二、卡片补位置与说明

### 数据

新表（Prisma + 迁移）：

```prisma
model AnitabiPointAddress {
  pointId    String   @id
  addressZh  String?
  addressEn  String?
  addressJa  String?
  source     String   @default("maptiler")
  resolvedAt DateTime @default(now())
}
```

不给 `AnitabiPoint` 加列（该表由同步管线维护）。

新接口 `GET /api/share/point-context?pointId=<id>&locale=<zh|en|ja>`：
- 查 `AnitabiPoint`（含 `geoLat/geoLng/note/name/nameZh`）与 `AnitabiPointI18n`（`name/note` 按 locale），查 `AnitabiPointAddress`。
- 无缓存且有坐标 → 服务端调 `https://api.maptiler.com/geocoding/{lng},{lat}.json?key=<NEXT_PUBLIC_MAPTILER_KEY>&language=zh,en,ja&limit=1`（一次请求拿三语；若接口不支持多语言并列则三次请求），解析后写入 `AnitabiPointAddress`。解析规则：取 `context` 里 `region`（都道府县）、`municipality`/`place`（市区町村）、`locality`/`neighbourhood`（町丁目）三级，跳过邮编与国家；zh 文本含 `/` 时取 `/` 前一段（接口会给「东京都/東京都」这种并列）。拼接：ja/zh 用空格无分隔（`東京都 武蔵野市 中町一丁目`），en 用逗号（`Nakacho 1-chome, Musashino, Tokyo`）。
- 地理编码失败或无坐标：`address` 为 null，不写缓存，不报错。
- 响应：`{ address: string|null, geo: [lat,lng]|null, note: string|null, inJapan: boolean, displayName: string, animeTitle: string }`。`inJapan` 用轮廓 bbox 粗判（`123.6 ≤ lng ≤ 145.9 且 24.2 ≤ lat ≤ 45.6`）。
- 限流：匿名与登录同 `/api/share/links` 的 ipHash 规则，每 IP 每日 300 次；接口结果 `Cache-Control: public, max-age=86400`。

### 点位名去作品名前缀（`displayName`）

服务端在 point-context 里算好：把点位名开头的 `『X』` / 《X》 / `X ` / `X：` / `X:` 去掉，X 与作品任一标题变体（`title`、`titleZh`、`AnitabiBangumiI18n.title` 三语）做全角半角折叠 + 大小写不敏感比较；去掉后为空则保留原名。示例：`『摇曳露营△ SEASON 3』葡萄牛奶` → `葡萄牛奶`。

### 卡片版面（`pointShareCardDraw.ts` / `PointShareCard.tsx`）

竖版 1080×1440：
```
┌──────────────────────────────┐
│ 动画截图（有实拍则上下分栏）        │  高 ~760
├──────────────────────────────┤
│ 葡萄牛奶                       │  点位名（displayName）大字，最多 2 行
│ 《摇曳露营△ 三期》· 第 1 集 19:54 │  作品行 + 集数时间戳（小字）
│ 📍 東京都 武蔵野市 中町一丁目      │  地址行，最多 1 行省略
│ 武州屋 x 远林 x 摇曳露营 推出了…   │  note 摘要，最多 2 行省略
│                                │
│ [日本轮廓+定位点]      [二维码]   │  左 260×260 轮廓，右 180 二维码
│ 鳥 seichigo.com                 │  页脚
└──────────────────────────────┘
```
横版 1200×630：左 55% 截图（有实拍则左右分栏各占一半宽），右列依次点位名（1 行）、作品行、地址行、note 1 行、底部左轮廓 150×150 右二维码 110。

- 轮廓绘制：等距圆柱投影加 `cos(平均纬度)` 横向修正，填充 `#fbcfe8`、描边 `#ec4899`，定位点 `#db2777` 圆，半径按画布比例；`inJapan` 为 false 时不画轮廓，二维码靠右，空位留白。
- 无地址时地址行不画；无 note 时跳过；文字块高度按存在的行数动态排，页脚固定在底。
- `tests/components/pointShareCardDraw.test.ts` 加几何断言：所有行都在页脚之上；轮廓投影函数把 bbox 四角映射到目标框内；东京坐标映射到轮廓框右侧偏下（x > 0.6 宽，y 在 0.45～0.7 高）。

### 文案

三语模板加 `{address}`（城市级：都道府县 + 市区，取地址前两级），无地址时删掉对应片段与分隔符（复用 v1 空城市的吞标点逻辑）。示例：`《摇曳露营△ 三期》圣地巡礼｜葡萄牛奶 · 東京都武蔵野市 https://seichigo.com/s/xxxx?c=x #圣地巡礼 #摇曳露营△三期`。

### 面板取数

面板打开时并行发 `POST /api/share/links` 与 `GET /api/share/point-context`；卡片等两者就绪再画（context 失败则按无地址无 note 画，不阻塞）。

## 三、点位卡动作按钮 2×2

`features/map/anitabi/DetailPanel.tsx` 159–190 行的动作区：外层改 `grid grid-cols-2 gap-2`，四个按钮去掉 `min-w-*`，统一 `w-full`。顺序：谷歌导航、进入全景、加入我的地图、分享。`tests/components/detailPanelShare.test.tsx` 加断言：四个按钮的父元素含 `grid-cols-2`。

## 非目标

- 不做 MapTiler 静态地图（付费）。
- 不改短链页、上传接口、限流规则（v1 保持）。
- 不做海外点位的国家轮廓。

## 验收

- 单测：地址解析（含 `/` 并列、缺级）、displayName 去前缀（三语标题、全角半角）、轮廓投影、文案含地址、面板按钮动作（桌面 X = 剪贴板 + 打开窗口；小红书 = 下载 + 复制文案）、「更多」折叠。
- 本地冒烟（`DATABASE_URL` 显式指开发库）：开点位 → 分享 → 卡片含地址行、轮廓、note → 下载 JPEG；桌面「小红书」一次点击得到下载 + 剪贴板文案。
- 上线后：GA `utm_medium` 分布应出现 `native`（系统分享）。

## 执行约定

- Track A（后端，glm）：Prisma 表与迁移、`lib/share/pointContext*`（地理编码客户端、地址解析、displayName）、`app/api/share/point-context/route.ts`、`lib/share/types.ts` 加 `PointContextResponse` 类型。
- Track B（前端，kimi）：面板重构、`shareClient.ts` 新增复合动作、卡片版面与轮廓绘制、文案模板、i18n、DetailPanel 2×2。
- 两条 Track 文件不相交；`lib/share/types.ts` 由 A 先建，B 只 import。
