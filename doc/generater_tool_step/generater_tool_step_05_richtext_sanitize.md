# 05｜富文本安全：HTML 净化（白名单 + 调色板 + 字体白名单）

## 目标
富文本编辑器最终会产出 HTML（用于预览/发布渲染）。必须在服务端对 HTML 进行严格净化，避免 XSS 与恶意样式。

## 交付物
- `lib/richtext/sanitize.ts`
  - `sanitizeRichTextHtml(inputHtml: string): string`
  - 仅允许“已确认的常用能力”，禁用 `<hr>` 与 `<video>`
- 调色板与字体白名单配置：
  - 建议集中在 `lib/richtext/palette.ts`、`lib/richtext/fonts.ts`

## 白名单范围（按需求）
允许的结构：
- 标题：`h1/h2/h3`
- 段落：`p`、`br`
- 引用：`blockquote`
- 行内格式：`strong`、`em`、`u`、`code`、`span`（仅用于 color/font-family）
- 列表：`ul/ol/li`
- 链接：`a[href]`（仅 http/https/mailto）
- 表格：`table/thead/tbody/tr/th/td`
- 代码块：`pre > code`
- 图片：`img[src]`（允许本站资源 `/assets/<id>` + 外链 `http(s)://...`；注：站点走 https 时，浏览器可能会拦截 http 图片的混合内容）

明确禁止：
- `hr`
- `video/iframe/embed/object/script/style`
- 任意 `on*` 事件属性
- 任意不在白名单内的 style 属性

## 先写测试（Test First）
新增 `tests/richtext/sanitize.test.ts`，覆盖：
1. XSS：`<img src=x onerror=alert(1)>` → `onerror` 被移除
2. `<script>alert(1)</script>` → script 被移除
3. 禁用标签：`<hr>`、`<video>` → 被移除
4. 链接协议：`javascript:` → 被移除或 href 清空
5. 颜色调色板：
   - 允许：`style="color:#db2777"`（示例）
   - 禁止：`style="color:expression(alert(1))"`、非调色板 hex
6. 字体白名单：
   - 允许：`font-family: system-ui`（示例）
   - 禁止：任意未允许字体
7. 表格/代码块结构保留
8. 图片外链允许：
   - `img src="https://example.com/a.jpg"` → `img` 保留且 `src` 保留
   - `img src="http://example.com/a.jpg"` → `img` 保留且 `src` 保留
9. 图片协议禁止：
   - `img src="javascript:alert(1)"` → `img` 被移除或 `src` 被清空（以测试为准）
   - `img src="data:text/html;base64,..."` → `img` 被移除或 `src` 被清空（以测试为准）

## 再实现
1. 引入 `sanitize-html`（或等价库）
2. 实现 `sanitizeRichTextHtml`：
   - `allowedTags/allowedAttributes`
   - `allowedSchemes`
   - `allowedStyles`：仅 `color` 与 `font-family`（以及必要的 `background-color` 若你希望支持高亮；不需要可不加）
   - 颜色限制：仅允许调色板集合（可复用 Tailwind brand + gray）
   - 字体限制：提供“常见电脑字体”白名单（system-ui/serif/sans-serif/monospace + 常见中英文字体）

## 根据测试结果修正
- 一切白名单变更必须“先改测试再改实现”

## 验收（独立可测）
- `npm run test`：`tests/richtext/sanitize.test.ts` 全绿
