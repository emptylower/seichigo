# Track B 评审修复简报

对象：分支 `feat/og-server-render-b` 的 `bbc175c..HEAD`。每条一个 commit（低危合并一个），先测试后实现。commit message 末尾带：
```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```
约束不变：只动 `components/share/**`、`lib/i18n/locales/*.json`、`tests/components/**`、`tests/i18n/**`；`lib/share/**` 只 import；不 push、不 build、不部署；line-budget 必须 OK。

## H1（高）实拍只允许 JPEG 上传，其余一律先转码
`PointSharePanel.tsx:61` 的 `NATIVE_PHOTO_TYPES` 含 png/webp 并直接放行，但上传端点 `lib/share/handlers/upload.ts:94` 只收 JPEG，PNG/WebP 必然 400。
改：常量改名 `UPLOADABLE_PHOTO_TYPES = new Set(['image/jpeg'])`，注释写明「上传端点只收 JPEG」；非 JPEG 一律走 `transcodeToJpeg`；把 `SHARE_PHOTO_MAX_BYTES` 判定挪到转码之后（转码通常更小，先判会误杀）。
测试：PNG 与 WebP 都走转码后上传；转码后仍超 5MB 才提示过大。

## H2（高）预览改用 `<img>`，blob 只在动作时取
后端的降级是 302 到 `img.seichigo.com`（跨域，无 CORS 头），`fetch` 会直接抛错，用户看到「生成失败」而不是兜底图。后端这次会把兜底改成同源代理，但前端也要不依赖 fetch 才能显示预览。
改：
- 预览用 `<img src={cardUrl}>`，`onLoad` / `onError` 驱动状态，不再为了预览去 fetch。
- `cardBlob` 改为**惰性**：只有用户点「保存图片」「复制图片」「系统分享」时才 `fetchCardBlob(cardUrl)`，失败时只对该动作提示，不影响其它入口。
- `ready` 判定改为 `Boolean(shareUrl && imgLoaded)`，不再依赖 `cardBlob`。
- `shareClient.ts:60` 那句「fetch 自动跟随 302 仍拿得到图」的注释删掉或改成事实；对应那条测试改成真实构造重定向（`Response.redirect` 到跨域且无 ACAO 时断言返回 null），不要留反向断言。
测试：预览图加载失败时显示失败态与重试；`fetchCardBlob` 只在动作时被调用一次。

## H3（高）取图失败时不要一直显示骨架
`PointSharePanel.tsx:547` 的骨架判据 `!cardBlob` 改为「失败态时不渲染骨架，直接渲染禁用态的目的地网格」，让「更多 → 复制文案」这条还能用的路可见。骨架只在真正加载中出现。
测试：失败态下目的地按钮存在且为禁用态，骨架不存在。

## H4（高）捞回被删的行为测试
从 `git show bbc175c:tests/components/pointSharePanel.test.tsx` 取回下列用例，把 `PointShareCard` 桩换成对 `fetchCardBlob` / `<img>` 的桩，其余断言尽量原样：
桌面 X 的「先同步开窗 → await 剪贴板 → 设 location」顺序（用 `invocationCallOrder`）；X 剪贴板失败改下载、窗口被拦截改复制文案、两者都失败才提示失败；小红书/微信下载+复制+提示与文案复制失败只提示已保存；Reddit/LINE 的 href 渠道参数与编码、`share.redditTitle` 三语模板；`shareUrl` 为空时两者无 href 且 `aria-disabled`；手机路径「分享到…」主按钮与 `c=sys`、系统面板吃不下文件时的提示、五列、「更多」内容；HEIC 转码入槽与转码失败提示；复制图片不可用降级为下载；版式 `aria-pressed`；挂载后读 localStorage 偏好；context 的 displayName 覆盖 props、城市级地址、无地址退回 cityName、换版式不重拉 point-context；建短链失败后重试。
测试文件超过 750 行就按主题拆分成第二个文件。

## M1（中）切版式不要闪旧图
预览与其对应 URL 绑定：`preview = { url, forCardUrl }`，渲染时 `preview?.forCardUrl === cardUrl` 才显示，否则显示骨架；revoke 放进 effect 的 cleanup，不要写在 setState updater 里（同时解决 M4）。

## M2（中）文件名扩展名按内容类型映射
`shareText.ts:70` 的二分改为映射表 `image/webp→webp`、`image/jpeg→jpg`、`image/png→png`、`image/svg+xml→svg`，未知回落 `jpg`；`contentType` 先 `split(';')[0].trim().toLowerCase()`。
测试四种类型各一条。

## M3（中）「移除实拍」文案与行为对齐
上传后照片已落库，前端「移除」只是本次卡片不用它。按钮与提示文案改为「不在卡片中使用」语义，新 key `share.photoUnuse`（三语），并在 shareKeys 测试登记。

## M5（中）上传失败按状态码分流
`uploadSharePhoto` 返回 `{ ok: false, status }` 而非 null；面板按 401 提示重新登录（新 key `share.toastSessionExpired`）、429 提示稍后再试（新 key `share.toastTooManyUploads`）、其余通用失败。三语齐全并登记测试。

## 低危（一个 commit）
- `PointSharePanel.tsx:49` 与 `:60` 的过时注释按实际改（保留三项、不再是「img 能吃的格式」）。
- `shareClient.ts` 里本地的 `SharePhotoUploadResponse` 加一行注释：合流后改用 `lib/share/types.ts` 的 `ShareUploadResponse`。

## 完成标准
`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿；line-budget OK。汇报每条 commit sha 与测试关键行。
