# Track A 评审修复简报

对象：分支 `feat/og-server-render` 的 `1a05b1a..HEAD`。每条一个 commit（低危合并一个），先测试后实现。commit message 末尾带：
```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```
约束不变：只动 Track A 文件（`lib/share/**`、`app/api/share/**`、`app/s/**`、`tests/share/**`、`tests/seo/**`）；不碰 `components/**`、`features/**`、`lib/i18n/locales`、`tests/components`、`tests/i18n`；不 push、不 build、不部署。

## F1（阻断）三道闸门收进 `renderAndStoreCard`，请求与预热共用一条路
现状：`lib/share/api.ts:44` 的 `prewarmCard` 直接调 `renderAndStoreCard`，而缓存检查、预算读、预算写全在 `lib/share/handlers/card.ts` 的 HTTP 路径上。后果：预热不计数、预算耗尽后照跑、同一点位被不同用户分享就重复渲染。登录用户建链无配额（`links.ts:68` 的 100/日只限匿名），遍历 5 万点位可产生 10 万次渲染，月额度约 2.4 万次。
改：把「查缓存 → 读预算 → 渲染 → 写预算 → 存 R2」全部放进 `renderAndStoreCard`，返回判别式而非裸 null，例如
```ts
type RenderOutcome =
  | { status: 'rendered'; bytes: Uint8Array<ArrayBuffer>; contentType: string }
  | { status: 'cached'; bytes: Uint8Array<ArrayBuffer>; contentType: string }
  | { status: 'budget_exhausted' }
  | { status: 'failed' }
```
handler 按 outcome 决定响应；删掉 handler 里重复的预算读写。预热调用同一函数，命中缓存或预算耗尽时直接返回不渲染。
测试：预热在缓存已存在时不调 `renderCard`；预热计入预算；预算耗尽时预热不渲染。

## F2（高）渲染失败也要计预算
Browser Run 失败与超时同样消耗浏览器时长，现在 `bumpRenderBudget` 在 `if (!bytes) return` 之后，上游持续报错时预算永不增长、每次未命中都真等 20 秒。
改：`renderCard` 调用之后无条件 `bumpRenderBudget`（成败都扣）。测试：渲染失败时预算仍加一。

## F3（高）渲染路径包 try/catch，OG 路径永不返 500
`loadPointContext` 的 Prisma 报错、`buildQrSvg` 的 throw、base64 的 OOM 都会抛穿到 `route.ts` 变成 500 JSON，各平台会把「无预览」缓存下来。
改：handler 里 `try { outcome = await renderAndStoreCard(...) } catch (e) { console.error('[share.card.render_threw]', {pointId, error: e}); outcome = { status: 'failed' } }`；`lib/share/qrSvg.ts` 的 `buildQrSvg` 自身 `try/catch` 返回 `''`（二维码没了卡片还在）。测试各一条。

## F4（高）兜底改同源代理，不要跨域 302
现在失败时 302 到 `img.seichigo.com`（跨域，桶无 CORS 头），前端 `fetch` 会直接抛错；且 `resolveMirrorPublicUrl` 只拼字符串，对象不存在时也返回 URL，可能 302 到 404。
改：兜底改为**同源代理**——服务端 `fetch` 该镜像 URL，2xx 时把字节转发（保留其 `content-type`，`Cache-Control: public, max-age=60`）；非 2xx 或抓取失败则读 R2 的静态兜底图 `og-cards/_fallback-<layout>.webp` 并返回；再没有才 302 到 `/opengraph-image`。静态兜底图由站长侧预先上传，代码只管读，读不到就走最后一级。
测试：镜像 2xx 时返回字节且同源；镜像 404 时用静态兜底；两者都无时 302。

## F5（中）data URI 的 contentType 校验并转义
`cardHtml.ts:275` 的 `src="${uri}"` 未转义，`uri` 里的 contentType 来自上游响应头与 R2 元数据，含 `"` 即可逃出属性。
改：`toDataUri` 用 `/^image\/[a-z0-9.+-]{1,32}$/` 白名单校验，不匹配回落 `image/jpeg`；`cardHtml.ts` 的 `src` 也过 `escapeHtml`。测试含引号的 contentType 不产生属性逃逸。

## F6（中）实拍 key 必须绑定本次请求的 pointId
`isCheckinPhotoKey` 只校验形状，可用 `?photo=checkin/<别人>/<别的点位>.jpg` 把别人的实拍合成到任意点位并长期缓存。
改：签名加 `pointId`，要求 `key.endsWith('/' + pointId + '.jpg')`。测试跨点位 key 被拒。

## F7（中）实拍字节按大小上限读取
`readAllBytes(photoObject.body)` 无上限，5MB 实拍 base64 后约 6.7MB 进请求体。
改：用 `photoObject.size <= MAX_INLINE_IMAGE_BYTES` 先判再读（`ShareObject` 已带 `size`）。测试超限时不内联。

## F8（中）冷路径总 deadline
最坏路径为 DB + MapTiler（无上限）+ 抓图 6 秒 + Browser Run 20 秒，`og:image` 端点可跑到 30 秒外，社媒爬虫会超时放弃。
改：整条冷路径包一个 8 秒 deadline（`Promise.race` + `AbortSignal.timeout`），超时直接走兜底，预热仍可慢慢补缓存（预热路径不设此 deadline）。测试超时走兜底。

## F9（中）限流拒绝分支补真实测试
`tests/share/card.test.ts:316` 名为「→ 429」但 500 次全部命中缓存、全部断言 200，`checkCardRate` 返回 false 的分支零覆盖。
改：现有用例改名为「缓存命中不计入限流」，另加一条真正打满未命中触发 429 的用例。

## F10（中）实拍对象只读一次
handler 先 `store.get` 探存在丢掉流，`renderAndStoreCard` 再 `get` 一次。
改：`ShareStore` 加 `head(key): Promise<{ size: number; contentType: string } | null>`（R2Bucket 原生有 `head`），存在性探测走 `head`；内存实现同步补上。

## 低危（一个 commit）
- `cardHtml.ts` 的 `.row.name`、`.clamp1`、`.clamp2` 各加 `max-height` 保险，防 line-clamp 失效时顶出画布被静默裁掉。
- 页脚的 `⛩` 换成与地址图钉同风格的内联 SVG 鸟居，与本文件「不用 emoji」的注释一致。
- `formatSceneTime` 只在 `cardHtml.ts` 里做一次，`card.ts:143` 传原始值；两处矛盾的注释统一。
- 删除 `visualSection` 里没用上的 `metrics` 参数与 `void metrics`。
- `cardBudget.ts:42` 的「跨日自然过期，不需要清理」注释改为事实（R2 无 TTL，靠桶 lifecycle 或不清理，一年 365 个小对象可忽略）。
- `decodeURIComponent(pointId)` 包 try/catch，畸形序列回 400 而非 500。
- `readAllBytes` / `readAllText` 合并到 `lib/share/store.ts` 一处。
- 删 `tests/seo/share-link-metadata.test.ts` 里不再参与断言的 `resolveMirrorPublicUrlMock`。
- `lib/share/ipHash.ts:22` 的注释改为描述两种调用约定（links 拒绝、pointContext 与 card 跳过）。

## 完成标准
`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿。汇报每条 commit sha 与测试关键行。
