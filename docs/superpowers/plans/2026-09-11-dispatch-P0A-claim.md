# Phase 0-A：一次性执行 claim（agentRunStartedAt）

worktree：`/Users/mac/Desktop/seichigo-wt-dispatch` ／ 分支：`feat/dispatch-phase0`

> 背景：`docs/superpowers/plans/2026-09-11-dispatch-joint-plan-v1.md`（联合方案）§1 Phase 0、§2 不变量 1 与 3。
> 本份只做 **claim** 这一件事。预扣/撤销（P0-B）与恢复推断（P0-C）是后续两份，**这次不要碰**。

## 要修的隐患（为什么）

内部执行入口今天用 `renewAgentRunOwner`（`lib/tripPlan/repoPrisma.ts` 约 `:345`）：`WHERE id AND agentRunToken=token` 续租并返回 userId。它只能拒"失效 token"，**拒不了同一有效 token 的第二个执行者**。Cloudflare Queue 是 at-least-once，两个消费者拿同一条消息都能通过——模型跑两次、消息交错、计费翻倍。修法：token 匹配**且尚未启动**才放行，原子一条 SQL。

## 效率要求

- **只读下面列出的文件**。不要读前端、不要读 `lib/billing/**`、不要读 `lib/planAgent/loop.ts`、不要 grep 整个仓库。
- **不要调用 `executing-plans`、`brainstorming` 之类的技能**，直接干活。

### 必读文件
1. `prisma/schema.prisma` 的 `model TripPlan`（约 `:1007-1025`）
2. `lib/tripPlan/repo.ts`（接口；重点 `beginAgentRun` / `renewAgentRun` / `renewAgentRunOwner` / `endAgentRun` / `stopAgentRun` 的声明与注释）
3. `lib/tripPlan/repoPrisma.ts` `:270-400`
4. `lib/tripPlan/repoMemory.ts`（对应方法）
5. `app/api/internal/plan-agent/run/route.ts`（全文，约 180 行）
6. `app/api/me/plans/[id]/agent/route.ts` **只看 `:236-300` 内联 SSE 段**
7. `tests/api/plan-agent-internal-run.test.ts`、`tests/tripPlan/`（找 beginAgentRun/renew 相关的既有测试文件）

## 边界

允许改：上述 1–6 + `prisma/migrations/` 新增一个目录 + 相关测试。
**绝不要改**：`lib/billing/**`、`lib/planAgent/loop.ts`、`lib/planAgent/resume.ts`、`lib/tripPlan/handlers/**`、`lib/tripPlan/view.ts`、`app/(authed)/**`、`worker/**`、`wrangler.jsonc`、`package.json`、`line-budget.allowlist.json`。
不要 `git commit` / `push` / 切分支；不要跑 `npm run dev` / `build` / `cf:*` / playwright。

## ⚠️ 迁移：只动开发库，绝不碰生产

1. `schema.prisma` 的 `TripPlan` 加 `agentRunStartedAt DateTime?`（放在 `agentRunToken` 下一行）。
2. **手写**迁移目录 `prisma/migrations/20260911090000_add_agent_run_started_at/migration.sql`：
   ```sql
   ALTER TABLE "TripPlan" ADD COLUMN "agentRunStartedAt" TIMESTAMP(3);
   ```
3. 只对开发库（`.env` 的 localhost）应用：
   ```
   npx prisma db execute --file prisma/migrations/20260911090000_add_agent_run_started_at/migration.sql --schema prisma/schema.prisma
   npx prisma migrate resolve --applied 20260911090000_add_agent_run_started_at
   npx prisma generate
   ```
4. ⚠️ **禁止 `prisma migrate dev`**（开发库有存量漂移，它会要求 reset）。⚠️ **禁止读取或注入 `.env.local`**（那是生产 Neon）。生产迁移由负责人在部署时执行。

## 改什么

### 1. 仓储（`repo.ts` / `repoPrisma.ts` / `repoMemory.ts`）

