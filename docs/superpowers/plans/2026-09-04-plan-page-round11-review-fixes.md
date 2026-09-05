# 第十一轮审查修复（2026-09-04）

背景：第十一轮 A1–A3、A2 补充、B1–B3 已实现并全绿（367 文件 / 2774 用例），独立审查要求修改。工作方式同前：每条先补失败测试再改；**不要 git commit**；**不跑迁移**；line-budget 必须通过。
- A（后端，glm-5.3）只碰 `lib/planAgent/**`、`lib/llm/**`、`lib/tripPlan/**`、`app/api/me/plans/[id]/agent/route.ts`、`tests/planAgent/**`、`tests/llm/**`、`tests/tripPlan/**`。
- B（前端，Claude Opus）只碰 `app/(authed)/plan/[id]/**`、`components/route/**`、`tests/plan/**`、`tests/route/**`。
两边并行、文件不相交。

## A. 后端

### H1 停止不能被"租约过期"闸门挡住（`route.ts`）
`{stop:true}` 分支去掉 `isAgentBusy` 预检，直接 `const stopped = await repo.stopAgentRun(id)` 并返回 `{ ok: true, stopped }`（repo 原语在无 token 时返回 false）。测试 `routeStop.test.ts` 补「token 在、`agentBusyUntil` 已过期 → `stopped:true` 且 token 被清」。

### H2 停止标记不能被并发 GET 清掉；停止要立刻留下持久证据（`repo*.ts`、`planById.ts`、`loop.ts`）
1. `stopAgentRun(planId)` 在清 token 的同时**写一条运行日志** `{ stage: 'stopped', turnIndex: (最后一条日志 turnIndex ?? 0) + 1, runToken: 被清的 token, durationMs: 0 }`（这是 `inferInterrupted`/`canResume` 真正读的东西，持久且不会被 GET 回收）。loop 收尾时若发现同 token 的 `stopped` 日志已存在则不再重复写（或以 `runToken` 去重）。
2. `planById.ts` 的 `agentBusy=false` 顺手清实况行：`row.statusText === RUN_STOP_MARKER` 且 `updatedAt` 在 5 分钟内 → **不清**；否则照旧。
3. loop：判定"用户停止"改为「`isUserStoppedAbort(err)` **或** `RunFencedError` 且（实况行标记存在 **或** 存在同 token 的 `stopped` 日志）」，不再只依赖实况行。
测试：`planById.live.test.ts` 补「标记行在 GET 时不被清」；`loop.stop.test.ts` 补「标记行被清但 stopped 日志存在 → 仍发 stopped/done 且不重复写日志」；repoMemory/repoPrisma 的 `stopAgentRun` 各补一条断言日志写入。

### M1 env 路径 abort 要产生 `user_stopped`（`lib/planAgent/api.ts`）
`attemptStreamOnce` 在 `for await` 结束后、`if (!sawAnyChunk) throw` 之前：`if (signal?.aborted) throw userStoppedAbort()`；`createChatCompletion` 的重试循环在 `signal?.aborted` 时立即抛出，不重试。测试 `api.test.ts` 补两条。

### M2 删除 `additionalProperties`（`toolSchemas.ts`）
`legs.items` 去掉 `additionalProperties: true`（Gemini Schema 不含该关键字；主会话已用真实端点确认删除后仍 200）。`GEMINI_UNSUPPORTED_KEYWORDS` 补 `additionalProperties`、`examples`、`$ref`。

### M3 守卫只在 schema 位置查关键字（`toolSchemas.ts`）
`walk` 区分位置：进入 `properties` 时其**键名**不检查、值按 schema 递归；`items`/`anyOf`/`oneOf`/`allOf` 的值按 schema 递归；其它键才查黑名单。测试补「`properties` 里有名为 `const` 的字段 → 不报错」「schema 位置出现 `additionalProperties` → 报错」。

### M4 停止收尾把 clear 纳入 2 秒预算（`runLive.ts`）
`finish({flush:false, clear:true})` 返回排入 clear 的 `chain`（而不是立刻 return），loop 的 `Promise.race` 才有机会等到它。测试补一条。

### L3 不把 `env` 露给用户（`api.ts`）
env 回退路径的 `model_info.providerName` 用 `'默认模型'`。

### L5 常量归属（`repo.ts`）
`RUN_STOP_MARKER` 移到 `lib/tripPlan/repo.ts` 导出，`lib/planAgent/stop.ts` 从那里 re-export，仓储层不再 import agent 层。

