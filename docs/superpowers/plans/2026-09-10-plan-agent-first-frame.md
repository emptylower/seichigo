# 计划页 agent 首帧延迟优化（后端专项）

日期：2026-09-10 ／ worktree：`/Users/mac/Desktop/seichigo-wt-plan-be` ／ 分支：`feat/plan-agent-first-frame`

## 1. 背景与目标

`/plan` 页的 AI 规划 run 现在的链路是：

```
浏览器 POST /api/me/plans/:id/agent
  → 落库 human 消息、抢 busy 位、计费预扣 → queue.send → 202
  → Cloudflare Queue → worker/planAgentConsumer.ts
  → WORKER_SELF_REFERENCE.fetch → POST /api/internal/plan-agent/run
  → executePlanAgentRun → runPlanAgent（lib/planAgent/loop.ts）
浏览器另开 GET /api/me/plans/:id/agent/stream 只读观察流看进度
```

用户反馈「首字很慢」。经排查，除了 LLM 本身的 TTFT，链路上有三处**纯属浪费**的延迟，本任务修掉它们。

**这是纯后端任务。** 前端的渲染平滑化由另一个 agent 在另一个 worktree 并行进行，两边文件不重叠。

## 2. 边界（重要）

同一个仓库此刻有另外两个会话在别的 worktree 干活，**越界修改会造成合并冲突**。

允许改：

- `app/api/me/plans/[id]/agent/stream/route.ts`
- `lib/planAgent/loop.ts`
- `lib/planAgent/runLive.ts`
- `lib/planAgent/serverText.ts`（只为新增状态短语文案）
- 相应测试：`tests/planAgent/**`、`tests/plan/**`

**绝对不要改**：`app/(authed)/**`（另一个 agent 正在改 `app/(authed)/plan/[id]/**`）、`features/map/**`、`prisma/**`、`wrangler.jsonc`、`package.json`、`line-budget.allowlist.json`。

不要 `git commit`、不要 `git push`、不要切分支、不要 `git merge`。

## 3. 三项改动

### 任务一：观察流首次连接不要吞掉第一帧（这是修 bug，优先做）

**位置**：`app/api/me/plans/[id]/agent/stream/route.ts:117-127`

**现状**：循环的第一轮只「建立基线」（记下 `lastLiveAt` / `lastChatRevision` / `lastChatSignature` / `lastPlanRevision`），**不推送任何事件**。代码注释给出的理由是「客户端已从 GET 拿到当前 live/chat」。

**问题**：这个理由只对**重连**成立。新回合走的是 `POST → 202 → 客户端立刻开观察流` 这条路，客户端手上根本没有任何 live 快照。第一帧被当成基线丢掉，用户必须等到**下一次**快照发生变化才第一次看到字——白白多等一个 500 ms 轮询周期加一个落库节流周期。如果 run 开头是个耗时较长的工具调用，那就是好几秒的纯黑屏。

**改法**：区分「全新打开」与「重连」。查询参数 `after` 已经存在（`useAgentWatchStream` 重连时回传最后的 `seq`，全新打开时是 `0`）。

- `after === 0`（全新打开）：**不做静默基线**。第一轮快照就把当前的 `live`（如果有）与 `chat` 当作首帧推出去，然后照常进入差异推送循环。
- `after > 0`（重连）：保持现有的静默基线行为不变。

客户端的 `liveToThinkingTurn` / `mergeServerChat` 本来就是幂等的，重复推一帧不会写坏本地状态。

### 任务二：run 一开始就写实况行，让开场那几秒有真实进度可看

**位置**：`lib/planAgent/loop.ts` 的 `runPlanAgent`（第 240 行起）

**现状**：`TripPlanRunLive` 这张实况表要等到**第一条 reasoning delta** 才第一次写入。而在那之前，run 已经串行做了：`listMessages` → `getPlan` → `derivePlanStage` → `updateStage` → 首次模型调用（DeepSeek 的 TTFT 本身就要 1–3 秒）。这段 2–4 秒里实况表是空的，前端只能渲染一个通用的「规划师思考中…」，看起来就像卡死了。

**改法**：在这几个真实存在的启动步骤上各发一条 `status` 事件。

⚠️ **两个必须注意的实现陷阱**：

1. **`runLiveWriter` 和事件合并器目前是在第 332 行附近创建的，晚于 `listMessages` 和 `getPlan`。** 必须把 `runLiveWriter` / `forwardEvent` / 合并器的构造**上移到 `runPlanAgent` 函数体的最前面**（`deps.runToken` 一开始就有，没有依赖问题），否则你新加的启动 status 根本没人接收。

2. **`lib/planAgent/runLive.ts` 的节流条件会把首条 status 吞掉。** 看 `createRunLiveWriter` 的 `onEvent`：flush 条件是 `pendingChars >= flushChars || Date.now() - lastFlushAt >= flushIntervalMs`。而 `lastFlushAt` 在 writer 创建时就被设成了 `Date.now()`，`status` 事件又不贡献 `pendingChars`（它只贡献 `reasoning` 字符数）。结果就是：run 刚开始时 elapsed ≈ 0、pendingChars = 0，**两个条件都不满足，不会 flush**——status 会一直躺在内存缓冲里，直到 2–4 秒后第一条 reasoning delta 到来才被顺带写出去，这条改动就完全失效了。

   修法：在 `onEvent` 里，当 `statusText` 发生变化时（或更简单：首次收到 `status` / `tool_call` 事件时）**强制 `queueFlush()`**，不受时间/字数阈值约束。status 变化频率很低（一个 run 十几次），强制 flush 不会给数据库带来压力。请为这一条单独写一个单测。

