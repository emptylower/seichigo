# 阶段三：观察流与 POST 并行开（客户端半边）

worktree：`/Users/mac/Desktop/seichigo-wt-plan-fe` ／ 分支：`feat/plan-thinking-smooth-render`

> 服务端半边已经在另一个分支（`feat/plan-agent-first-frame`）做完并验收：观察流已支持 `?await=1` 宽限窗口。本批做客户端半边。阶段一、二已完成，不要重做。

## 效率要求

**只读这 2 个文件**，不要读别的，不要调用任何技能，不要 grep 全仓库：

1. `app/(authed)/plan/[id]/hooks/useAgentWatchStream.ts`（约 238 行）
2. `app/(authed)/plan/[id]/ui.tsx` 的 `streamAgentRequest` 函数（约第 197–260 行）**只看这个函数**，不要通读全文件

## 背景

现在客户端是等 `POST /agent` 返回 202 **之后**才开观察流。POST 内部有 6–9 次串行数据库往返，这段时间白白串进了首字延迟。

服务端已经支持在 run 还没启动时等待，所以客户端可以在**发 POST 的同时**就把观察流开出去。

### 服务端已实现的契约（不要改服务端，那在另一个分支）

`GET /api/me/plans/:id/agent/stream?after=<seq>&await=1`

- `await=1` 且首个快照 `agentBusy=false`：进入最长 **10 秒**宽限等待，每 200 ms 重读；期间**只发 SSE 注释心跳**（`: ping`，客户端 `sseFrames` 会安全忽略），不推 `chat`/`live`。
- 宽限期内 `agentBusy` 变 true：正式开始，按 `after=0` 规则把当前 `live` + `chat` 作首帧推出。
- 宽限 10 秒超时仍未 busy：发 **`done{ reason: 'not_started' }`** 并关闭。这是一个**新的 reason 值**。
- 不带 `await=1`：行为与现在完全一致。

## 边界

允许改：`app/(authed)/plan/[id]/**`、`tests/plan/**`。

**绝不要改**：`lib/**`、`app/api/**`、`features/map/**`、`app/(authed)/map/**`、`prisma/**`、`package.json`、`line-budget.allowlist.json`。

不要 `git commit`、不要 `git push`、不要切分支。

## 任务

### 1. `useAgentWatchStream` 支持 awaitStart 模式

`open()` 改成接受可选参数：`open(opts?: { awaitStart?: boolean })`。

`awaitStart` 为真时，连接 URL 追加 `&await=1`。

⚠️ **这里有个必须处理的陷阱**：`await=1` **只能在本次 open 的第一次连接上发**。

原因：观察流有断线退避重连，也有 15 分钟的 `rotate` 连接轮换。如果 run 已经结束、客户端又带着 `await=1` 重连，服务端会白等 10 秒才发 `done`，而不是立刻收幕——收尾被硬生生拖慢 10 秒。

**做法**：用一个 ref 记 `awaitPending`。`open({awaitStart:true})` 时置 true；一旦收到任何 `seq > 0` 的帧（说明 run 已经确实启动、服务端已过宽限），或收到 `done`，就把它置 false。之后的重连都不再带 `await=1`。请为这一条单独写测试。

### 2. `done{reason:'not_started'}` 的处理

现在 `handleEvent` 的 `done` 分支是 `if ((event.reason ?? 'finished') === 'rotate')` 单独处理，其余一律按 finished 收尾。

`not_started` **不能**按 finished 收尾——那意味着宽限 10 秒内 run 没启动（队列消费者没接上/投递失败），此时 run 可能仍会晚一点启动。

**做法**：收到 `not_started` 时不清 busy、不收尾，改为把收尾交给 `runSync.enterRunRecovery('reconnecting')`（既有的 3 秒恢复轮询兜底路径），并 `close()` 掉观察流。轮询会正确地等到 run 结束或确认 idle。

### 3. `ui.tsx` 的 `streamAgentRequest`：与 POST 并行开流

把 `watch.open({ awaitStart: true })` 提到**发 POST 之前**（或与 `fetch` 同时），不要等 202。

然后按 POST 的结果分派：

| POST 结果 | 处理 |
|---|---|
| **202 且 `queued:true`** | 观察流已经在跑，保持；照旧 `runSync.clearInterrupted()`；直接 return |
| **返回 `text/event-stream`**（队列不可用时的内联 SSE 回落，预览环境会走到） | **必须先 `watch.close()`**，再走既有的 SSE 读循环——否则两条路径会同时写同一份状态 |
| **402 budget_exhausted / 409 busy / 其他错误 / `nothing_to_resume`** | **必须 `watch.close()`**，再走各自既有的分支 |
| **fetch 抛错（含用户点停止的 abort）** | **必须 `watch.close()`** |

⚠️ 每一条错误/回落路径都要关掉观察流，一条都不能漏——漏掉的话页面会挂着一条永远等不到 run 的流，直到 10 秒宽限超时。建议用 `try/finally` 或一个统一的 `closeWatchUnlessQueued()` 辅助函数来保证覆盖，不要靠在每个 return 前手写一遍。

## 验收

```
npm run typecheck
npm test
```

两个都要过。（`npm run lint` 本 worktree 没装 eslint，跑了没信号，可跳过。）

在 `tests/plan/` 下新增测试，至少覆盖：

- `awaitStart` 只在第一次连接带 `await=1`；收到 `seq>0` 的帧之后重连不再带。
- `done{reason:'not_started'}` 不清 busy、不按 finished 收尾，而是转入恢复轮询。
- `done{reason:'rotate'}` 与 `done{reason:'finished'}` 的既有行为不变（回归）。

已有断言不要改。行数预算 750，`ui.tsx` 当前约 498 行。

不要跑 `npm run dev` / `npm run build` / playwright。不要 `git commit`。

## 报告

简短中文汇报：改了哪些文件、三项各自怎么实现、两条验收命令的**实际输出**、有没有需要人工确认的取舍。
