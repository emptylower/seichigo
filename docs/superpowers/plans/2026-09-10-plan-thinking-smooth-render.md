# 计划页思维链渲染平滑化（前端专项）

日期：2026-09-10 ／ worktree：`/Users/mac/Desktop/seichigo-wt-plan-fe` ／ 分支：`feat/plan-thinking-smooth-render`

## 1. 背景与目标

`/plan` 页的 AI 规划 run 已从「浏览器直连 SSE」改成「Cloudflare Queue 里跑 run + 浏览器另开一条只读观察流看进度」。观察流服务端每 500 ms 读一次数据库快照，有变化才推一帧**全量** `live` 事件（带完整 reasoning 字符串）。

前端收到就整串替换并立刻渲染，于是用户看到的是：**500 ms 完全静止 → 一次性蹦出约 200 字 → 再静止 500 ms**。真实用户反馈是「卡卡的」「一会加载一堆」「不知道是不是在正常输出」。

本任务的目标：**把渲染节奏与网络到达节奏解耦**。数据仍然每 500 ms 一批到达，但屏幕上要像连续打字一样匀速流出。

这是**纯前端**任务，不改任何 API 契约、不改服务端。（服务端的首帧延迟优化由另一个 agent 在另一个 worktree 并行进行，两边文件不重叠。）

## 2. 边界（重要）

同一个仓库此刻有另外两个会话在别的 worktree 干活，**越界修改会造成合并冲突**。

允许改：

- `app/(authed)/plan/[id]/**`
- 为上述代码新增/修改的测试：`tests/plan/**`

**绝对不要改**：`lib/**`、`app/api/**`、`prisma/**`、`features/map/**`、`app/(authed)/map/**`、`wrangler.jsonc`、`package.json`、`line-budget.allowlist.json`。

如果你判断非改 `lib/planAgent/**` 不可，**停下来，在最终报告里说明原因**，不要动它。

不要 `git commit`、不要 `git push`、不要切分支、不要 `git merge`。

## 3. 现状代码地图

- `app/(authed)/plan/[id]/ui.tsx`（494 行）— 页面状态持有者。`activeThinking` state 在第 66 行；`streamAgentRequest` 从第 197 行起。
- `app/(authed)/plan/[id]/components/ThinkingChain.tsx`（253 行）— 思维链渲染。
  - `ThinkingTurn` 类型（第 33 行）：`{ reasoning, statusPhrase, toolCalls, startedAt, endedAt? }`
  - `applyThinkingEvent`（第 68 行）：**增量路径**，`reasoning: turn.reasoning + event.delta`
  - `ThinkingTimeline`（第 122 行）：展开态渲染，reasoning 直接塞进一个 div
  - 自动滚动 effect（第 126–133 行）：依赖 `thinking.reasoning`，每次变化就 `scrollTop = scrollHeight`
  - `ToolCallRow`（第 108 行）：单条工具调用行
- `app/(authed)/plan/[id]/lib/chatState.ts`
  - `liveToThinkingTurn`（第 106 行）：**快照路径**，整串替换 reasoning ← 卡顿的直接来源
- `app/(authed)/plan/[id]/hooks/useAgentWatchStream.ts`（217 行）— 观察流客户端。
  - `handleEvent` 的 `'live'` 分支（第 86 行）调 `liveToThinkingTurn`
  - 退避重连数组 `WATCH_RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000]`（第 16 行）
  - `failuresRef` 是纯内部状态，**对 UI 完全不可见**
- `app/(authed)/plan/[id]/components/ChatPane.tsx:193` — 渲染进行中的 `ThinkingChain`（`followScroll` 在第 205 行传入）
- `app/(authed)/plan/[id]/lib/planText.ts` — 前端三语文案字典（zh/en/ja）

注意有**两条**喂数据的路径：

1. 内联 SSE（真增量事件）→ `applyThinkingEvent`
2. 观察流（全量快照）→ `liveToThinkingTurn`

路径 1 在队列不可用时（预览环境等）仍然会走到，**必须继续正常工作**，不能只照顾路径 2。

## 4. 要做的四件事

### A. 打字机播放缓冲（主要工作量）

新建 `app/(authed)/plan/[id]/hooks/useSmoothText.ts`：

```ts
export function useSmoothText(target: string, opts?: { done?: boolean }): string
```

行为要求：

1. 内部维护 `renderedLen`（state）与 `targetRef`（ref），返回 `target.slice(0, renderedLen)`。
2. 用 `requestAnimationFrame` 循环推进 `renderedLen` 逼近 `target.length`。**不要用 `setInterval`。**
3. **速率自适应**：记录每次 `target` 变长的时刻，用 EMA（`alpha = 0.3`）估计到达间隔 `arrivalMs`，初值 500，钳在 `[250, 900]`。每帧目标速率 `charsPerMs = remaining / arrivalMs`，含义是「用大约一个到达周期的时间把当前缓冲放完」——既不会提前放空卡住干等下一帧，也不会越积越多、越落越远。
4. 每帧步进量钳在 `[1, 12]` 字符。例外：`remaining > 600` 时（异常积压，例如刷新后一次性拿到整段历史）把上限放宽到 40，别让用户干等。
5. **前缀校验**：服务端的 reasoning 有 20000 字符「截头保尾」（超长 run 会把开头切掉），所以新 target 可能不以已渲染前缀开头。检测到 `!target.startsWith(rendered)` 时直接 `renderedLen = target.length`（snap 到末尾）并重置 EMA，**不要试图 diff**。
6. `opts.done === true` 时立刻 flush 到 `target.length` 并停掉 rAF。run 结束之后绝不允许屏幕上还有字在慢慢爬。
7. `window.matchMedia('(prefers-reduced-motion: reduce)').matches` 为真时全程 snap（直接返回 `target`）。
8. 组件卸载时 `cancelAnimationFrame`。

