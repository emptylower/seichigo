# Step 05｜富文本安全：HTML 净化（已完成）

## 目标
为富文本编辑器产出的 HTML 提供**服务端**净化能力，严格白名单以避免 XSS 与恶意样式注入。

## 本次完成内容
- 新增富文本净化入口：`sanitizeRichTextHtml(inputHtml: string): string`
  - 白名单 tag/attributes（覆盖标题/段落/引用/行内格式/列表/链接/表格/代码块/图片）
  - 明确禁用：`hr`、`video`、`script/style` 等危险或不在需求内的标签
- 限制链接与图片协议：
  - `<a href>`：仅允许 `http/https/mailto`（`javascript:` 等会被移除）
  - `<img src>`：仅允许 `http(s)://...` 或站内资源路径 `/assets/<id>`（其它协议直接移除 `<img>`）
- 限制可用样式（仅针对 `span`）：
  - 只解析并保留 `color`（必须命中调色板）
  - 只解析并保留 `font-family`（必须命中字体白名单；支持逗号分隔的 font stack，任一不在白名单即整体移除）
- 新增单测覆盖 XSS/协议/禁用标签/调色板/字体白名单/表格与代码块保留等场景，锁定行为边界。

## 变更文件
- `lib/richtext/sanitize.ts`
- `lib/richtext/palette.ts`
- `lib/richtext/fonts.ts`
- `tests/richtext/sanitize.test.ts`
- `package.json`
- `package-lock.json`

## 验收方式（独立可测）
- 运行：`npm run test`
- 预期：`tests/richtext/sanitize.test.ts` 通过，且全量测试保持全绿

