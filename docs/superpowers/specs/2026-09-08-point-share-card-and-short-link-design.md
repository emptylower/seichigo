# 点位分享卡片 + 短链设计

日期：2026-09-08
状态：设计已由站长确认，待出实施计划

## 背景

- 社区获客前提是「产品能被分享」。GA 近 28 天 Organic Social 1 会话、Referral 15 会话，社区渠道为零。
- 现状盘点（2026-09-08）：
  - 点位深链 `/map?b=<bangumiId>&p=<pointId>` 已能直接打开点位卡（`features/map/anitabi/useAnitabiMapController.ts:144-146`、`media.ts:37-67` 解析 `b/p/mlng/lat/z/tab/q`）。
  - 地图页 OG 图 `app/api/anitabi/share-image/route.tsx` 是 302 到 `web-logo.png` 的紧急降级（commit 792638a：next/og 撑爆 Worker 10 MiB）。`@vercel/og` 仍在依赖里但无引用。
  - 客户端 canvas 画卡能力已存在：`components/share/CheckInCard.tsx`（1080×1350）、`components/comparison/ComparisonImageGenerator.tsx`、`components/share/RouteBookCard.tsx`；跨域安全图片 URL 用 `lib/anitabi/imageProxy.ts` 的 `toCanvasSafeImageUrl`。
  - 点位详情面板 `features/map/anitabi/DetailPanel.tsx:184-192` 的「打卡卡片」按钮仅在已打卡后出现，文案硬编码中文。
  - 打卡照片从未上传：`components/checkin/CheckInModal.tsx:73-77` 请求体只有 `{pointId, state}`，`UserPointState.photoUrl`（`prisma/schema.prisma:846`）恒为空；后端读写链路已具备（`lib/userPointState/handlers/pointStates.ts:30,102-103`）。
  - 用户上传 R2 的现成模式：`app/api/assets/route.ts` → `lib/asset/handlers.ts`（formData、contentType 校验）→ `lib/asset/store.ts`（`getCfBindings()?.env?.ASSET_STORE`，桶 `seichigo-assets`）。
  - 分享文案全部内联在组件里，`lib/i18n/locales/*.json` 没有任何 `share*` key。
  - ja/en 的文章页、作品页、城市页没有 `opengraph-image.tsx`，也没设 `openGraph.images`，链接预览无图。

## 三个已定决策

1. 分享主角是**单个点位**。
2. 优先平台：X、小红书/B 站动态、Reddit、微信/LINE。
3. OG 图走「分享时上传卡片 + 短链」，不做服务端渲染；**匿名可分享，上传限登录**。

## 目标

用户在任意点位上，两步之内得到一张好看的图和一条带预览图的链接，能直接发到上述平台；每次登录用户的分享都为站点积累一张实景图和一条打卡记录。

## 非目标

- 不做服务端渲染 OG Worker。
- 不做路线卡、规划结果分享、`/plan` 公开链接。
- 不做评论、点赞等社区功能。
- 不改地图页现有「分享当前视图」按钮的行为。

## 一、分享入口

- `DetailPanel.tsx` 点位模式下常驻「分享」按钮（桌面与移动端），**不再以 `checkedInSelectedPoint` 为条件**。原「打卡卡片」按钮删除，其能力并入分享面板。
- 点击打开分享面板：移动端为底部抽屉，桌面为居中弹窗。装配在 `features/map/anitabi/MapDialogs.tsx`，与现有 CheckInCard 装配方式一致。

## 二、分享面板

### 卡片渲染器 `components/share/PointShareCard.tsx`

- 纯客户端 canvas 渲染，输入：点位 DTO（`lib/anitabi/types.ts` 的 `AnitabiPointDTO`：`name/nameZh/ep/s/image/geo`）、作品卡信息（`title/titleZh/city/cover/color`，来源同 `MapDialogs.tsx:314-317`）、locale、版式、可选实拍照片 File、短链 URL。
- 两种版式：
  - `portrait`：1080×1440（3:4），默认给小红书/B 站/微信/Instagram。
  - `landscape`：1200×630（1.91:1），默认给 X/Reddit/LINE 链接预览。
