# 第九轮补充：忙碌租约缩短到 90 秒并在每次工具调用前续租（2026-09-04）

背景：第九轮预览验收实证——客户端网络中断后，Cloudflare 在约 30 秒内结束整个调用（`finally` 不执行、没有运行日志），run 无法在服务端存活；已落库的工具结果都还在，恢复靠"租约过期 → 接口按 `missing_run_log` 推断中断 → 页面自动续跑"。当前租约 3 分钟、只在模型调用前续租：一次 `save_plan_days`（补齐脚本可能 1–2 分钟）或多次连续工具调用期间不续租，活着的 run 可能被误判过期；死掉的 run 又要等最长 3 分钟才能自动续跑。

工作方式同前：先补失败测试再改；**不要 git commit**；**不跑迁移**；只碰 `app/api/me/plans/[id]/agent/route.ts`、`lib/planAgent/loop.ts`、`lib/tripPlan/repo*.ts`（如需）、`tests/planAgent/**`、`tests/tripPlan/**`。line-budget 必须通过。

## L1 租约 90 秒 + 工具前续租
- `AGENT_BUSY_TTL_MS` 3 分钟 → 90 秒。
- `loop.ts`：除现有"每次模型调用前续租"外，**每次工具执行前**也 `renewAgentRun(planId, token, ttl)`；`save_plan_days` 这类长工具内部（`enrichAndNormalizeDays` 之前与之后）各续一次（通过 deps 传入 `renewLease?: () => Promise<void>`，tools.ts 只允许加 1–2 行调用，不得超 750 行）。续租失败（被接管）→ 抛 `RunFencedError` 结束本 run（现有语义）。
- 测试：`tests/planAgent/loop.test.ts` 补「一轮含 3 次工具调用 → renew 被调用 ≥ 4 次（模型前 1 + 工具前 3）」；`tools.save-plan-days-*.test.ts` 补「save 期间 renewLease 至少调用 2 次」。

## L2 续跑说明补充（`lib/planAgent/resume.ts`）
- `RESUME_NOTE` 明确："已落库的工具结果都在历史消息里，直接基于它们继续，不要重新查询同样的路线或餐厅"。

完成标准：`npx vitest run tests/planAgent tests/tripPlan` 全绿；`npx tsc --noEmit` 无错；`typecheck:tests` 无新增；line-budget 通过；简短中文汇报。
