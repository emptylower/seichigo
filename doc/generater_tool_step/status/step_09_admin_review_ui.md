# Step 09｜管理员审核 UI：待审列表 + 详情预览 + 同意/拒绝（已完成）

## 目标
提供管理员审核入口：
- 查看待审文章（`in_review`）
- 预览（渲染 sanitize 后 HTML）
- 同意发布 / 拒绝（必填原因）

## 本次完成内容
- 新增管理员审核页面（服务端鉴权）：
  - `app/(site)/admin/review/page.tsx`：待审列表入口；未登录跳转 `/auth/signin`；非管理员显示“无权限访问。”
  - `app/(site)/admin/review/[id]/page.tsx`：审核详情页；同样做鉴权
- 新增审核 UI（客户端交互）：
  - `app/(site)/admin/review/ui.tsx`
    - 调用 `GET /api/admin/review/articles?status=in_review` 拉取待审列表
  - `app/(site)/admin/review/[id]/ui.tsx`
    - 调用 `GET /api/articles/[id]` 拉取文章详情（包含 `contentHtml`）
    - 预览区使用 `dangerouslySetInnerHTML` 渲染 `contentHtml`
    - “同意发布”调用 `POST /api/admin/review/articles/[id]/approve`
    - “拒绝”前端校验 reason 必填，调用 `POST /api/admin/review/articles/[id]/reject`（JSON：`{ reason }`）
- 新增 UI 测试（测试先行）：`tests/admin/review-ui.test.tsx`
  - 非管理员访问：显示无权限
  - 管理员访问：展示待审列表（mock API）
  - 拒绝：未填 reason 提示错误且不发请求；填写后调用 reject API
  - 同意发布：调用 approve API

## 变更文件
- Pages/UI：
  - `app/(site)/admin/review/page.tsx`
  - `app/(site)/admin/review/ui.tsx`
  - `app/(site)/admin/review/[id]/page.tsx`
  - `app/(site)/admin/review/[id]/ui.tsx`
- Tests：
  - `tests/admin/review-ui.test.tsx`

## 验收方式（独立可测）
- 自动化：`npm run test`（应包含 `tests/admin/review-ui.test.tsx` 通过）
- 手动：
  - 管理员登录后访问 `/admin/review`
  - 点击任一待审文章进入详情页，可预览并执行“同意发布 / 拒绝（填写原因）”