- 两种布局：
  - `default`：动画截图做主视觉；叠地名（当前语言，取 `AnitabiPointI18n.name` 回退 `nameZh`/`name`）、作品名（当前语言）、集数与时间戳（`ep`、`s`）、城市、短链二维码（`qrcode` 依赖已有）、右下角鸟居图标 + `seichigo.com`。
  - `compare`：仅当用户添加实拍时，左动画截图右实拍，其余元素同上。
- 图片一律经 `toCanvasSafeImageUrl` 取，避免 canvas 污染。
- 输出 JPEG（质量 0.9），控制在 1.5 MB 内；超出则降质量重试一次。

### 面板组件 `components/share/PointSharePanel.tsx`

- 顶部：卡片实时预览。
- 版式切换：竖版 / 横版，默认按上一次动作使用的平台记忆（localStorage），首次默认竖版。
- 「添加实拍」：`<input type="file" accept="image/*" capture="environment">`，选中后布局切为 `compare`；可移除。
- 文案预填（三语，写在 i18n），示例：
  - zh：`《{作品}》圣地巡礼｜{地名}（{城市}）{短链} #圣地巡礼 #{作品}`
  - ja：`『{作品}』聖地巡礼｜{地名}（{城市}）{短链} #聖地巡礼 #{作品}`
  - en：`{作品} anime pilgrimage: {地名}, {城市} {短链} #animepilgrimage #{作品}`
- 动作行：
  - 移动端主按钮「系统分享」：`navigator.share({ files: [卡片], text, url })`；不支持 files 时退化为 `{text, url}` 并提示先保存图片。
  - 桌面主按钮「复制图片」（`ClipboardItem` image/png）+「复制文案」。
  - 平台按钮行：
    - X：`https://twitter.com/intent/tweet?text=<文案含短链>`。
    - Reddit：`https://www.reddit.com/submit?url=<短链>&title=<标题>`。
    - LINE：`https://social-plugins.line.me/lineit/share?url=<短链>&text=<文案>`。
    - 小红书 / 微信：触发「保存图片」+「复制文案」，toast 提示「打开 App 粘贴」。
  - 「保存图片」：下载 JPEG。
- 每个动作调用前先确保短链已创建（见三），短链 URL 附渠道参数 `?c=` 取值 `x | rd | ln | xhs | wx | sys | copy | save`。

### i18n

- 新增 `share.*` 命名空间到 `lib/i18n/locales/{zh,en,ja}.json`：按钮、提示、toast、预填文案模板。
- 删除 `CheckInCard.tsx`、`DetailPanel.tsx:192`、`MapDialogs.tsx` 里与分享相关的硬编码中文；`features/map/anitabi/shared.ts` 里现有 `share*` 四条保留。

## 三、短链与预览图

### 数据模型（新增 Prisma model + 迁移）

```prisma
model ShareLink {
  id         String   @id @default(cuid())
  code       String   @unique          // 8 位，[a-zA-Z0-9]，服务端生成，冲突重试 3 次
  kind       String   @default("point")
  pointId    String
  bangumiId  Int
  locale     String                     // zh | en | ja
  layout     String                     // portrait | landscape
  imageKey   String?                    // R2 key，登录用户上传后填
  userId     String?
  clicks     Int      @default(0)
  createdAt  DateTime @default(now())

  @@index([pointId])
  @@index([userId])
}
```

迁移目录命名沿用 `prisma/migrations/2026MMDD000000_<name>`；生产库须同时注入 `DATABASE_URL` 与 `DATABASE_URL_UNPOOLED`（见 memory `seichigo-db-env-split`）。

### API

