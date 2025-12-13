# 08｜作者端 UI：升级 `/submit` 为“草稿箱 + 富文本编辑器 + 提交审核”

## 目标
把现有 `/submit`（纯 Markdown 表单）升级为作者创作中心：
- 草稿箱（draft/rejected）
- 审核中（in_review）
- 已发布（published）
- 新建/编辑草稿（富文本 + 图片）
- 提交审核/撤回

## 交付物（建议路由结构）
- `app/(site)/submit/page.tsx`：作者中心（列表 + 状态筛选）
- `app/(site)/submit/new/page.tsx`：新建
- `app/(site)/submit/[id]/page.tsx`：编辑草稿/查看审核状态

> 如你希望路由不同（例如 `/editor`），实现前先统一命名。

## 富文本能力（按确认范围）
包含：
- 标题（H1/H2/H3）、段落、引用
- 加粗/斜体/下划线
- 字体颜色（调色板）
- 字体（常见字体白名单）
- 有序/无序列表
- 链接
- 表格
- 行内 code + code block
- 图片（上传到 DB，插入 `<img src="/assets/<id>">`）
  - 也支持外链：插入 `<img src="http(s)://...">`（受 sanitize 规则约束）

不包含：
- 分割线（hr）
- 视频

## 先写测试（Test First）
新增 `tests/submit/ui.test.tsx`（组件测试，覆盖最小闭环）：
1. 未登录：
   - 显示“请先登录”+ 跳转链接（不需要真实 next/navigation，mock 即可）
2. 登录用户：
   - 能看到“新建文章”按钮
3. 点击“提交审核”按钮：
   - 调用对应 API（mock `fetch`）
   - 处理成功/失败提示

> 编辑器本体（TipTap）不建议在单测里完整渲染；UI 测试聚焦按钮/状态/调用链即可。

## 再实现
1. 列表页：
   - 读取 `GET /api/articles?scope=mine&status=...`
2. 编辑页：
   - 字段：slug/title/animeId/city/routeLength/tags + 富文本 content
   - 自动保存（debounce）调用 `PATCH /api/articles/[id]`
   - 提交审核：`POST /api/articles/[id]/submit`
   - 审核中状态显示“撤回”按钮：`POST /api/articles/[id]/withdraw`
   - rejected 状态展示 `rejectReason`
3. TipTap 集成：
   - toolbar + image upload（调用 `POST /api/assets`）
   - 保存时同时提交 `contentJson` 与由编辑器导出的 `contentHtml`（服务端仍会再 sanitize）

## 根据测试结果修正
- 若 UI 交互调整（例如把提交按钮移动到别处），先改测试再改实现

## 验收（独立可测）
- `npm run test`：`tests/submit/ui.test.tsx` 全绿
- 手动：登录后可创建草稿、编辑、提交审核、撤回
