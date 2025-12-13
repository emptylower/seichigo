# 本次对话工作记录（2025-12-13）

## 本次目标
- 完成 `doc/generater_tool_step/generater_tool_step_08_author_ui.md`（作者端：草稿箱 + 富文本编辑器 + 提交审核）

## 已完成：Step 08｜作者端 UI（创作中心）
### 交付内容
- 升级 `/submit` 为作者创作中心（草稿箱/审核中/已发布/全部筛选）：
  - 列表拉取 `GET /api/articles?scope=mine`
  - 草稿/被拒：支持“提交审核”（`POST /api/articles/[id]/submit`）
  - 审核中：支持“撤回”（`POST /api/articles/[id]/withdraw`）
  - rejected 展示 `rejectReason`
- 新建草稿页 `/submit/new`：
  - 调用 `POST /api/articles` 创建草稿并跳转到编辑页
- 编辑页 `/submit/[id]`：
  - 元信息字段：`slug/title/animeId/city/routeLength/tags`
  - 简化编辑器：产出 `contentHtml`（`contentJson` 暂为 `null`）
  - 自动保存（debounce）：`PATCH /api/articles/[id]`
  - 状态控制：仅 `draft/rejected` 可编辑；`in_review/published` 只读预览
- 简化编辑器接入：
  - 正文：用 `<textarea>` 编辑 HTML（服务端仍会再 sanitize）
  - 图片：上传 `POST /api/assets` 后插入 `<img src="/assets/<id>">`

### 测试
- 新增 `tests/submit/ui.test.tsx`：
  - 未登录：提示“请先登录”并提供跳转链接
  - 已登录：展示“新建文章”入口
  - 点击“提交审核”：mock `fetch` 并断言调用 `/api/articles/:id/submit`

### 验证
- `npm run test` 全绿
- `npm run build` 通过

## 相关状态文档
- `doc/generater_tool_step/status/step_08_author_ui.md`
