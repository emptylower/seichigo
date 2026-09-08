# 修复：卡片 OG 图在部分平台不显示

## 现象
Telegram 等平台展开短链时不显示卡片。

## 已定位的两个原因（均已实测）
1. **robots.txt 没放行卡片接口**。`app/robots.ts` 只 Allow 了 `/api/share/img/` 与 `/api/share/photo/`，而现在所有人的 OG 图都指向 `/api/share/card/`，它落在 `Disallow: /api/` 之下。遵守 robots 的抓取器（Twitterbot、Telegram 等）会拒绝抓取。
2. **输出是 WebP**。WebP 作为 `og:image` 在 Telegram、WhatsApp、LINE、Facebook 上不可靠，JPEG/PNG 才是安全选择。实测同一张卡：WebP 74 KB，JPEG q82 106 KB、q88 129 KB。

## 要改的

### C1 robots.txt 放行卡片接口
`app/robots.ts` 的 allow 列表加 `/api/share/card/`（保持 `/api/share/img/`、`/api/share/photo/` 与全部 disallow 不变）。
测试：`tests/seo/` 下现有 robots 用例补断言三个前缀都在 allow 里。

### C2 卡片输出改 JPEG
- `lib/share/browserRun.ts`：`screenshotOptions` 改 `{ type: 'jpeg', quality: 82 }`，函数与类型里的 `webp` 字样一并改为 jpeg 语义（如 `renderHtmlToWebp` 更名 `renderHtmlToJpeg`，全量改引用）。
- 返回与存储的 `content-type` 改 `image/jpeg`。
- **缓存键扩展名改 `.jpg`**，否则会把已缓存的 WebP 继续发出去。`og-cards/<pointId>__<locale>__<layout>[__<hash>].jpg`。旧的 `.webp` 对象不用清理，自然失效。
- 静态兜底图：R2 里已有 `og-cards/_fallback-<layout>.webp`，改为读 `og-cards/_fallback-<layout>.jpg`（新文件由站长侧上传，代码只管读；读不到就落最后一级 302）。
- 单测里所有 `image/webp` 断言同步改。

### C3 短链页补 OG 图尺寸与类型
`app/s/[code]/page.tsx` 的 metadata 里，`openGraph.images` 从字符串改为对象数组，带 `url`、`width`、`height`、`type: 'image/jpeg'`、`alt`（用点位名与作品名拼一句，三语）。`twitter.images` 同步。尺寸按 layout 取 `SHARE_CARD_SIZES`。
测试：断言 width/height/type 三项存在且与 layout 匹配。

## 约束
只动 `app/robots.ts`、`lib/share/**`、`app/s/**`、`app/api/share/**`、`tests/share/**`、`tests/seo/**`。不碰 `components/**`、`features/**`、`lib/i18n/locales`（若 alt 文案需要新 key，直接在 `lib/share/view.ts` 里按 locale 拼，不加 i18n key）。不 push、不 build、不部署。

每条一个 commit，先测试后实现，message 末尾带：
```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```

## 完成标准
`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿。汇报每条 commit sha 与测试关键行。