### L7 看守间隔（`stop.ts`、`loop.ts`）
默认间隔 2000 → 3000ms（测试相应改）。

完成标准：`npx vitest run tests/planAgent tests/llm tests/tripPlan` 全绿；`npx tsc --noEmit` 无错；line-budget 通过；简短中文汇报。

## B. 前端

### H3 关闭点位卡后同一 marker 要能再次打开（`RoutePreviewMap.tsx`、`DayMap.tsx`、`routePreviewPopup.ts`）
`openPopupFor` 创建 Popup 时订阅 `popup.on('close', …)`：若 `popupLifecycle.currentPointId() === point.id` 则 `popupLifecycle.close()` 并通知 `onPopupClosed?.(point.id)`（新增可选 prop）。DayMap 的关闭按钮改为调用 `RoutePreviewMap` 暴露的关闭路径（通过 `onPopupClosed` 回调清空 `popupHost`），不再模拟点击 maplibre 的关闭按钮。测试：`tests/route/routePreviewPopup.test.ts` 补「close 事件后 currentPointId 为 null，再 open 同一 id 会重新创建」；`dayCards.test.tsx` 补「关闭卡片后再次触发 renderPopup(id) 能拿到新容器」。

### M5 「已停止」要留在历史思维链里（`ui.tsx`/`chatState.ts`/`ThinkingChain.tsx`）
收到 `stopped` 时把当前 turn 以 `statusPhrase: '已停止'` **定格**进历史（走现有 `freezeTurn` 路径，挂到最后一条 assistant 或独立一条），随后的 `done` 不再清掉它；ThinkingChain 定格态显示「已停止」标签。测试 `agent-stop.test.tsx` 补一条。

### L1 / L2 popup 容器生命周期（`DayMap.tsx`）
- L1：DOM 副作用（模拟点击）移出 `setPopupHost` 的 updater；H3 落地后应已不需要模拟点击。
- L2：popup 被 maplibre 自行关闭（原生按钮、marker 重建、切天）时通过 H3 的 `onPopupClosed` 清空 `popupHost`；inline 态与展开态各自持有独立的 `popupHost`（把 popup 宿主 state 下沉到各自的 `RoutePreviewMap` 包装层，或按 `mapKey` 区分）。测试补「切天后 popupHost 清空、卡片卸载」。

### L4 图片阶梯去重（`DayPointCard.tsx`）
`image === pointPhotoSrc` 时不传 `fallbackSrc`。

完成标准：`npx vitest run tests/plan tests/route` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报。

## A4 补充：发给模型的历史必须清洗非法工具参数（主会话实测 2026-09-04）

实测：官方 Gemini（`generativelanguage.googleapis.com/v1beta/openai`）接管时，管理员东京计划的任何新回合都 400 `INVALID_ARGUMENT`（无细节）。二分历史定位到第 89/91/93 条 assistant 消息：它们的 `tool_calls[].function.arguments` 是 DeepSeek 时期被截断的**非法 JSON**（当时工具层已回复"参数不是合法 JSON"）。Gemini 的兼容层会把 arguments 解析成结构化 `functionCall.args`，解析失败即整个请求拒绝；DeepSeek/freecode 原样透传所以不报错。把这 3 条的 arguments 换成 `{}` 后，完整 178 条历史 + 全部工具 → 200。

实现（新文件 `lib/planAgent/historySanitize.ts`，`lib/planAgent/loop.ts` 只加 1 行调用）：
- `sanitizeHistoryForModel(messages)`：对 assistant 消息的每个 `tool_calls[i].function.arguments`，`JSON.parse` 失败 → 替换为 `'{"_invalid_arguments":true}'`（保留 id/name，让后续 tool 回复仍能配对）；非法 JSON 的原文不再发给模型（工具层的错误回复已经说明情况）。同时剥掉消息上模型协议不认识的额外字段（`answerTo`、`answerValue` 等，只保留 `role/content/tool_calls/tool_call_id/name/reasoning_content`）。不改数据库里的消息。
- 在 loop 组装每次模型请求的 `messages` 时调用（system/状态前缀之后、发送之前），provider 路径与 env 路径共用。
- 测试 `tests/planAgent/historySanitize.test.ts`：非法 JSON → 替换、合法 JSON 原样、tool 回复配对不变、额外字段被剥、`tests/planAgent/loop.test.ts` 补一条「历史含非法参数时发给 createMessage 的 messages 已清洗」。
