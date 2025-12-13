# Step 03｜业务内核：文章状态机 + 权限规则（已完成）

## 目标
在不依赖 DB/Next runtime 的前提下，把“谁能做什么”“状态如何流转”的规则固化为纯函数，并用单测锁定。

## 本次完成内容
- 新增文章工作流纯函数模块 `lib/article/workflow.ts`：
  - `ArticleStatus`：`draft | in_review | rejected | published`
  - `Actor/ArticleState`：用于表达操作者角色与文章归属
  - 权限判断：`isAuthor/isAdmin/canEdit/canSubmit/canWithdraw/canApprove/canReject`
  - 状态流转：`submit/withdraw/approve/reject`
  - 统一返回 `WorkflowResult`，并提供错误码：`FORBIDDEN | INVALID_STATUS | MISSING_REASON`（便于后续 API 层映射 HTTP 状态码）
- 新增单测 `tests/article/workflow.test.ts` 覆盖完整状态机与边界：
  - 作者可编辑状态：`draft/rejected`
  - 提交审核：`draft|rejected -> in_review`
  - 撤回：`in_review -> draft`（仅作者）
  - 管理员审核：`in_review -> published/rejected`（reject 必填 reason）
  - 角色边界：非作者不可编辑/撤回；非管理员不可 approve/reject

## 变更文件
- `lib/article/workflow.ts`
- `tests/article/workflow.test.ts`

## 验收方式（独立可测）
- 运行：`npm run test`
- 预期：所有测试通过（包含 `tests/article/workflow.test.ts`）

