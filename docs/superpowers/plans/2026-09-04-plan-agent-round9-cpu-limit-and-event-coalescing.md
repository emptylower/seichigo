# 第九轮：长 run 被平台硬终止——CPU 上限与事件合并（2026-09-04）

工作方式同前：先补失败测试再改；**不要 git commit**；**不跑迁移**；只碰 `wrangler.jsonc`、`lib/planAgent/loop.ts`、`lib/planAgent/runLive.ts`、新文件 `lib/planAgent/eventCoalescer.ts`、`lib/planAgent/resume.ts`、`lib/tripPlan/repo*.ts`（仅 runLive 追加语义）、`tests/planAgent/**`、`tests/tripPlan/**`。line-budget 必须通过（loop.ts 已接近上限，新逻辑放新文件）。

## 实证（用户计划 cmtlprik1…，11 天巡礼，2026-09-03 16:04–16:31 CST）
- 运行日志只到第 3 回合（works 阶段，都在 1 分钟内结束并正常落日志）。
- 第 4 回合（points 阶段）从 16:08 开始，消息一直落到 16:19:41（大量 estimate_travel / find_restaurants 工具结果），之后戛然而止：**没有 assistant 收尾、没有 daymap、没有任何运行日志**——`finally` 根本没执行，是隔离体被平台直接杀掉，不是客户端断开（客户端断开会走 abort 路径并写日志）。
- 用户刷新后又起一个 run（16:24 开始，16:31 有一次保存），同样没有运行日志——第二次被杀。
- 两次都是**跑了 7–12 分钟的长 run**；短 run 从未出过问题。
- `wrangler.jsonc` 没有 `limits.cpu_ms`，Worker 用默认 **30 秒 CPU 上限**（付费计划可开到 300 秒）。一个 10 分钟的 run 里：每个 token 一条 SSE 事件（一回合 3,000+ 条 `reasoning`）、每条都 `JSON.stringify` + `TextEncoder`、实况表每次 flush 全量快照 20 KB 字符串、Prisma 序列化 190 KB 的计划 JSON、补齐脚本…累计 CPU 突破 30 秒完全合理。Cloudflare 超 CPU 时直接终止隔离体，正好符合"没有任何收尾"的形态。
- Cloudflare 观测 API 此刻不可用，无法拉到 `exceededCpu` 计数；本轮按上述证据修，验收时用长 run 复测。

## A1 放开 CPU 上限（`wrangler.jsonc`）
```jsonc
"limits": { "cpu_ms": 300000 }
```
放在 `vars` 之前。这是付费计划的合法上限（5 分钟 CPU），wall-clock 本就不限。

## A2 SSE 事件合并（新文件 `lib/planAgent/eventCoalescer.ts`，`loop.ts` 接线）
- `createEventCoalescer(onEvent, { flushIntervalMs = 120, flushChars = 160, now?, setTimer? })`：返回 `{ emit, flush, dispose }`。`reasoning` 增量累积到缓冲，满足"距上次 flush ≥ 120 ms"或"缓冲 ≥ 160 字符"时合并成**一条** `{ type: 'reasoning', delta }` 发出；任何其他类型事件到来时先 flush 缓冲再发该事件（保证顺序）；`text` 事件同样合并。`done`/`error` 前强制 flush。
- `loop.ts`：`emit` 改为经 coalescer（实况 writer 与 SSE 都从 coalescer 之后接收）；run 结束 `dispose()`。
- 测试 `tests/planAgent/eventCoalescer.test.ts`：100 个 3 字符 reasoning 增量在假时钟 0–50 ms 内到达 → 输出 ≤ 2 条且拼接内容完整；reasoning 后紧跟 tool_call → 先 reasoning 再 tool_call；done 前缓冲被刷出。`tests/planAgent/loop.test.ts` 补一条「事件总数远小于增量数」。

## A3 实况写入改为追加语义（`runLive.ts`、`lib/tripPlan/repo*.ts`）
- writer 每次 flush 只发送自上次 flush 以来的增量 `reasoningAppend`（首次或换 run 用 `reasoningReplace`），不再整段快照；repo 的 `upsertRunLive` 已支持 append（保留 20,000 字符截头保尾）。
- 测试：连续 3 次 flush → 3 次 upsert 的 append 长度之和等于总长度；截尾语义不变。

## A4 诊断与提示（`loop.ts`、`resume.ts`）
- run 结束（任何路径）`console.log('[agent] run summary', { planId, turnIndex, durationMs, events, reasoningChars, toolCalls })`；被硬杀时这条不会出现，可作为日志侧证据。
- `RESUME_NOTE` 增加一句「若上次中断没有任何收尾，说明是平台终止，请优先把已完成的工具结果落库（save_plan_days），再继续未完成部分」。

完成标准：`npx vitest run tests/planAgent tests/tripPlan` 全绿；`npx tsc --noEmit` 无错；`typecheck:tests` 无新增；line-budget 通过；简短中文汇报。
