# 分享卡片改服务端渲染（Browser Run）

日期：2026-09-08
状态：站长确认「全面改服务端，删掉画布」，待出实施计划

## 缘起

1. 匿名分享的链接预览目前只有动画截图，没有卡片；要让匿名也有卡片，唯一的替代方案是放开匿名上传，会被拿来传违规图。
2. 面板打开到预览出现，线上实测 7.6 秒（面板首个请求前 3.2 秒被地图缩略图挤占，建短链 1.6 秒，取点位信息 1.7 秒，取图与绘制约 2.6 秒）。
3. 画布几何要手算，两轮里已经为「孤字断行」「留白」返工过。

## 验证结论（2026-09-08 实测）

Cloudflare **Browser Run** 的 REST 截图接口（`POST /client/v4/accounts/<acct>/browser-run/screenshot`）直接接收一段 HTML 返回图片：

| 项 | 实测值 |
|---|---|
| 端到端耗时 | 1.17 到 1.84 秒 |
| 输出 | 1200×630 WebP，74 KB |
| 中日文 | 无需任何字体配置，直接正确 |
| 套餐额度 | Workers Paid 含 10 小时/月浏览器时间，约 2.4 万次渲染 |

因此**不新建 Worker**：不需要 satori、resvg、5 MB 字体子集，也不占主 Worker 包体积（只是一次 HTTPS 子请求）。原计划的 `og.seichigo.com` 取消。

凭证已就绪：作用域仅 Browser Run Write 的 API Token 存为 Worker 密钥 `BROWSER_RUN_TOKEN`，账号 id 存为 `CF_ACCOUNT_ID`（均已 `wrangler secret put`）。

## 目标

卡片只有一份实现，用 HTML 和 CSS 写，服务端渲染并缓存；任何人分享出去的链接都有卡片预览；面板预览改用同一张图，第二次打开同一点位近乎瞬时。

## 非目标

- 不新建 Worker、不引入 satori/resvg/字体子集。
- 不改短链的建链、限流、跳转与 utm 规则。
- 不改点位上下文接口（`/api/share/point-context`）的行为。

## 一、卡片 HTML 生成器（唯一渲染源）

新建 `lib/share/cardHtml.ts`：纯函数

```ts
export type CardHtmlInput = {
  layout: ShareCardLayout            // portrait | landscape
  locale: SupportedLocale
  displayName: string
  animeTitle: string
  episode: string | null
  scene: string | null               // 已格式化的 mm:ss
  address: string | null
  note: string | null
  geo: [number, number] | null
  inJapan: boolean
  animeImageDataUri: string | null    // data:image/...;base64,...
  photoDataUri: string | null         // 有值时用左右（横版）/上下（竖版）对比布局
  qrTargetUrl: string
  text: { qrTitle: string; qrSub: string; tagline: string }
}
export function buildCardHtml(input: CardHtmlInput): string
```

- 输出完整 HTML 文档，`body` 固定为该版式尺寸（`SHARE_CARD_SIZES`），`margin:0`，`overflow:hidden`。
- 版面照搬当前定稿（导航胶囊版），用 flex 与 `-webkit-line-clamp` 让浏览器做断行与省略，**不再手算几何**：点位名 1 行（竖版 2 行）省略、说明 2 行省略、地址 1 行省略。
- 日本轮廓：从 `lib/share/data/japan-outline.json` 生成 SVG `path`（等距圆柱 + `cos(平均纬度)` 修正，复用现有投影算法搬到服务端纯函数 `lib/share/japanPath.ts`），`inJapan` 为 false 时不渲染。
- 二维码：服务端生成 SVG（`qrcode` 依赖已在，`toString(text, { type: 'svg', margin: 0 })`），内联进 HTML。
- 图片一律内联 base64，渲染时不发外部请求，保证截图确定性。
- 字体栈 `"Noto Sans CJK SC","Noto Sans CJK JP",system-ui,sans-serif`（Browser Run 环境自带）。

## 二、二维码目标改为稳定 URL

现在二维码编码短链，导致每产生一个新短码就是一次缓存未命中。改为编码稳定的点位深链：

```
https://seichigo.com/{locale前缀}/map?b=<bangumiId>&p=<pointId>&utm_source=share&utm_medium=image&utm_campaign=point_card
```

短链 `/s/<code>` 的角色不变：仍是文案里那条、仍是各平台展开预览的那条，只是它的 `og:image` 改指向卡片接口。渠道归因不受影响（扫码本来就固定记 `image`）。

于是卡片只是 `(pointId, locale, layout, photo?)` 的函数，可长期缓存。

## 三、渲染接口

`GET /api/share/card/[pointId]?locale=zh|en|ja&layout=portrait|landscape&photo=<key>`

