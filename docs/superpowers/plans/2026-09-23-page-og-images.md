# 页面 OG 图修复：SVG 降级版 → Browser Run 渲染的 JPEG（参照点位分享卡片）

工作目录：`/Users/mac/Desktop/seichigo-wt-page-og`（分支 `fix/page-og-images`）。**不要 git commit，不要 push，不要部署。**

## 现状与问题（生产实测 2026-09-23）

| 页面 | og:image | 结果 |
|---|---|---|
| `/`、`/en`、`/ja` | `/opengraph-image`（`app/opengraph-image.tsx`） | 200，但 `image/svg+xml` |
| `/posts/<slug>` | Next 文件约定 `opengraph-image-<hash>` | 200，SVG，标题用的是 **slug** 而非文章标题，文案写着「文章分享卡片（临时降级版）」 |
| `/en/posts/<slug>`、`/ja/posts/<slug>` | 手写 `/posts/<slug>/opengraph-image`、`/twitter-image` | **404**（文件约定的真实地址带 hash 后缀） |
| `/anime/<id>` | 文件约定 | 200，SVG，标题用 id |
| `/en/anime/<id>`、`/ja/anime/<id>` | 手写 `${path}/opengraph-image` | **404** |
| `/city/<id>` | 文件约定 | 200，SVG |

Facebook / X / LINE / Discord / Telegram 基本不支持 SVG 格式的 og:image，所以目前全站分享都没有预览图。

## 参照：点位分享卡片的现成做法（必须复用，不要另起炉灶）

- `lib/share/browserRun.ts`：`readBrowserRunConfig()` + `renderHtmlToJpeg({ html, width, height, config })`，走 Cloudflare Browser Run REST 截图接口，输出 JPEG；它自带中日文字体，**不要引入 satori / @vercel/og / resvg / 字体文件**。
- `lib/share/handlers/card.ts`：`renderAndStoreCard` 的三道闸门（R2 缓存命中 → 限流 → 日预算）、`withRenderDeadline`（8 秒冷路径软 deadline，落败的渲染在后台继续写缓存）、`toDataUri`（图片抓下来内联成 data URI 再交给截图接口）、同源兜底链（**不要跨域 302**）、`IMMUTABLE` / `FALLBACK_CACHE` 响应头。
- `lib/share/cardApi.ts`：deps 懒加载 + `fetchImage`（6 秒超时，3MB 上限）+ `resolveMirrorPublicUrl`（anitabi 图走 R2 镜像）。
- `lib/share/store.ts`：`getShareStore()`（R2 `ASSET_STORE`）、`readAllBytes`。
- `lib/share/cardBudget.ts`：日预算计数。
- `app/api/share/card/[...segments]/route.ts`：以 `.jpg` 结尾的路径式地址，方便按扩展名识别图片的抓取器。
- 测试范式：`tests/share/card.test.ts`、`tests/share/cardHtml.test.ts`（deps 注入 + 内存 store）。

## 要做的

### 1. 通用页面卡片渲染：`lib/og/**`
- `lib/og/pageCardHtml.ts`：`buildPageCardHtml(input)` 输出一段 1200×630 的完整 HTML。版式：
  - 左侧约 520px 宽放主视觉（封面图 data URI，`object-fit: cover`）；没有封面时换成品牌渐变块（粉色系 `#fff1f2 → #fce7f3`，中间放大号「SeichiGo」字标）。
  - 右侧：顶部小字品牌「SeichiGo」（`#db2777`）+ kind 标签（文章 / 作品 / 城市，三语）；主标题（粗体，约 52px，`-webkit-line-clamp: 3`）；副标题（作品名 · 城市，或作品简介，`#4b5563`，2 行截断）；底部 `seichigo.com` + 一句三语 tagline。
  - 全部文字必须 HTML 转义（照 `lib/share/cardHtml.ts` 的做法）。
  - 字体用 `system-ui, "Noto Sans CJK SC", "Noto Sans CJK JP", sans-serif`，日文 locale 在 `<html lang>` 上设 `ja`，中文设 `zh-CN`，这样 CJK 字形才对。
  - 三语文案走现有 i18n（`lib/i18n` 的 `t()`），新增 key 放在 `og.*` 命名空间下，zh/en/ja 三份都要补。