- `beginAgentRun`：抢 busy 位的那条条件 `updateMany` 的 `data` 里**同时** `agentRunStartedAt: null`（新 token 必然重置）。
- 新增：
  ```ts
  /**
   * 一次性执行领取：token 匹配且尚未启动才成功——原子写 agentRunStartedAt=now 并续租，
   * 返回归属用户。token 失效、或同 token 已被别的执行者领取，都返回 null（调用方一律 skipped）。
   * 联合方案 v1 不变量 1：一个 token 至多领取成功一次。
   */
  claimAgentRun(planId: string, token: string, ttlMs: number): Promise<{ userId: string } | null>
  ```
  Prisma：`updateManyAndReturn({ where: { id, agentRunToken: token, agentRunStartedAt: null }, data: { agentRunStartedAt: now, agentBusyUntil: now+ttl }, select: { userId: true } })`，`rows[0] ?? null`。
  Memory：与 `renewAgentRunOwner` 同语义 + 增加 `startedAt` 字段；已 started 返回 null 且不写。
- 新增（服务端专用，**不进领域类型 `TripPlan`、不进 view**，token 绝不能泄露给客户端）：
  ```ts
  /** 当前 run 租约状态（服务端用：恢复推断与撤销）。无 token 时返回 null。 */
  getAgentRunState(planId: string): Promise<{ token: string; busyUntil: Date | null; startedAt: Date | null } | null>
  ```
- `renewAgentRun`（运行期续租）**保持不检查 startedAt**（不变量 1：否则执行者自己无法续租）。`renewAgentRunOwner` 保留但内部路由不再用它；加注释说明已被 claim 取代。
- `endAgentRun` / `stopAgentRun` 清 token 时**不必**清 startedAt（新 token 才重置）；但 `stopAgentRun` 的 where 条件不变。

### 2. 内部路由 `app/api/internal/plan-agent/run/route.ts`

`renewAgentRunOwner(...)` → `claimAgentRun(...)`；null 时响应保持**逐字节相同** `NextResponse.json({ skipped: 'stale_token' })`（前端/消费者契约不变）。注释改成"token 失效、已被停止/接管、**或同 token 已被领取过**都命中 0 行"。

### 3. 内联 SSE 路径 `app/api/me/plans/[id]/agent/route.ts:236-300`

`beginAgentRun` 之后、构造 `ReadableStream` **之前**：
```ts
const owner = await deps.repo.claimAgentRun(id, runToken, AGENT_BUSY_TTL_MS)
if (!owner) {
  // 不变量 3：loser 没有执行副作用——不进下面那个无条件 endAgentRun 的 finally
  return NextResponse.json({ queued: true, runToken }, { status: 202 })
}
```
放在现有 `await reserveRun()` **之前**（P0-B 会重排预扣，这里先不动 reserveRun 本身）。

## 测试

- `tests/tripPlan/`（就近新建或扩展）：
  - `claimAgentRun` 同 token **两次调用**：第一次返回 owner 且 startedAt 被写；第二次返回 null 且 busyUntil 不变。Memory 与（若已有 dev 库集成测试基建）Prisma 都覆盖；至少 Memory。
  - token 不符 → null 且不写。
  - `beginAgentRun` 拿新 token 后 `startedAt` 为 null（可再次 claim）。
  - `renewAgentRun` 在 startedAt 非空时仍成功。
- `tests/api/plan-agent-internal-run.test.ts`：
  - 同一 token 两次 POST 内部路由：第一次调用 `executePlanAgentRun`，第二次响应 `{ skipped: 'stale_token' }` 且**不**调用 `executePlanAgentRun`（F1 的非 DO 部分）。
  - 既有用例（stale token / 计划不存在 / 正常 / billing）继续绿。
- 内联路径：claim 失败 → 202 `{queued:true, runToken}`，`executePlanAgentRun` 与 `endAgentRun` 均不被调用。

## 验收

```
npm run typecheck
npm test
```
两个都要过。首轮若挂 `tests/map/resilient-map-image.test.tsx`，是本底 jsdom 时序 flaky，单独重跑确认即可。

## 报告

简短中文汇报：迁移文件路径与开发库应用结果（贴 `migrate resolve` 的输出）、新增方法签名、内部路由/内联路径的改动点、两条验收命令的**实际输出**。不要 `git commit`。