1. `pointId` 沿用现有字符集校验；`locale`/`layout` 非法值回落 `zh`/`landscape`；`photo` 只接受 `checkin/<userId>/<pointId>.jpg` 形状的 key，且必须存在于 `ASSET_STORE`。
2. R2 缓存键：`og-cards/<pointId>__<locale>__<layout>.webp`；带实拍时为 `og-cards/<pointId>__<locale>__<layout>__<photoKey 的 sha256 前 12 位>.webp`。
3. 命中 → 直接返回，`Cache-Control: public, max-age=31536000, immutable`。
4. 未命中：
   - 取点位上下文（复用 `lib/share/handlers/pointContext.ts` 的内部函数，不走 HTTP）
   - 取动画截图：从 R2 镜像公共域读取字节转 base64；失败则 `animeImageDataUri` 为 null（卡片用粉色渐变兜底）
   - 有 `photo` 时从 `ASSET_STORE` 读取并 base64
   - `buildCardHtml` → POST Browser Run `screenshot`，`{ html, screenshotOptions: { type: 'webp', quality: 85 }, viewport: { width, height } }`，超时 20 秒
   - 存入 R2，返回
5. 失败兜底：Browser Run 报错或超时 → 302 到该点位的动画截图 R2 公共域 URL；都没有 → 302 到 `/opengraph-image`。失败不写缓存，`Cache-Control: public, max-age=60`。
6. 限流：匿名按 `cf-connecting-ip` 日 300 次（沿用 point-context 的计数方式）；缓存命中不计入。
7. 全局日预算：当日 Browser Run 渲染次数超过 `DAILY_RENDER_BUDGET = 3000` 时不再渲染，直接走第 5 条兜底。计数落 R2 一个日计数对象或复用现有按日计数模式，实施时择一并写明。

## 四、预热

`POST /api/share/links` 建链成功后，用 `ctx.waitUntil`（必须以 ctx 为 this 调用，见 `lib/asset/handlers.ts:114-121` 的事故注释）触发一次该点位当前语言两种版式的渲染，忽略结果。用户看到面板时通常已命中缓存。

## 五、短链页

`app/s/[code]/page.tsx` 的 `openGraph.images` / `twitter.images`：
- 该链接有 `imageKey`（登录用户上传过带实拍的卡）→ 维持现状，指向 `/api/share/img/<code>`
- 否则 → 指向 `${origin}/api/share/card/<pointId>?locale=<locale>&layout=landscape`

匿名分享从此有完整卡片预览，且不需要任何用户上传。

## 六、面板改造

- 删除 `components/share/PointShareCard.tsx`、`pointShareCardDraw.ts`、`japanLocator.ts` 及其测试；卡片不再在浏览器里绘制。
- 预览：`<img src="/api/share/card/...">`，加载中显示骨架。
- 「保存图片」「复制图片」「系统分享」：`fetch` 该 URL 得到 blob 再走现有 `shareClient` 的下载、剪贴板、`navigator.share` 逻辑。
- 版式切换：换 `layout` 查询参数，重新取图。
- **「添加实拍」改为登录可用**：未登录时该按钮显示为需登录（点击引导登录），文案 `share.addPhotoLoginRequired`（三语新增）。登录用户选图后：先 `POST /api/share/links/[code]/upload` 只传 `photo` 字段（现有端点，`card` 字段改为可选），拿到 photo key，再用带 `photo` 参数的卡片 URL 刷新预览。
- `uploadShareAssets` 的 `card` 字段不再由前端生成；上传端点保留 `card` 可选以兼容，但前端不再传。

## 七、清理

- 现有 `/api/share/links/[code]/upload` 的卡片校验（1080×1440 / 1200×630 尺寸、1.5 MB）在 `card` 缺省时跳过；`photo` 校验不变。
- `ShareLink.imageKey` 仍用于「带实拍的卡」这一路，语义不变。
- `qrcode` 依赖从客户端用法转为服务端用法，前端不再引入。

## 八、验收

- 单测：`buildCardHtml` 在有无地址/说明/坐标/实拍、三语、两版式下的输出包含预期片段且不含未替换占位符；`japanPath` 投影四角与东京落点；卡片接口的缓存命中、未命中、Browser Run 失败兜底、限流、预算耗尽；短链页 OG 在有无 `imageKey` 两种情况下的 URL。
- 集成：本地起服务，`curl` 卡片接口两次，第二次应显著更快且字节一致。
- 浏览器冒烟：打开点位 → 分享 → 预览为服务端图 → 切版式 → 保存图片得到对应尺寸 WebP；未登录时「添加实拍」为需登录态。
- 上线后：贴一条匿名短链到 X Card Validator，确认预览是卡片。

## 九、执行约定

- Track A（后端）：`lib/share/cardHtml.ts`、`lib/share/japanPath.ts`、`lib/share/browserRun.ts`、`app/api/share/card/[pointId]/route.ts` 与其 handler、`app/s/[code]/page.tsx` 的 OG 改动、`/api/share/links` 预热、upload 端点 `card` 可选。
- Track B（前端）：`components/share/PointSharePanel.tsx` 改造、删除三个画布文件与测试、`shareClient.ts` 取图逻辑、i18n 新增。
- 两条 Track 文件不相交；Track B 依赖 Track A 先落地卡片接口的 URL 形状（写进 `lib/share/types.ts` 的 `buildCardImagePath(pointId, locale, layout, photoKey?)`，A 先建，B 只 import）。