- `lib/og/handlers/pageCard.ts`：`createGetPageCardHandler(deps)`，结构照搬 `handlers/card.ts`：
  - 路径：`/api/og/<kind>/<id>/<locale>.jpg`，`kind ∈ post | anime | city | site`，`locale ∈ zh | en | ja`，严格校验，不合法回 400；id 按 `decodeURIComponent` 解码后校验（id 字符集与现有 slug/animeId/cityId 一致；拒绝 `..` 和 `/`）。
  - `site` 只接受 id=`home`。
  - 内容查找（deps 注入，便于测试）：post 用 `lib/posts/getPublicPostBySlug.ts` 的现有函数取**对应语言**的标题、作品名、城市、`cover`（mdx frontmatter 或 DB article）；anime 与 city 用它们页面 `generateMetadata` 里现在取标题/封面的同一套函数。找不到返回 `not_found`，此时走兜底，不渲染。
  - 缓存键：`og-pages/<kind>/<id>__<locale>__<ver>.jpg`，`ver` = sha256(`TEMPLATE_VERSION|title|subtitle|coverUrl`) 前 12 位。标题或封面一改，自动换新图。`TEMPLATE_VERSION` 是一个常量，改版式时手动 +1。
  - 闸门：缓存命中直接回，不计预算；未命中先查日预算（复用 `cardBudget.ts`，但用**独立的计数 key 前缀** `og-pages/_budget/`，上限常量 `PAGE_CARD_DAILY_BUDGET = 1500`），再按 IP 做匿名限流（每 IP 每分钟最多 10 次未命中渲染，复用 `checkCardRate` 的思路）。爬虫天然是匿名的，限流只防刷，不要挡正常抓取。
  - 封面：DB/MDX 的 `cover` 可能是站内相对路径、R2 公共域或 anitabi 地址，统一转成绝对 URL；anitabi 地址走 `resolveMirrorPublicUrl`，再用 `fetchImage` 抓成 data URI 内联。
  - 冷路径 8 秒软 deadline（直接复用或抽出 `withRenderDeadline`）。
  - 兜底链全部同源：① 直接转发封面图字节（`FALLBACK_CACHE`）→ ② R2 静态图 `og-pages/_fallback.jpg` → ③ 仓库内静态文件 `public/og/default.jpg`（由第 4 步生成）。**不要 302 到 SVG。**
  - 成功响应：`content-type: image/jpeg`，`cache-control: public, max-age=31536000, immutable`（URL 里没有 ver，所以**这里改用** `public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800`，因为内容变化时同一 URL 要能刷新）。
- `lib/og/pageCardApi.ts`：deps 懒加载，照 `lib/share/cardApi.ts`。
- `app/api/og/[...segments]/route.ts`：`runtime = 'nodejs'`，`dynamic = 'force-dynamic'`，try/catch 返回 500 JSON，照 share card 路由。

