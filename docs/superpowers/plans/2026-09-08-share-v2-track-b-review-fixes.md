# 分享 v2 Track B 评审修复简报

评审对象：分支 `feat/share-v2-b` 的 `d491f39..HEAD`。每条一个 commit（低危可合并一个），先测试后实现。commit message 末尾带：
```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```
约束同执行简报：只动 Track B 文件；`lib/share/**` 不改；不 push、不部署、不新建 worktree；`node scripts/check-line-budget.mjs` 必须 OK。

## H1（高）卡片必须等 point-context 落定再画
`components/share/PointSharePanel.tsx`：加 `contextSettled` state；`fetchPointContext(...).then(result => { setContext(result); setContextSettled(true) })`（null 也算 settled）；`cardInput` 在 `!shareUrl || !contextSettled` 时为 null；effect 里切换 pointId/locale/retryNonce 时先 `setContextSettled(false)`。测试：context 未返回前不调用渲染器；返回后只渲染一次；上传的 blob 是带地址那一版。

## H2（高）文案编辑器显示原始输入，不显示渠道改写后的值
把生成文案抽成 `generatedCaption`；`editorValue = captionOverride ?? generatedCaption` 用于 textarea 的 `value` 与折叠摘要；`captionFor(channel)` 仍在动作时做 `retargetCaptionChannel`。`handleCopyText` 用 `captionFor('copy')`。测试：用户删掉 `?c=copy` 后 textarea 保持用户输入，不回填。

## M1（中）`openOrNavigate` 兜底不用 `'noopener'` 特性字符串
`shareClient.ts`：兜底改为 `const w = globalThis.open?.(url, '_blank'); if (!w) return false; try { w.opener = null } catch {}; return true`。主路径 `win.location.href = url` 前也 `try { win.opener = null } catch {}`。测试 stub 改为：带 `'noopener'` 时返回 null 的真实语义，确认兜底成功时返回 true。

## M2（中）小红书/微信路径按 `copyText` 结果提示
`handleAppFlow`：`copied ? toastSavedAndCopiedOpenApp : toastSaved`。测试两条。

## M3（中）桌面 X 弹窗被拦截时复制文案并给正确提示
`openOrNavigate` 失败 → `await copyText(captionFor('x'))` → `showToast('share.toastSavedAndCopiedOpenApp', { app: t('share.platformX') })`（`platformX` 若无则新增三语 key）。测试一条。

## M4（中）翻页前不渲染目的地区；Reddit/LINE 禁用条件对齐 `ready`
`mobilePath` 未确定（即 `cardBlob` 为空）时按钮区渲染骨架占位（灰块），有 blob 后再渲染真实按钮；Reddit/LINE `<a>` 的 `aria-disabled`/`href`/样式都以 `ready` 为准。测试：`shareUrl` 到位而 `cardBlob` 未到位时 Reddit 链接无 href。

## 低危（一个 commit）
- L2：文案展开后提供「收起」按钮（`aria-expanded`），编辑过时提供「恢复默认」（`setCaptionOverride(null)`），新增三语 key `share.collapseCaption`、`share.resetCaption`。
- L3：折叠摘要先剥掉 URL 再截 40 字。
- L4：`shareText.ts` 删除 `（{address}）` 死分支。
- L5：轮廓 JSON 改为从 `@/lib/share/data/japan-outline.json` import（Track A 已把文件复制到那里），删除 `components/share/data/japan-outline.json`；`japanLocator.ts` 改成 `await import()` 懒加载并缓存，`PointShareCard` 仅在 `inJapan` 时 await。测试同步。
- L6：手机路径 5 个目的地一行排开（`grid-cols-5`），小屏字号缩小到 `text-xs`。
- L8：竖版 note 的 `gap` 从 8 提到 12；几何测试行高按 `size * 1.2` 计。
- L10：地址行前缀的 `📍` emoji 换成矢量绘制的小图钉（圆 + 三角，品牌粉），不依赖设备 emoji 字体。

## 完成标准
`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿；line-budget OK；`components/share/data/` 目录已删除。汇报每条 commit 与测试关键行。