**文案**：新短语加进 `lib/planAgent/serverText.ts` 的 `status` 字典，zh / en / ja 三语都要有，与现有 `toolStatusPhrase` 的风格保持一致。建议三条，对应三个**真实发生**的步骤：读取对话历史、核对行程进度、组织思路（最后一条在首次模型调用之前发）。

⚠️ **只发真实发生的步骤**。不要为了填充画面编造不存在的阶段，也不要加百分比进度——假进度一旦被用户识破，所有进度指示就都不可信了。

### 任务三：观察流支持「等待 run 启动」的宽限窗口（服务端半边）

**位置**：同 `app/api/me/plans/[id]/agent/stream/route.ts`

**目的**：现在客户端是等 `POST /agent` 返回 202 **之后**才开观察流，POST 的全部耗时（约 6–9 次串行数据库往返）白白串进了首字延迟。目标形态是客户端在发 POST 的**同时**就把观察流开出去。

本任务只做**服务端这一半**（客户端那一半在另一个 worktree，本次不做，两边合并后再接）。所以这个改动必须**完全向后兼容**：不带新参数时行为与现在逐字一致。

**契约**：`GET /api/me/plans/:id/agent/stream?after=<seq>&await=1`

`await=1` 时：

- 如果第一次读到的快照 `agentBusy === false`，**不要**像现在这样立刻发 `done{reason:'finished'}` 收幕，而是进入**宽限等待**：最长 10 秒，每 200 ms 重读一次快照。
- 宽限期内**只允许发 `ready` 事件和 SSE 心跳注释行**（`: ping\n\n`，每 5 秒一次，防中间层掐流；客户端的 `lib/sseFrames.ts` 只取 `data:` 开头的行，注释行会被安全忽略，已确认）。
- ⚠️ **宽限期内绝对不能推 `chat` 帧。** 此刻 `beginAgentRun` 可能还没把这一轮的 human 消息落库，服务端的 chat 视图会少一条，而客户端已经乐观追加了用户气泡——推过去会被 `mergeServerChat` 整体替换掉，用户的话会从屏幕上消失。同理也不要推 `live`。
- 宽限期内 `agentBusy` 第一次变成 `true`：正式开始，按任务一的规则（`after === 0` 即全新打开）把当前 `live` + `chat` 作为首帧推出，随后进入正常的差异推送循环。
- 宽限 10 秒超时仍未 busy：发 `done{ reason: 'not_started', stopped: false, interrupted: null }` 并关闭。这是一个**新的 reason 值**，现有客户端不会收到它（因为现在没有任何客户端发 `await=1`）。

不带 `await=1` 时：行为与现在完全一致，一个字节都不要变。

## 4. 验收

在 worktree 根目录跑（`node_modules` 已经装好了）：

```
npm run typecheck
npm run lint
npm test
```

三个都必须过。

`npm test` 第一步是行数预算检查：**每个源文件不得超过 750 行**。`lib/planAgent/loop.ts` 目前已经 750 行、`app/api/me/plans/[id]/agent/stream/route.ts` 185 行——loop.ts **已经贴着上限**，你的改动几乎必然会超，所以要把逻辑拆到新文件（例如把启动阶段的 status 发送抽成 `lib/planAgent/startupStatus.ts`）。**不要**往 `line-budget.allowlist.json` 加条目（那个文件也不在你的可改范围内）。

测试放 `tests/planAgent/**`（已有目录，参考其中现成的写法）。至少覆盖：

- 观察流 `after=0` 时首帧推送 live/chat；`after>0` 时保持静默基线。
- `await=1` 且 `agentBusy=false` 时进入宽限等待、期间不推 `chat`/`live`；busy 变 true 后正常开始；超时发 `done{reason:'not_started'}`。
- 不带 `await=1` 时行为不变（回归测试）。
- `runLive` 的 writer 在首次 status 事件时强制 flush（这是任务二最容易做错的地方，必须有测试）。

仓库里有内存版 repo（`lib/tripPlan/repoMemory.ts`）可用于测试，不需要连真实数据库。

**不要**跑 `npm run dev`、`npm run build`、`npm run cf:*`（会和别的会话抢资源，而且 cf 相关命令会碰生产配置）。**不要**跑任何 prisma 迁移命令。**不要**跑 playwright。

## 5. 报告

完成后用简短中文汇报：

- 改了哪些文件、`loop.ts` 的行数怎么解决的
- 三项任务各自最终怎么实现的
- 三条验收命令的**实际输出结果**（不要只说"通过"）
- 有没有你认为需要人工确认的取舍或你没做的部分

再次强调：不要 `git commit`。
