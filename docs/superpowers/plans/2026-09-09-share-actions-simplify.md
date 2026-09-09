# 分享动作精简与「粘贴出现两张图」修复

## 两个现象（站长实测）
1. 系统分享可用时，面板同时给出「分享到…」和 X / Reddit / LINE / 小红书 / 微信 五个按钮，但这五个点下去都只是打开同一个系统分享面板，并不跳转到对应平台，等于重复。
2. 用 QQ / 微信分享后粘贴，会出现**两张图**。原因已定位：`components/share/shareClient.ts:117` 的 `nav.share({ files, text, url })` 同时传了图片文件和链接，微信把文件插成一张照片，又把链接展开成预览卡（预览图正是同一张卡），于是两张。

## 改法

### S1 系统分享只发链接，不再附带文件
`shareClient.ts` 的 `shareViaSystem`：
- 改为 `nav.share({ title, text, url })`，**不传 `files`**。返回值语义相应简化（不再需要区分「带文件成功」与「退化为纯文本」）。
- `canShareFiles` 若已无调用方则删除；`mobilePath` 的判定改为「系统分享是否可用」：`typeof navigator.share === 'function'`（不再依赖构造 1 字节 JPEG 桩去探测文件能力）。
- 相关注释写明：链接的预览图由服务端 OG 卡片提供，附带文件会导致微信/QQ 出现两张图。

### S2 系统分享路径只留两个按钮
系统分享可用时，动作区只渲染：
- 主按钮「分享到…」（`c=sys`）
- 次按钮「保存图片」（`c=save`，走 `fetchCardBlob` + `downloadBlob`）
删除该路径下的 X / Reddit / LINE / 小红书 / 微信 五个按钮。「更多」折叠保留「复制文案」（复制图片在此路径下无意义，一并去掉）。

**非系统分享路径（桌面浏览器不支持 Web Share）维持现状不动**：X / Reddit / LINE 在那里是真跳转，小红书 / 微信是真的下载加复制，都有意义。

### S3 文案与提示
- 「保存图片」的说明文案沿用现有 key，不新增。
- 若删除按钮导致某些 i18n key 变成无引用，**不要删 key**（服务端卡片仍在用 `cardQrTitle` 等），只在 `tests/i18n/shareKeys.test.ts` 保持登记。

## 测试
- 系统分享可用时：动作区只有「分享到…」与「保存图片」，X/Reddit/LINE/小红书/微信按钮不存在。
- `shareViaSystem` 调用 `navigator.share` 时参数**不含 `files`**（断言传入对象的 key 集合）。
- 系统分享不可用时：六个入口与现状一致（沿用已有用例，确认未被误删）。
- 「保存图片」仍能拿到 blob 并触发下载。
- 捞回/保留 `pointSharePanelFlow.test.tsx` 里非系统分享路径的全部断言。

## 约束
只动 `components/share/**`、`tests/components/**`、`tests/i18n/**`。不碰 `lib/share/**`（import 除外）、`app/**`、`features/**`。不 push、不 build、不部署。line-budget 必须 OK。
每条一个 commit，先测试后实现，message 末尾带：
```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ljpw5KUBFkwirrTQmZjGAP
```

## 完成标准
`npx tsc -p tsconfig.app.json --noEmit` 0 错误；`npm test` 全绿。汇报 commit sha 与测试关键行。
