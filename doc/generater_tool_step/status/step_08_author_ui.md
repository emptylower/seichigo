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
  - `app/(site)/submit/new/page.tsx` + `app/(site)/submit/new/ui.tsx`
  - 通过 `POST /api/articles` 创建草稿后跳转到编辑页
- 新增编辑页（元信息 + 富文本 + 自动保存）：
  - `app/(site)/submit/[id]/page.tsx`：服务端加载文章（仅作者可访问）
  - `app/(site)/submit/[id]/ui.tsx`：
    - 元字段：slug/title/animeId/city/routeLength/tags
    - 简化编辑器：直接编辑 HTML，产出 `contentHtml`（`contentJson` 暂为 `null`）
    - 自动保存（debounce）：`PATCH /api/articles/[id]`
    - 提交审核：`POST /api/articles/[id]/submit`
    - 审核中撤回：`POST /api/articles/[id]/withdraw`
    - rejected 状态展示 `rejectReason`；非可编辑状态提供只读预览
- 简化编辑器接入（包含图片上传）：
  - `components/editor/RichTextEditor.tsx`：
    - 正文：用 `<textarea>` 编辑 HTML（服务端仍会再 sanitize）
    - 图片：上传走 `POST /api/assets`，自动插入 `<img src="/assets/<id>">`
- 测试先行：
  - `tests/submit/ui.test.tsx` 覆盖未登录提示、登录后“新建文章”入口、点击“提交审核”触发 API 调用与提示展示

## 变更文件
- Pages/UI：
  - `app/(site)/submit/page.tsx`
  - `app/(site)/submit/ui.tsx`
  - `app/(site)/submit/new/page.tsx`
  - `app/(site)/submit/new/ui.tsx`
  - `app/(site)/submit/[id]/page.tsx`
  - `app/(site)/submit/[id]/ui.tsx`
- Editor：
  - `components/editor/RichTextEditor.tsx`
- Tests：
  - `tests/submit/ui.test.tsx`

## 验收方式（独立可测）
- 自动化：`npm run test`
- 构建：`npm run build`
- 手动：
  - 登录后访问 `/submit` → 新建草稿 → 编辑/自动保存 → 提交审核 → 审核中可撤回
