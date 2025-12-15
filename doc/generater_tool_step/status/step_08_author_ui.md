# Step 08｜作者端 UI：升级 `/submit` 为“草稿箱 + 富文本编辑器 + 提交审核”（已完成）

## 目标
把现有 `/submit` 升级为作者创作中心：
- 草稿箱（`draft/rejected`）
- 审核中（`in_review`）
- 已发布（`published`）
- 新建/编辑草稿（简化富文本 + 图片）
- 提交审核/撤回

## 本次完成内容
- 新增作者中心（列表 + 状态筛选 + 快捷操作）：
  - `app/(site)/submit/page.tsx`：服务端取 session，渲染客户端列表 UI
  - `app/(site)/submit/ui.tsx`：调用 `GET /api/articles?scope=mine` 拉取我的稿件；草稿/被拒可“提交审核”，审核中可“撤回”，并展示提示信息
- 新增新建草稿入口：
  - `app/(site)/submit/new/page.tsx`
  - 直接进入编辑器；首次输入正文后通过 `POST /api/articles` 懒创建草稿，并自动跳转到编辑页
- 新增编辑页（元信息 + 富文本 + 自动保存）：
  - `app/(site)/submit/[id]/page.tsx`：服务端加载文章（仅作者可访问）
  - `app/(site)/submit/[id]/ui.tsx`：客户端桥接到统一的编辑器 UI
  - `app/(site)/submit/_components/ArticleComposerClient.tsx`：
    - 标题 + 正文（TipTap 富文本）自动保存：`PATCH /api/articles/[id]`
    - “提交审核”弹窗填写发布信息：`animeIds/city/routeLength/tags`（保存后再 `POST /api/articles/[id]/submit`）
    - 审核中撤回：`POST /api/articles/[id]/withdraw`
    - rejected 状态展示 `rejectReason`；非可编辑状态提供只读预览
- 富文本编辑器接入（包含图片上传）：
  - `components/editor/RichTextEditor.tsx`：
    - 飞书风格交互：
      - 选中文本/点选图片：浮动工具条（三栏）
        - ① 块样式下拉：正文、H1-H3、有序/无序列表、引用、代码块、链接、插入图片
        - ② 对齐&缩进下拉：左/中/右对齐、增加/减少缩进（跨块生效；列表缩进走嵌套）
        - ③ 行内样式：加粗/删除线/斜体/下划线/行内代码 + 颜色面板（字体颜色 + 背景高亮，固定调色板，靠“默认/无”色块恢复）
      - 段首：悬浮块菜单（点击左侧 ⋮⋮ 打开，工具条与选中态同款三栏；下拉浮窗 hover 可正常移动选择）
    - 图片：上传走 `POST /api/assets`，编辑器内插入 `<img src="/assets/<id>">`
    - 安全：保存时服务端会对 HTML 进行 sanitize
- 测试先行：
  - `tests/submit/ui.test.tsx` 覆盖未登录提示、登录后“新建文章”入口、点击“提交审核”触发 API 调用与提示展示

## 变更文件
- Pages/UI：
  - `app/(site)/submit/page.tsx`
  - `app/(site)/submit/ui.tsx`
  - `app/(site)/submit/new/page.tsx`
  - `app/(site)/submit/[id]/page.tsx`
  - `app/(site)/submit/[id]/ui.tsx`
  - `app/(site)/submit/_components/ArticleComposerClient.tsx`
- Editor：
  - `components/editor/RichTextEditor.tsx`
- Tests：
  - `tests/submit/ui.test.tsx`

## 验收方式（独立可测）
- 自动化：`npm run test`
- 构建：`npm run build`
- 手动：
  - 登录后访问 `/submit` → 新建草稿 → 编辑/自动保存 → 提交审核 → 审核中可撤回