- `POST /api/share/links`：body `{pointId, bangumiId, locale, layout}`，匿名可调。返回 `{code, url}`。同一 `pointId + locale + layout + userId(或 null)` 24 小时内重复请求返回已有记录，不新建。匿名按 IP 限 100 次/日（复用 `lib/tripPlan/repoPrisma.ts:261` 的按日计数模式，或 KV 计数，实施时二选一并写明）。
- `POST /api/share/links/[code]/image`：**须登录**（`lib/auth/session.ts` 的 `getServerAuthSession`）。multipart 单文件；校验：JPEG 或 WebP、≤ 1.5 MB、像素尺寸必须等于 1080×1440 或 1200×630（读文件头解析尺寸，不解码整图）；每用户 30 次/日。写入 `ASSET_STORE` 桶，key `share/<code>.<jpg|webp>`；更新 `ShareLink.imageKey` 与 `userId`。
- `POST /api/share/links/[code]/photo`（可与上一条合并为同一 multipart 的第二个字段 `photo`）：登录用户附带实拍原图时，写入 `ASSET_STORE` key `checkin/<userId>/<pointId>.<ext>`，并通过现有 `lib/userPointState` 写 `photoUrl` 且 `state = 'checked_in'`。实施时按现有 handler 结构决定是否合并端点，spec 只约束行为。
- 卡片图片公开读取：`GET /api/share/img/<code>` 从 `ASSET_STORE` 读 `share/<code>.*`，`Cache-Control: public, max-age=31536000, immutable`。若 `ASSET_STORE` 已有公共域可直出则优先用公共域，实施时确认。

### 短链页 `app/s/[code]/page.tsx`

- `generateMetadata`：
  - `title`：`{地名}｜{作品} 聖地巡礼 | SeichiGo`（按 `locale`）。
  - `description`：作品、城市、集数一句话。
  - `openGraph.images` / `twitter.images`：`imageKey` 存在则为卡片图 URL；否则为该点位动画截图的 R2 公共域 URL（`img.seichigo.com`，规则见 `lib/anitabi/imageNormalize.ts:228-234`）。
  - `robots: noindex, follow`。
- 页面主体：一个极简 HTML，包含 `<meta http-equiv="refresh" content="0;url=...">` 与 JS 跳转，目标 `/{locale 前缀}/map?b=&p=&utm_source=share&utm_medium=<c 映射>&utm_campaign=point_card`。`c` 到 `utm_medium` 映射：`x→twitter, rd→reddit, ln→line, xhs→xiaohongshu, wx→wechat, sys→native, copy→copy, save→image`。
- 每次访问 `clicks + 1`（fire-and-forget，`ctx.waitUntil`，见 memory `seichigo-assets-on-r2`）。

## 四、顺手修掉的旧问题

- `app/(site)/map/page.tsx`（及 ja/en 版）：`buildMapShareImageUrl` 改为返回点位动画截图的 R2 公共域 URL；`p` 缺失时返回作品封面 R2 URL；都缺时返回 `/opengraph-image`。删除 `app/api/anitabi/share-image/route.tsx`，`@vercel/og` 从依赖移除。
- `app/ja/posts/[slug]`、`app/en/posts/[slug]`、`app/ja/anime/[id]`、`app/en/anime/[id]`、`app/ja/city/[id]`、`app/en/city/[id]`：`generateMetadata` 里 `openGraph.images` 与 `twitter.images` 指向对应 zh 目录已有的 `opengraph-image` 路由（如 `/posts/<slug>/opengraph-image`）。

## 五、验收

- 单元测试（vitest）：短码生成与冲突重试；上传校验（类型、大小、尺寸）；`/s/[code]` 的 `generateMetadata` 在有无 `imageKey` 两种情况下的 image URL；`buildMapShareImageUrl` 三种回退。
- 组件测试：`PointSharePanel` 三语文案渲染；平台按钮 URL 编码正确。
- 浏览器冒烟（Playwright，本地 `next start -p 3457`）：打开 `/map?b=&p=` → 点分享 → 面板出现 → 切换版式 → 「保存图片」得到 1080×1440 JPEG。
- 手工：X Card Validator 与 LINE 预览各贴一次短链，确认图与标题。
- 部署后：GA 里能看到 `utm_source=share` 的会话按 `utm_medium` 分渠道。

## 执行约定

- 前端（面板、渲染器、i18n）与后端（模型、API、短链页、OG 修复）可拆两条 opencode 任务，文件不重叠。
- 先本地构建验证，再合并 main 部署；迁移在部署前对生产库执行。
