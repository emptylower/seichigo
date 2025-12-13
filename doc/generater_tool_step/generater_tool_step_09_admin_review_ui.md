# 09｜管理员审核 UI：待审列表 + 详情预览 + 同意/拒绝

## 目标
提供管理员审核入口：
- 查看待审文章（in_review）
- 预览（渲染 sanitize 后 HTML）
- 同意发布 / 拒绝（必填原因）

## 交付物（建议路由）
- `app/(site)/admin/review/page.tsx`：待审列表
- `app/(site)/admin/review/[id]/page.tsx`：详情 + 操作

鉴权：
- 必须 `session.user.isAdmin === true`

## 先写测试（Test First）
新增 `tests/admin/review-ui.test.tsx`：
1. 非管理员访问：
   - 显示无权限（或重定向；按实现决定，但要在测试里锁定）
2. 管理员访问：
   - 展示待审列表（mock API 数据）
3. 拒绝必须填写原因：
   - 未填 reason：提示错误，不触发 API
   - 填写 reason：调用 `POST /api/admin/review/articles/[id]/reject`
4. 同意发布：
   - 调用 `POST /api/admin/review/articles/[id]/approve`

## 再实现
1. 列表页：
   - 调用 `GET /api/admin/review/articles?status=in_review`
2. 详情页：
   - 展示 meta（slug/title/animeId/city/tags）
   - 展示内容预览：`dangerouslySetInnerHTML` 渲染 `contentHtml`（来自服务端 sanitize 后的字段）
   - 按钮：
     - 同意发布
     - 拒绝（textarea 输入原因）

## 根据测试结果修正
- 如果你希望“拒绝后作者立刻看到原因并可继续编辑”，确保 API 将 `rejectReason` 写回 Article 且作者端列表展示

## 验收（独立可测）
- `npm run test`：`tests/admin/review-ui.test.tsx` 全绿
- 手动：管理员可同意发布，作者端可看到状态变化

