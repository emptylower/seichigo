# 修复：协议守卫扣下响应时遗留孤儿 tool_calls → DeepSeek 400

现象（2026-09-02 预览 3ef96495 实测）：新建计划第一轮即报
`400 An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'`，重试同样失败；库里该计划只有 human 消息、没有 assistant 消息，运行日志两条、工具调用 0。

根因：`lib/planAgent/loop.ts` 的 ask_user 协议守卫（`looksLikeUnansweredUserQuestion` 分支）在扣下一条**同时带 content 与 tool_calls** 的响应时，把 `assistantParam`（含 tool_calls）原样 `messages.push` 后 `continue`，工具未执行、也没有任何 tool 回执，于是下一次模型请求的消息序列非法。该分支早已存在；M4 的阶段上下文让模型更常"先解释再调工具"，因而稳定触发。

修复（`lib/planAgent/loop.ts`，只改这一处逻辑）：
1. 守卫扣下响应时，压进内存的副本改为 `{ role: 'assistant', content: response.content }`——**不带 tool_calls**（工具未执行，历史里就不该有调用记录）。第二次仍违规时同样只压不带 tool_calls 的副本再 `break`。
2. 通用防线：新增内存消息数组的最终校验 `assertNoOrphanToolCalls(messages)`（放 `lib/planAgent/protocolGuard.ts` 或新文件 `lib/planAgent/messageIntegrity.ts`）：在每次 `deps.createMessage` 之前遍历 messages，凡 assistant 带 tool_calls 而其后紧随的 tool 消息未覆盖全部 id 的，为缺失的 id 补 `{ role: 'tool', tool_call_id, content: '{"error":"该工具调用未被执行（响应被协议守卫扣下或本轮中断）"}' }`。这样任何未来路径（信号中止、栅栏错误等）都不会再产出非法序列。
3. 测试 `tests/planAgent/loop.test.ts` / `tests/planAgent/protocolGuard.test.ts`：
   - mock createMessage 第一次返回 `{ content: '你想巡礼哪些作品？', tool_calls: [search_anime] }`，第二次返回正常工具调用 → 第二次请求的 messages 中不存在"assistant 带 tool_calls 且后无 tool 回执"的情况，且第一次的 tool_calls 不在其中；
   - 直接对 `assertNoOrphanToolCalls` 的正/反例；
   - 既有协议守卫用例不回归。

约束：不要 git commit；不碰 app/**、tests/plan/**；`npx vitest run tests/planAgent` 全绿，`npx tsc --noEmit` 无错，`node scripts/check-line-budget.mjs` 通过（loop.ts 若接近上限，把校验函数放新文件）。简短中文汇报。
