# WORKLOG 2025-12-14｜富文本编辑器（飞书风格）优化与修复

## 背景 / 触发问题
- 创建/读取文章时报 `PrismaClientKnownRequestError P2021: The table public.Article does not exist`：数据库未迁移或连接到错误库时会出现。
- 编辑页出现 `Hydration failed`：服务端/客户端渲染的时间字符串不一致（`toLocaleString()` 受运行环境 locale/时区影响）。
- 编辑器交互与飞书不一致：
  - 选中浮动工具条已有三栏，但段首块工具条是另一套（不统一）。
  - 块样式/颜色下拉浮窗 hover 一移开就消失，鼠标无法移动到浮窗上点击。
  - 标题（H1/H2/H3）与正文在视觉上区分不明显（需要 Notion/飞书式排版）。

## 本次完成内容
### 1) 工具条统一（段首 & 选中态）
- 段首左侧 `⋮⋮` 打开的 block menu 改为复用与 BubbleMenu 同款的“三栏工具条”。
- 块样式下拉支持：正文、H1/H2/H3、有序/无序列表、代码块、引用、链接（含移除）、插入图片。
- 对齐/缩进下拉支持：左/中/右对齐、增加/减少缩进（对列表/引用/图片等块也生效）。

相关文件：
- `components/editor/RichTextEditor.tsx`

### 2) 下拉浮窗 hover 消失问题修复
- 去掉触发器与浮窗之间的视觉 gap（原 `mt-1`），改为外层 `top-full` 贴合 + 内部 `pt-2` 做视觉间距，确保鼠标可从按钮移动到浮窗并点击。

相关文件：
- `components/editor/RichTextEditor.tsx`

### 3) 块样式菜单的“预览感”
- 在块样式下拉项中增加左侧 icon，并用字号/字重让 H1/H2/H3 与正文在菜单中更像飞书/Notion 的“样式预览”。

相关文件：
- `components/editor/RichTextEditor.tsx`

### 4) Hydration mismatch 修复（更新时间显示）
- 替换 `toLocaleString()` 为固定格式化（`Intl.DateTimeFormat('zh-CN', timeZone: 'Asia/Shanghai')`），避免 SSR/CSR 文本不一致导致 hydration error。

相关文件：
- `app/(site)/submit/ui.tsx`

### 5) 文档同步
- 更新作者中心/编辑器能力描述，反映“段首工具条已与选中态统一”“下拉浮窗可正常移动选择”等。

相关文件：
- `doc/STATUS.md`
- `doc/generater_tool_step/status/step_08_author_ui.md`

## 验证
- 单测：`npm test`
- 构建：`npm run build`

## 备注 / 排查指引
### Prisma P2021（表不存在）
按 `doc/STATUS.md` 的本地启动流程执行：
1. `npm run db:generate`
2. `npm run db:migrate:dev`
并确认 `DATABASE_URL` 指向正确的 Postgres 数据库与 schema（默认 `public`）。

