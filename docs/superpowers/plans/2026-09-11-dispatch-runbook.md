# 派发改造上线 runbook（负责人 / Claude 执行）

依据：`2026-09-11-dispatch-joint-plan-v1.md` §1 各阶段上线顺序与回退。所有步骤都留 tag。

## Phase 0 上线

前置：P0-A/B/C 三批在 `feat/dispatch-phase0` 完成、typecheck + 全量测试绿、我逐 diff 复核。

1. **合并**：`main` ← `feat/dispatch-phase0`（`--no-ff`），push。打 `rollback/pre-dispatch-phase0-<ts>`。
2. **暂停新启动**（配置发布，需等待生效）：
   `npx wrangler deploy` 不能只改 var（会重建整个 worker）。用当前生产版本 + `--var`：
   `npx wrangler versions upload --var PLAN_AGENT_STARTS_PAUSED:1` → `npx wrangler versions deploy <id>@100%`。
   ⚠️ 旧版本代码里还没有这个开关——Phase 0 之前的生产代码不认识它。所以 Phase 0 的**第一次**上线只能靠"低流量时段 + 核对无活跃 run"来排空，暂停开关从 Phase 0 之后才可用。核对 SQL：
   `SELECT id, agentRunToken, agentBusyUntil FROM "TripPlan" WHERE agentBusyUntil > now();` 为空 + `wrangler queues info` 无积压。
3. **生产迁移**：注入 `.env.local` 的 `DATABASE_URL` 与 `DATABASE_URL_UNPOOLED`（用 node spawnSync 传 env，URL 含 `&`），先 `prisma migrate status` 核对 host 是 neon.tech 且待应用只有 `20260911090000_add_agent_run_started_at`，再 `prisma migrate deploy`。列是 nullable，对旧代码无影响。
4. **部署**：predeploy guard → `cf:deploy`（注入 Hyperdrive 本地连接串）→ deploy ledger tag。
5. **核对**：再查一次 `agentBusyUntil > now()` 为空；tail 看 `[planAgent/timing]` 正常；触发一次真实 run（测试账号）看 `agentRunStartedAt` 被写、第二次同 token 内部请求 `skipped`。
6. **Codex e2e**（生产，测试账号）：正常发送 → 首字 → 完成；运行中点停止 → 手动继续；运行中刷新页面 → 观察流恢复；busy 时再发 → 409；账本：每次 run 恰一条 reserve + 一条 settle/refund。

回退：`wrangler versions rollback` 到 `rollback/pre-dispatch-phase0` 对应版本；新列保留（nullable 无害）。

## Phase 1 上线

1. 合并 `feat/dispatch-phase1` → main，tag `rollback/pre-dispatch-phase1-<ts>`。
2. `cf:deploy`（带 DO migration v2；`PLAN_AGENT_DISPATCH=queue`，白名单空）→ ledger tag。核对 DO 类已存在（`wrangler deployments`/dashboard）。
3. `versions upload --var PLAN_AGENT_DISPATCH:do --var PLAN_AGENT_DO_CANARY_USER_IDS:<测试账号 userId>` → deploy 100%。
4. 测试账号跑 8 轮（轻/重 × 4），读 timings：`transport=do`、`queueDispatchMs`（此处 = 首次派发→alarm 入口）P50 ≤300ms / P95 ≤1000ms；同时 Codex 浏览器侧测首次可见 reasoning。
5. 达标 → 扩白名单（负责人给名单）；不达标 → 白名单清空，保留 DO 类。

回退：`--var PLAN_AGENT_DISPATCH:queue`；在途 DO 自行跑完。⚠️ 不要跨 DO migration 做 `versions rollback`。
