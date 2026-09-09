# 根因修复：短链页的 meta refresh 让爬虫拿不到卡片

## 现象
Telegram、微信展开 `https://seichigo.com/s/<code>` 时没有预览图。

## 根因（已实测确认）
`app/s/[code]/page.tsx` 的页面体里有：
```html
<meta http-equiv="refresh" content="0;url=https://seichigo.com/map?b=...&p=..." />
```
Telegram 等抓取器会跟随 meta refresh 跳到地图页，改用**地图页**的 `og:image`（`https://img.seichigo.com/mirror/...` 的动画截图），完全不读短链页自己的卡片标签。实测：短链页的 og 标签齐全且卡片图返回 200 image/jpeg，但抓取器根本没用它们。

## 改法
`app/s/[code]/page.tsx`：
1. **删除 `<meta http-equiv="refresh">`**。
2. 跳转只保留内联 `<script>` 的 `window.location.replace(...)`（现有实现已有，保持其 `<` 转义）。爬虫不执行 JS，会读到卡片标签；真实用户仍瞬时跳转。
3. 页面体补一个可见的兜底链接，给禁用 JS 的用户：一个指向同一目标的 `<a>`，文案按 locale 三语（zh「正在前往地图，若未自动跳转请点此」/ ja「地図へ移動しています。移動しない場合はこちら」/ en「Opening the map. Tap here if it doesn't redirect.」），在 `lib/share/view.ts` 里按 locale 拼，不新增 i18n key。样式极简内联即可（居中、品牌粉链接色 `#db2777`）。
4. `robots: { index: false, follow: true }` 保持不变。

## 测试（`tests/seo/share-link-metadata.test.ts` 或同目录）
- 渲染后的页面体**不含** `http-equiv="refresh"`。
- 仍含 `window.location.replace(` 且目标 URL 与 `buildShareRedirectTarget` 一致。
- 含一个 `href` 等于同一目标的 `<a>`。
- 三语兜底文案各断言一次。
- 现有 og/twitter 断言全部保持通过。

## 约束
只动 `app/s/**`、`lib/share/view.ts`、`tests/seo/**`、`tests/share/**`。不碰 `components/**`、`features/**`、`lib/i18n/locales`。不 push、不 build、不部署。
每条一个 commit，先测试后实现，message 末尾带：
```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```

## 完成标准
`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿。汇报 commit sha 与测试关键行。
