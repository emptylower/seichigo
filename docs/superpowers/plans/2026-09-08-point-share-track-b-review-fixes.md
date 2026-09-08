# Track B 评审修复简报

代码评审对象：分支 `feat/point-share-card-b` 的 `63034c6..HEAD`。以下每条都要修，按顺序做，每条一个 commit（低危项可以合并成一个 commit），先写测试再改代码。commit message 末尾带：
```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```

约束：只动 Track B 文件（`components/share/**`、`features/map/anitabi/DetailPanel.tsx`、`MapDialogs.tsx`、`AnitabiMapLayout.tsx`、`useAnitabiMapController.ts`、`lib/i18n/locales/*.json`、`tests/components/**`、`tests/i18n/**`、`tests/map/**`）。`lib/share/types.ts` 只 import。不 push、不切分支、不 merge、不部署、不跑 `npm run build`。`useAnitabiMapController.ts` 保持 883 行。新增 i18n key 必须三语齐全并更新 `tests/i18n/shareKeys.test.ts`。

## H1 实拍 objectURL 被提前 revoke
`components/share/PointSharePanel.tsx:84-89` 的 cleanup effect 依赖了 `[previewUrl, photoObjectUrl]`，任一变化都会把另一个还在用的 URL revoke 掉。改成两个 ref 记录当前值，effect 依赖数组为空、只在卸载时 revoke：
```tsx
const previewUrlRef = useRef<string | null>(null)
const photoObjectUrlRef = useRef<string | null>(null)
useEffect(() => { previewUrlRef.current = previewUrl }, [previewUrl])
useEffect(() => { photoObjectUrlRef.current = photoObjectUrl }, [photoObjectUrl])
useEffect(() => () => {
  if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
  if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current)
}, [])
```
`components/share/PointShareCard.tsx`：实拍图加载失败时 variant 退回 `default`，不留空槽。测试：加实拍后切换版式，传给渲染器的 photo URL 未被 revoke（用 jsdom 里 mock 的 `URL.revokeObjectURL` 记录调用）。

## H2 横版 1200×630 文字溢出压页脚
`components/share/pointShareCardDraw.ts` 的 landscape 分支改为：`padding = 40`、`visualHeight = 360`、`qrSize = 110`、`textTop = visualHeight + 24`、`textWidth = canvas.width - padding*2 - qrSize - 32`、`qr = { x: canvas.width - padding - qrSize, y: canvas.height - padding - qrSize, size: qrSize }`、`footerY = canvas.height - padding`。compare 时 main/photo 各占半宽、高 `visualHeight`。
`tests/components/pointShareCardDraw.test.ts` 加排版几何断言：
```ts
it.each(['portrait', 'landscape'] as const)('%s 文字块不越界也不压页脚', (l) => {
  const layout = buildCardLayout(l, 'default')
  const titleSize = l === 'portrait' ? 60 : 40
  const bodySize = l === 'portrait' ? 34 : 24
  const footerSize = l === 'portrait' ? 30 : 22
  const metaBottom = layout.textTop + 2 * (titleSize + 12) + (bodySize + 18) + bodySize
  expect(metaBottom).toBeLessThanOrEqual(layout.footerY - footerSize)
  expect(metaBottom).toBeLessThanOrEqual(layout.canvas.height)
})
```
字号常量如果在 `PointShareCard.tsx` 里，抽到 `pointShareCardDraw.ts` 导出，测试和渲染器共用同一份。

## H3 动画截图改走同源代理候选梯
`components/share/PointShareCard.tsx:96-110` 现在用 `toCanvasSafeImageUrl`，对 anitabi host 会直连 `img-tc.anitabi.cn`，该域不返回 CORS 头，`crossOrigin='anonymous'` 下加载必失败。改为：
```ts
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
const candidates = input.animeImage ? getMapDisplayImageCandidates(input.animeImage, { kind: 'point' }) : []
let animeImg: HTMLImageElement | null = null
for (const candidate of candidates) {
  animeImg = await loadImage(candidate, 'anonymous').catch(() => null)
  if (animeImg) break
}
```
先读 `lib/anitabi/imageProxy.ts` 确认 `getMapDisplayImageCandidates` 的真实签名与返回形状，按实际写。测试：mock 候选列表，第一候选失败时用第二候选。