### 2. 页面元数据改指向新地址
- 新增 `lib/og/pageCardUrl.ts`：`pageCardImage(kind, id, locale, alt)`，返回 `{ url: '<origin>/api/og/<kind>/<encodeURIComponent(id)>/<locale>.jpg', width: 1200, height: 630, alt, type: 'image/jpeg' }`，origin 用 `lib/seo/site` 的 `getSiteOrigin()`。
- 在以下页面的 `generateMetadata` / `metadata` 里，`openGraph.images` 和 `twitter.images` 都改成 `[pageCardImage(...)]`，locale 与页面语言一致，并确保 `twitter.card = 'summary_large_image'`：
  - 文章：`app/(site)/posts/[slug]/page.tsx`、`app/en/posts/[slug]/page.tsx`、`app/ja/posts/[slug]/page.tsx`（kind=post，id=frontmatter.slug）
  - 作品：`app/(site)/anime/[id]/page.tsx`、`app/en/anime/[id]/page.tsx`、`app/ja/anime/[id]/page.tsx`
  - 城市：`app/(site)/city/[id]/page.tsx`、`app/en/city/[id]/page.tsx`、`app/ja/city/[id]/page.tsx`
  - 首页与根布局：`app/layout.tsx`、`app/(site)/page.tsx`、`app/en/page.tsx`、`app/ja/page.tsx`（kind=site，id=home）
  - 其余在 `openGraph` 里显式写了 `/opengraph-image` 的页面（grep `opengraph-image`、`twitter-image` 全仓库），一律改为 `pageCardImage('site','home',locale)`。
  - **不要动** `app/(site)/map/page.tsx`、`app/en/map/page.tsx`、`app/ja/map/page.tsx` 和 `app/s/[code]/page.tsx` 里已经指向 R2 截图或 `/api/share/card` 的 OG 设置（grep 一下，如果它们只是回落到 `/opengraph-image`，那一处才换）。
- 删除 SVG 文件约定：`app/opengraph-image.tsx`、`app/twitter-image.tsx`、`app/(site)/posts/[slug]/opengraph-image.tsx`、`app/(site)/posts/[slug]/twitter-image.tsx`、`app/(site)/anime/[id]/opengraph-image.tsx`、`app/(site)/city/[id]/opengraph-image.tsx`。
- 兼容：**保留** `/opengraph-image` 这个路径（外部平台缓存过它，`lib/share/handlers/card.ts` 最后一级兜底也在 302 到它）。新建 `app/opengraph-image/route.ts`，直接返回 `public/og/default.jpg` 的字节（`image/jpeg`，缓存 1 天）。同时把 `lib/share/handlers/card.ts` 的 `redirect(\`${deps.origin}/opengraph-image\`)` 保持不变即可（它会拿到 JPEG）。删除文件约定后，注意不要和新 route 冲突（Next 的 `opengraph-image.tsx` 文件约定与 `opengraph-image/route.ts` 不能共存，前者已删除）。

### 3. 测试（vitest，放 `tests/og/`）
- `pageCardHtml.test.ts`：标题转义、无封面时渲染品牌块、三语 kind 标签与 tagline、`lang` 属性。
- `pageCard.test.ts`（deps 注入 + 内存 store，照 `tests/share/card.test.ts`）：路径校验 400 的几种情况；缓存命中不调用渲染、不计预算；未命中渲染并写入正确 key；标题变化导致 ver 变化；预算耗尽走兜底；渲染返回 null 走封面兜底；无封面走 R2 `_fallback` 再到静态文件；deadline 触发走兜底。
- 至少一个元数据断言：en、ja 文章页的 `generateMetadata` 输出的 `openGraph.images[0].url` 以 `/api/og/post/` 开头、以 `/en.jpg` 或 `/ja.jpg` 结尾。

### 4. 静态兜底图 `public/og/default.jpg`
写一个一次性脚本 `scripts/og/render-default.mjs`：用 `buildPageCardHtml` 的 site/home/zh 版式（没有封面，品牌渐变块）生成 HTML，调 Browser Run 截图，存成 `public/og/default.jpg`。Browser Run 的密钥需要 `BROWSER_RUN_TOKEN` 与 `CF_ACCOUNT_ID`，**本地 `.env.local` 里没有**。如果环境变量缺失，脚本打印明确提示后退出 1；**不要**自己去找或伪造密钥。这种情况下生成一张 1200×630 的占位 JPEG 也不行，直接在汇报里说明「default.jpg 待生成」，由我来跑脚本。

