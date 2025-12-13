# 03｜业务内核：文章状态机 + 权限规则（纯函数，可先测）

## 目标
在不依赖 DB/Next runtime 的前提下，先把“谁能做什么”“状态如何流转”的规则固化为纯函数，并用单测锁定。

## 交付物
- `lib/article/workflow.ts`（建议路径，可调整）：
  - `ArticleStatus` 枚举/联合类型
  - 状态流转函数（submit/withdraw/approve/reject）
  - 权限判断函数（作者/管理员）
- 单测覆盖完整状态机与边界条件

## 先写测试（Test First）
新增 `tests/article/workflow.test.ts`，覆盖：
1. 作者可编辑：`draft`、`rejected`；不可编辑：`in_review`、`published`
2. 提交审核：
   - `draft -> in_review` OK
   - `rejected -> in_review` OK
   - `in_review` 再提交：失败
3. 撤回：
   - `in_review -> draft` OK（仅作者）
   - `draft` 撤回：失败
4. 管理员审核：
   - approve：仅 `in_review -> published`
   - reject：仅 `in_review -> rejected` 且必须有 `reason`
5. 角色边界：
   - 非作者不可撤回/编辑
   - 非管理员不可 approve/reject

> 测试先写到“红”，再开始实现。

## 再实现
1. 新增 `lib/article/workflow.ts`
2. 类型建议（示例，仅指导）：
   - `type ArticleStatus = "draft" | "in_review" | "rejected" | "published"`
   - `type Actor = { userId: string; isAdmin: boolean }`
3. 业务规则落地为纯函数，避免 import Prisma/Next。

## 根据测试结果修正
- 如发现规则不清晰（例如 rejected 是否允许编辑），以本用例为准：**rejected 允许编辑并可再次提交审核**。

## 验收（独立可测）
- `npm run test`：`tests/article/workflow.test.ts` 全绿