## H4 建短链失败要有提示和重试
`components/share/PointSharePanel.tsx:69-82`：加 `linkFailed` 与 `retryNonce` state，`createShareLink` 返回 null 时 `setLinkFailed(true)`；预览区 `failed || linkFailed` 时显示 `share.generateFailed` 与一个「重试」按钮（新 key `share.retry`，三语），点击 `setRetryNonce(n => n + 1)`，effect 依赖加 `retryNonce`。测试：mock fetch 返回 429 → 出现重试按钮；点击后重新请求。

## M1 二维码带渠道参数
`PointSharePanel.tsx` 的 `cardInput` 加 `qrUrl: withShareChannel(shareUrl, 'save')`；`PointShareCard.tsx` 二维码用 `input.qrUrl || input.shareUrl`。测试断言二维码输入含 `c=save`。

## M2 meta 行断行
`PointShareCard.tsx:161-164` 的 meta 行经 `wrapLines(measure, meta, layout.textWidth, 1)` 限 1 行。

## M3 未登录不发上传
`PointSharePanel.tsx` 用 `useSession()`（`next-auth/react`，仓库里 `components/layout/HeaderAuthControls.client.tsx:43` 有用法），仅 `status === 'authenticated'` 时调用 `uploadShareAssets`。测试：未登录时 fetch 不应命中 `/upload`。

## M4 实拍客户端守卫
`handlePhotoChange`：`file.size > SHARE_PHOTO_MAX_BYTES`（从 `lib/share/types.ts` import）→ toast `share.toastPhotoTooLarge`（新 key）并清空 input；非 jpeg/png/webp 走 `transcodeToJpeg(file)`（`createImageBitmap` → canvas → `toBlob('image/jpeg', 0.85)`，失败返回 null → toast `share.toastPhotoUnsupported`，新 key）。放在 `components/share/shareClient.ts`。测试：超大文件被拒；unsupported 类型走转码。

## M5 canvas 渲染可取消
`PointShareCard.tsx` 的 `useEffect(() => { let cancelled = false; void render(() => cancelled); return () => { cancelled = true } }, [render])`；`render` 在每个 `await` 后与回调前检查 `isCancelled()`。

## M6 Dialog 补 Title/Description
`features/map/anitabi/MapDialogs.tsx:310-327` 的分享面板 `Dialog.Content` 内加 `<Dialog.Title className="sr-only">{label.share}</Dialog.Title>` 与 `<Dialog.Description className="sr-only">{selectedPoint?.name || ''}</Dialog.Description>`，写法同文件 218 行附近。

## M7 平台链接未就绪时的禁用态
三个 `<a>` 加 `aria-disabled={!shareUrl}` 与 `shareUrl ? '' : 'pointer-events-none opacity-50'`。

## M8 复制图片不可用时降级为下载
`handleCopyImage`：`copyImage` 返回 false 时 `downloadBlob(cardBlob, buildCardFilename(pointName))` 并 toast `share.toastSaved`。

## M9 作品名标签净化
`components/share/shareText.ts` 加 `toHashtag(value)`：去掉空白与 `# / \ . , : ; ! ? ' " ( ) （ ） 【 】 「 」 『 』 ・`；`buildShareCaption` 先替换 `#{anime}` 为 `#${toHashtag(anime)}`，再替换 `{anime}`。测试：`Your Name.` → `#YourName`。

## 低危（一个 commit）
- L1：在「添加实拍」按钮旁渲染 `share.photoHint`。
- L2：`buildCardFilename(name)`：`name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40)`，下载与系统分享都用它。
- L3：toast 的 `setTimeout` handle 存 ref，进函数先 clear，卸载时清。
- L4：动作入口加 `busy` state 防并发，`finally` 复位。
- L5：Reddit 标题走新 key `share.redditTitle`（zh/ja `{point}｜{anime}`，en `{point} - {anime}`）。
- L6：抽屉外层加 `pb-[env(safe-area-inset-bottom)]`，`max-h-[88vh]` 改 `max-h-[88dvh]`。
- L7：版式切换按钮加 `aria-pressed={layout === value}`。
- L8：`pointShareCardDraw.ts` 竖版 compare 上下分栏处加注释说明是有意为之（竖版左右分会把两张图压得太窄）。
- L9：`useState('portrait')` 固定初值，`useEffect` 里再读 localStorage。
- L10：`MapDialogs.tsx` 的 `bangumiId` 改为 `selectedPoint.bangumiId ?? detail?.card.id`。

## 完成标准
- `npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿；`node scripts/check-line-budget.mjs` OK；`wc -l features/map/anitabi/useAnitabiMapController.ts` 为 883。
- 汇报每条的 commit sha 与测试关键行。