## 约束
- 不 commit、不 push、不 deploy、不跑 `npm run cf:deploy` / `cf:upload`。
- 不改 `lib/share/**` 的行为（可以把 `withRenderDeadline`、`toDataUri`、`bytesToBase64` 抽到 `lib/og/` 或共享 util 再让 share 引用，但 share 的现有测试必须全部通过且不许改断言）。
- 不引入新依赖。
- `scripts/check-line-budget.mjs` 有单文件行数预算（`npm test` 会先跑），新文件保持精简；如超预算就拆文件，不要改 allowlist。
- 代码注释风格与 `lib/share/**` 一致（中文、解释「为什么」）。

## 完成标准
在工作目录里依次通过：
1. `npm test`
2. `npm run typecheck`
3. `npm run cf:build`（`.env`、`.env.local` 已复制进来）

然后简短中文汇报：改动文件清单、测试结果、default.jpg 是否已生成、有没有没做完或拿不准的地方。

## 5. 补充（覆盖第 4 步和兜底链③）：`default.jpg` 上线后才生成
用户决定：兜底图不在本地生成，等上线后由我调生产接口 `/api/og/site/home/zh.jpg` 渲染出来，再上传到 R2 `og-pages/_fallback.jpg`。所以**部署时仓库里不会有 `public/og/default.jpg`**，代码不能依赖它存在。
- 不要写 `scripts/og/render-default.mjs`，也不要在 `public/og/` 下放任何文件。
- 兜底链改为：① 转发封面图字节 → ② R2 `og-pages/_fallback.jpg` → ③ 走 kind=site、id=home、同一 locale 的缓存或渲染（缓存命中直接回；未命中且预算允许就渲染一次）→ ④ 以上都失败时返回 `503`，带 `cache-control: no-store`。**不要返回 SVG，也不要 302。**
- `app/opengraph-image/route.ts` 同样处理：先读 R2 `og-pages/_fallback.jpg`，没有就走 site/home/zh 的缓存或渲染，再失败就 503 no-store。
- 测试相应调整：删除「静态文件兜底」的用例，改为覆盖 ③ 和 ④。

## 6. 评审修复（独立 code review 结果，全部要改；行号指当前 lib/og/handlers/pageCard.ts）
1. **[高] 兜底用 site 卡片时缓存头错误**（`r2ThenSiteCardResponse`，约 332 行）：只有请求本身就是 `site/home/<locale>`（以及 `/opengraph-image`）时才用 `PAGE_CARD_CACHE_CONTROL`；替其他 kind/id 顶上的 site 卡片、R2 `_fallback.jpg`、封面转发，一律用 `FALLBACK_CACHE`（`public, max-age=60`）。给 ①②③ 都加 cache-control 断言。
2. **[高] 封面抓失败时无封面卡被永久缓存**（约 173–233 行）：`coverUrl` 非空但 `fetchImage` 返回 null 时，先用原始绝对 URL 再抓一次（镜像 URL 可能尚未存在）；仍失败就返回 `failed`，**不写 R2**，由兜底链接手。补单测。
3. **[中] 总耗时没有上限**：从请求开始只记一个时间戳，整条链路（主渲染 + 兜底）总预算 9 秒。主渲染已经超时或失败时，③ 只允许读缓存，不再发起第二次渲染。请求本身是 site/home 时，失败后不要再渲染一次 site/home。后台继续写缓存的渲染要用 `getCloudflareContext().ctx.waitUntil(promise)` 登记（参照仓库里现有的 waitUntil 用法，grep `waitUntil`），拿不到 ctx 时（本地、测试）就忽略。
4. **[中] 限流返回 429**：`rate_limited` 时改走 `fallbackResponse`，此时 ③ 只读缓存、不渲染（否则等于绕过限流）。
5. **[中] 封面是站内 `/assets/<id>` 时，Worker 自己请求自己的域名**：这类封面不要走 HTTP 拉取，直接从资产存储读字节。找现有 `/assets/[id]` 路由怎么读的（grep `app/assets` 或 `lib/asset`，资产已迁 R2），复用同一个读取函数，并通过 deps 注入以便测试。只有外部 URL 才走 `fetchImage`。
6. **[中] 作品封面只有 160px 高**（`pageCardApi.ts:27`，`resolveMirrorPublicUrl(..., { kind: 'cover' })` 会改写成 `plan=h160`）：页面卡片要用原图或更大的规格，看 `lib/anitabi/imageProxy.ts` 有没有大尺寸选项；没有就直接用原始 anitabi URL。
7. **[低] 封面转发不校验类型**：① 只转发 `image/(jpeg|png|webp|gif)`，其他类型（包括 svg、html）跳到 ②。
8. **[低] R2 读流异常会抛成 500**（约 304 行，`readAllBytes(fallback.body)`）：用 try/catch 包起来，出错就继续走 ③。
9. **[低] 地图页兜底**：`lib/anitabi/share.ts:106` 的 `${origin}/opengraph-image` 改为 `pageCardImage('site','home',locale).url`，locale 用该函数已有的 locale 参数；如果那里没有 locale 就保持不动，在汇报里说明。
10. **[低]** 把 `og.kind*`、`og.tagline` 的实际文案也放进 `ver` 的哈希原料。

