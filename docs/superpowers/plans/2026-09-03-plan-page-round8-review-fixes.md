# 第八轮验收修复：隔离体被硬杀时也要能识别中断（2026-09-03）

背景：第八轮在预览（0526dc97）上验收：故意 15 秒后切断连接，run 又继续跑了约 100 秒后被 Cloudflare 硬终止（isolate 直接被杀，`finally` 没执行）：`agentBusy` 直到租约过期（约 5 分钟）才变 false，`interrupted` 始终为 null，最后一条消息是一段中途的 assistant 文本（"现在把第 6 天午餐换成这家并完整重存"），没有 tool_calls、没有 daymap、也没有该回合的运行日志。现有实现只在 `finally` 里写 `stage:'interrupted'`，硬杀场景下写不到，前端因此不会自动续跑。

工作方式同前：先补失败测试再改；**不要 git commit**；**不跑迁移**；只碰 `lib/tripPlan/handlers/planById.ts`、`lib/planAgent/resume.ts`、`app/api/me/plans/[id]/agent/route.ts`（如需）、`lib/tripPlan/repo*.ts`（如需新增只读查询）、`tests/planAgent/**`、`tests/tripPlan/**`。前端不动（它只消费 `interrupted` 与 `resume`）。

## F1 从状态推断中断（`planById.ts`）
`interrupted` 的判定改为（`agentBusy === false` 前提下，满足任一）：
1. 最后一条运行日志 `stage === 'interrupted'`（现有）；
2. **最后一条 human 消息之后没有任何运行日志**（`lastHuman.createdAt > (lastRunLog?.createdAt ?? 0)`）——run 被硬杀、没来得及写日志；
3. 最后一条非 tool/daymap 消息是带 `tool_calls` 的 assistant，或是未回答的 `ask`（对话悬空）。
返回 `{ at: 最后一条消息的 createdAt, turnIndex: (lastRunLog?.turnIndex ?? 0) + 1, reason: 'run_log' | 'missing_run_log' | 'dangling' }`（`reason` 新增，前端可忽略）。
测试 `tests/tripPlan/planById.live.test.ts` 补三例：硬杀（有 human、无日志、尾部 assistant 纯文本）→ `missing_run_log`；正常收尾（有日志且 stage 非 interrupted、尾部 assistant 文本）→ null；尾部 assistant 带 tool_calls → `dangling`。

## F2 `canResume` 与 F1 对齐（`resume.ts`、route）
- `canResume(messages, runLogs)`：F1 的三条任一成立即可续；尾部 assistant 纯文本但**该回合无运行日志** → 可续（RESUME_NOTE 已要求"若行程已保存完整则直接总结"，不会重复动作）；尾部 assistant 纯文本且有正常日志 → `nothing_to_resume`。
- route 的 resume 分支把 `listRunLogs` 结果传入。
测试 `tests/planAgent/resume.test.ts` 补两例。

## F3 租约缩短（`route.ts` 的 `busyTtlMs`）
硬杀后要等租约过期前端才能续跑。`busyTtlMs` 若 ≥ 5 分钟，改为 3 分钟，并在 loop 每次模型调用前 `touchAgentRun`（若 repo 已有续租方法则调用；没有就新增 `renewAgentRun(planId, token, ttlMs)`，条件更新 token 匹配才续）。这样活着的 run 不会被误判过期，死掉的 run 3 分钟内释放。测试：内存 repo 续租一例。

完成标准：`npx vitest run tests/planAgent tests/tripPlan` 全绿；`npx tsc --noEmit` 无错；`typecheck:tests` 无新增；line-budget 通过；简短中文汇报。
