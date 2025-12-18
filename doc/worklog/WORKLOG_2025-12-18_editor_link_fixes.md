# WORKLOG 2025-12-18｜修复富文本“链接不生效”与“行内代码无法加链接”

## 背景 / 现象
- 在富文本编辑器中选中文本 → 选择“链接…” → 输入 URL 并点击保存，文本仍保持正文样式，链接未生效。
- 进一步发现：当选中的文本是“行内代码（inline code）”样式时，始终无法保存为链接。

## 根因分析
### 1) 链接编辑时选区丢失（导致 setLink 落在空选区）
- 打开“链接…”后焦点从 ProseMirror 移到链接输入框，编辑器的 selection 会发生变化/折叠。
- 在 selection 丢失的情况下执行 `setLink()`，看起来“点了保存但不生效”。
- 同时 BubbleMenu 的显示条件依赖编辑器 focus，焦点切到输入框后工具条可能隐藏，进一步放大误解。

### 2) 行内代码 mark 默认排斥所有 mark（导致 link 无法叠加）
- TipTap 的 `@tiptap/extension-code`（行内 code mark）默认 `excludes: "_"`，表示排斥所有其他 mark。
- 因此当文本已经是 `code` mark 时，`link` mark 无法被添加（即使选区正确也无效）。

## 解决方案
### 1) 链接编辑器：缓存并恢复选区 + 菜单在编辑链接时保持显示
- 打开链接编辑时缓存 `{ from, to }`，保存/移除链接前先恢复选区，再执行 `setLink/unsetLink`。
- BubbleMenu `shouldShow` 增强：当焦点在菜单内或正在编辑链接时也保持显示，避免交互被中断。
- 额外优化：支持将 `example.com` 这类输入归一化为 `https://example.com`，减少“看似没生效”的输入错误。

相关文件：
- `components/editor/RichTextEditor.tsx`

### 2) 行内代码允许与链接共存：自定义 InlineCode 扩展替换默认 code
- 新增 `InlineCode`：基于 `@tiptap/extension-code` 扩展，将 `excludes` 从 `"_"` 收敛为排除常见文本样式，但不排除 `link`。
- 在编辑器中关闭 StarterKit 自带 `code`（`code: false`），改用 `InlineCode`。

相关文件：
- `components/editor/extensions/InlineCode.ts`
- `components/editor/RichTextEditor.tsx`

## 测试 / 验证
- 运行单测：`npm test`
- 新增回归测试：验证“行内 code 文本可成功添加 link mark”：
  - `tests/editor/link-inline-code.test.tsx`

## 提交与推送
- Commit：`bdb59c0`（`fix(editor): allow links on inline code`）
- 已推送到：`origin/main`