完成标准不变：`npm test`、`npm run typecheck`、`npm run cf:build` 全过；不 commit。

## 7. 第二轮评审修复（行号指当前 lib/og/handlers/pageCard.ts）
1. **[高] 封面永久失效就永远出不了卡**（约 277–278 行，`lib/og/siteAsset.ts:23`）：区分临时失败和永久失败。
   - 临时失败（超时、5xx、网络异常）：保持现在的做法，返回 `failed`，不写 R2。
   - 永久失败（404、资产 id 不存在、超过内联上限、类型不支持）：照常渲染无封面卡，缓存时 `ver` 用无封面状态（`coverUrl=''`）计算，封面修好后 ver 变化自动换新。
   - fetchImage / readSiteAsset 的返回要能区分这两种情况，比如 `{ status: 'ok' | 'missing' | 'transient' }`，改动要照顾到现有调用方。
   - `/assets` 封面**先看 byteLength 再读字节**；优先读缩放后的变体（仓库里 `/assets?w=` 用的缩放路径或 `store.getVariant`，宽 1200 左右），拿不到变体才读原图，原图超过上限就算永久失败。
2. **[中] 兜底①不受 9 秒总预算约束**（约 468–476 行）：主渲染失败的原因就是封面时跳过①；否则用剩余时间给①做 `Promise.race`，剩余不足 1.5 秒就直接跳过①。
3. **[中] site/home 自身失败时，R2 `_fallback.jpg`（中文）被长缓存到 en/ja 地址**（约 547、594 行）：② 一律用 `FALLBACK_CACHE`；只有 ③ 真正拿到对应 locale 的 site/home 卡片时才用长缓存。`/opengraph-image` 本来就是中文，对它的 ② 可以保留长缓存。
4. **[低]** `siteAsset.ts:20-24` 只接受 `image/(jpeg|png|webp|gif)`，与 `PROXY_SAFE_IMAGE_PATTERN` 一致（heic 等浏览器解不了的格式算永久失败，按第 1 条处理）。
5. **[低]** `waitUntil` 在请求开始时就读取一次 `getCfBindings()?.ctx` 并绑定好，不要在 `setTimeout` 回调里现取。
6. **[低]** 约 587–591 行主路径上 `allowFallbackRender` 分支实际不会生效：删掉这个死分支，并在代码注释里写清楚「site/home 缓存靠部署后预热」。

每条都补测试（第 1 条至少覆盖：404 永久失败 → 渲染无封面卡并用无封面 ver 缓存；超时临时失败 → failed 不写缓存；超大原图有变体时用变体）。完成标准不变，不 commit。