接入 `ThinkingTimeline` 渲染 reasoning：`const shown = useSmoothText(thinking.reasoning, { done: !active })`。`ThinkingTimeline` 目前拿不到 `active`，需要从 `ThinkingChain` 传下去。

**历史回看（`active === false`）必须直接全量显示**——用户展开一个早就结束的回合，不该还要看打字机重放。

### B. 统一渲染管线

目标：`ThinkingChain` 不再关心数据是增量来的还是快照来的。

- 两条路径最终都把结果写进 `thinking.reasoning`，A 做完后它们天然共用同一个平滑层。请确认这一点在代码里成立，并在报告里说明。
- **工具行同样要平滑**：现在同一帧到达的多条工具行会一次性糊上去。加一个插入队列——同一批新增的工具行按约 80 ms 间隔逐条出现。实现在 `ThinkingTimeline` 内部即可（用 state 记「已显示到第几条」，用 rAF 或 timeout 推进）。切换到历史回看时直接全部显示，不做错开。
- `liveToThinkingTurn` 的 `startedAt: prev?.startedAt ?? Date.now()` 保持现状不变。

### C. 诚实的存活信号

用户分不清「模型正在想」和「画面死了」，要给可验证的证据：

1. **活动计时器**：active 状态的 pill 上加「· 已用 12s」，本地每秒 tick（基于 `thinking.startedAt`）。这是最便宜的存活证明，而且**不依赖网络**——网断了它照样在走，正好把「模型慢」和「画面冻结」区分开。文案走 i18n（`app/(authed)/plan/[id]/lib/planText.ts`，zh/en/ja 三语都要加）。
2. **把重连状态暴露出来**：`useAgentWatchStream` 的退避重连（500/1000/2000/5000 ms）目前对 UI 完全不可见，断一次就是最长 5 秒画面冻结、用户毫不知情。给该 hook 的 input 加一个可选回调 `onConnectionState?: (state: 'live' | 'degraded') => void`：`failuresRef.current >= 2` 时报 `degraded`，成功读到帧时报 `live`。`ui.tsx` 存成 state 传给 `ThinkingChain`；`degraded` 时 pill 文案换成「连接不稳，重试中」（同样三语），并把 spinner 换个视觉（例如降低透明度）以示区分。**宁可告诉用户网络在抖，也别让他盯着一个假装在转的 spinner。**
3. **工具行 running 计时**：`ToolCallRow` 在 `status === 'running'` 时本地显示已用时长（服务端只在结束时才给 `durationMs`）。`save_plan_days` 这类工具能跑 20 秒以上，现在这期间画面完全静止。running 行需要一个本地起算时间——用一个 `Map<id, number>` 的 ref 记下每条工具行首次出现的时刻即可，不要改 `ToolCallEntry` 的服务端契约字段含义。

⚠️ **不要编造进度**：不许加百分比进度条，不许显示没有真实发生的步骤。假进度一旦被用户识破，所有进度指示就都不可信了，那比现在更糟。

### D. 消掉布局跳动

1. `ThinkingChain.tsx:141` 现在是 `thinking.reasoning.trim() ? <div>…</div> : null`——框子是凭空长出来的，第一帧必然造成一次布局跳动。改成常驻，给一个约两行高的 `min-h` 占位。
2. 现在有**两层嵌套滚动容器**：第 137 行的 `max-h-[50dvh] overflow-y-auto` 外层，加第 143 行的 `max-h-40 overflow-y-auto` 内层，而第 126–133 行的 effect **两个都写 `scrollTop`**，互相打架。收敛成**一个**滚动容器。
3. 自动滚动改成：
   - 只在用户**已经贴近底部**时才跟随（判据：`scrollHeight - scrollTop - clientHeight < 40`）。用户手动往上滚看历史时不要把他拽回底部。
   - 跟随动作和打字机走**同一个 rAF tick**，让文字和滚动同步移动，而不是「文字先蹦一段、滚动条再追一下」。

## 5. 验收

在 worktree 根目录跑（`node_modules` 已经装好了）：

```
npm run typecheck
npm run lint
npm test
```

三个都必须过。

`npm test` 的第一步是行数预算检查：**每个源文件不得超过 750 行**。超了就把逻辑拆到新文件，**不要**往 `line-budget.allowlist.json` 加条目（那个文件也不在你的可改范围内）。

新增/修改单测放 `tests/plan/**`。至少覆盖：

- `useSmoothText`：注入假时钟与假 rAF，验证匀速推进、前缀不匹配时 snap 到末尾、`done` 时立即 flush、reduced-motion 时直通。
- 工具行错开插入的顺序正确且最终状态与输入一致。

**不要**跑 `npm run dev` 或 `npm run build`（会和别的会话抢端口和资源），**不要**跑 playwright。

## 6. 报告

完成后用简短中文汇报：

- 改了哪些文件
- A / B / C / D 各自最终怎么实现的
- 三条验收命令的**实际输出结果**（不要只说"通过"）
- 有没有你认为需要人工确认的取舍或你没做的部分

再次强调：不要 `git commit`。
