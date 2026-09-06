# 计量层评审修复（Part A 后续）

对提交 `feat(billing): 计量层` 的只读评审结论：REQUEST CHANGES。以下按严重级别逐条修复，每条都要有测试（先写失败测试再改）。不要 `git commit`。不要碰 `app/(authed)/**`、`app/(site)/**`、`components/**`、`hooks/**`、`prisma/**`。完成后跑 `npm run typecheck` 与 `npx vitest run tests/llm tests/planAgent tests/billing tests/googlePlaces`。

## F1（blocker）`stream_options.include_usage` 遇到不认该字段的端点会 400 且不重试

文件：`lib/llm/openaiClient.ts` 的 `streamChat`；`lib/planAgent/api.ts` 的 `attemptStreamOnce`。

修法：两处都做“带 `stream_options` 先试；若收到 HTTP 400 且响应体文本里包含 `stream_options`（大小写不敏感），去掉该字段立即重发一次”。openaiClient 内用模块级 `Set<string>` 记住已判定不支持的 `endpointUrl`，后续请求直接不带；api.ts 的 env 路径用一个模块级 boolean。其它 400 原样抛出（不做无差别重试）。

测试（`tests/llm/openaiClient.test.ts` 追加）：第一次 fetch 返回 `400 {"error":{"message":"Unknown parameter: stream_options"}}`，第二次返回正常 SSE；断言两次调用、第二次请求体没有 `stream_options`、消息内容正确；再发一次请求，断言只调一次 fetch 且不带 `stream_options`。

## F2（should-fix）用户停止的 run 不落成本

文件：`lib/planAgent/loop.ts` 收尾处 `skipRunLog = stopped && (await stoppedLogExists())`。

修法：当已存在 stopped 日志时，不再跳过，而是调用 repo 新方法 `updateRunLogModelUsage(planId, runToken, modelUsage)` 把成本写进那条已有的 stopped 日志。`lib/tripPlan/repo.ts` 接口加该方法；`repoPrisma.ts` 用 `updateMany({ where: { planId, runToken, stage: 'stopped' }, data: { modelUsage } })`；`repoMemory.ts` 同语义。

测试（`tests/planAgent/loop.stop.test.ts` 追加）：模拟停止后 run log 只有一条 stopped 记录，且其 `modelUsage.tokens` 非零。

## F3（should-fix）续跑补齐的 Google 调用不计量

文件：`lib/planAgent/enrichContinuation.ts`（自建 `createEnrichBudget()` 处与 `modelUsage: null` 处）。

修法：`modelUsage: summarizeRunCost({ usageByModel: new Map(), calls: budget.calls ?? { ...EMPTY_GOOGLE_CALLS }, modelCalls: 0, usageMissing: false, withTitle: false })`。

测试（`tests/planAgent/enrichContinuation.test.ts` 追加）：续跑里发生一次 directions 外呼后，`enrich` 日志的 `modelUsage.calls.directions` 为 1、`costMicros.google` 等于 Directions 单价。

## F4（should-fix）模型调用抛错时不计次也不标 usageMissing

文件：`lib/planAgent/loop.ts` 模型调用处。

修法：`modelCalls += 1` 挪到 `try {` 内、`deps.createMessage(...)` 之前；在该 try 的 `catch`/`finally` 路径里若未拿到 response 则 `usageMissing = true`（用一个 `let gotResponse = false` 标记）。

测试（`tests/planAgent/loop.usage.test.ts` 追加）：createMessage 第一次抛错、循环收尾后 run log `modelUsage.modelCalls` 为 1、`usageMissing` 为 true。

## F5（should-fix）`MODEL_PRICES[model]` 走原型链

文件：`lib/billing/cost.ts` 的 `costOfModelUsage`。

修法：`const price = Object.prototype.hasOwnProperty.call(MODEL_PRICES, model) ? MODEL_PRICES[model] : MODEL_PRICES.default`。

测试（`tests/billing/cost.test.ts` 追加）：`costOfModelUsage('constructor', usage)` 与 `costOfModelUsage('toString', usage)` 等于 default 价格计算结果且不是 NaN。

## F6（should-fix）未知模型静默按 default 计价无标记

文件：`lib/billing/cost.ts` 的 `RunCostSummary` 与 `summarizeRunCost`。

修法：`RunCostSummary` 加 `priceFallbackModels: string[]`（用了 default 价格的模型名列表，空数组表示全部命中价格表）。价格表本身不新增条目（数值需人工核对，留给上线前的价格核对步骤）。

测试（`tests/billing/cost.test.ts` 追加）：含未知模型时 `priceFallbackModels` 为 `['some-unknown-model']`，全部已知时为 `[]`。

## F7（should-fix）照片镜像缓存命中也被计成 placeDetails

文件：`lib/planAgent/serverDeps.ts` 的 `fetchPlacePhotos` 包装（`input.onGoogleCall?.()` 在 `mirrorFetchPlacePhotos` 之前无条件触发）；`lib/googlePlaces/photoMirror.ts` 的 `fetchPlacePhotos`。

修法：给 `photoMirror.fetchPlacePhotos` 的入参加可选 `onGoogleCall?: () => void`，只在真实向 Google 发 Place Details 请求前调用；`serverDeps.ts` 改为把 `input.onGoogleCall` 透传进去，删除包装层的无条件触发。

测试（`tests/googlePlaces/` 下已有 photoMirror 测试文件里追加，若没有则新建 `tests/googlePlaces/photoMirrorCall.test.ts`）：镜像命中时 `onGoogleCall` 不被调用；未命中真实外呼时调用一次。

## F8（should-fix）只含 usage 帧的空流不再触发传输层重试

文件：`lib/llm/openaiClient.ts`（`payloadCount === 0` 判据）；`lib/planAgent/api.ts`（`sawAnyChunk`）。

修法：判据改为“见过带 `choices[0]` 的 chunk”。openaiClient 里新增 `let sawChoice = false`，在 `const choice = chunk.choices?.[0]; if (!choice) return` 之后置 true，空流判定改为 `if (!sawChoice) throw new LlmEmptyStreamError()`；api.ts 同理把 `sawAnyChunk = true` 挪到取得 choice 之后。

测试（`tests/llm/openaiClient.test.ts` 与 `tests/planAgent/api.test.ts` 各追加）：流里只有一个 `choices: []` 且带 usage 的帧 → 抛空流错误（api.ts 路径为触发重试）。

## nit（顺手改，不强制）

- `lib/planAgent/api.ts` `withModelUsageInRunLog` 的合并顺序改为 `{ ...usage, ...base }`（loop 字段优先）。
- `lib/llm/usage.ts` 的 `num()` 增加 `v >= 0`。
- `lib/billing/cost.ts` `models[name] = { ...usage }` 存副本。
