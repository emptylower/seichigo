# 阶段二：工具行错开插入 + 存活信号（前端）

worktree：`/Users/mac/Desktop/seichigo-wt-plan-fe` ／ 分支：`feat/plan-thinking-smooth-render`

> 阶段一（打字机播放缓冲 + 布局稳定）已完成并验收通过，`useSmoothText` hook 已存在。本批是**第二批**，不要重做阶段一的内容，也不要改 `useSmoothText` 的速率逻辑。

## 效率要求（重要）

之前有会话因为一次读太多文件、context 过大而卡死。这次：

- **只读下面列出的 4 个文件**，不要通读其他文件，不要 grep 全仓库。
- **不要调用 `executing-plans` 之类的技能**，直接干活。

### 必读文件

1. `app/(authed)/plan/[id]/components/ThinkingChain.tsx`（约 270 行，主战场）
2. `app/(authed)/plan/[id]/hooks/useAgentWatchStream.ts`（217 行，只看 `failuresRef` / `scheduleReconnect` / `connect` 三处）
3. `app/(authed)/plan/[id]/lib/planText.ts`（三语文案字典，照它的格式加词条）
4. `app/(authed)/plan/[id]/ui.tsx` 的第 60–115 行（只看 state 声明与 `useAgentWatchStream` 的调用处，**不要通读全文件**）

## 背景（一句话）

服务端每 500 ms 推一帧全量快照。阶段一已把 reasoning 文字流平滑掉；本批解决剩下两个「感觉卡」的来源：**工具行一次糊上来**，以及**用户分不清「模型在想」和「画面死了」**。

## 边界

允许改：`app/(authed)/plan/[id]/**`、`tests/plan/**`。

**绝不要改**：`lib/**`、`app/api/**`、`features/map/**`、`app/(authed)/map/**`、`prisma/**`、`wrangler.jsonc`、`package.json`、`line-budget.allowlist.json`。

不要 `git commit`、不要 `git push`、不要切分支。

## 任务 B：工具行错开插入

现在同一帧快照里到达的多条工具行会一次性糊上去，视觉上和「蹦一段文字」一样突兀。

在 `ThinkingTimeline` 内部加一个插入队列：同一批新增的工具行按约 **80 ms** 间隔逐条出现。用 state 记录「已显示到第几条」，用 timeout 或 rAF 推进。

要求：

- **只对 `active === true` 的进行中回合错开**；历史回看（`active === false`）挂载即全部显示，不做动画。
- 工具行只增不减（服务端是追加语义），但同一条的 `running → done` 状态更新**必须立刻生效**，不能被插入队列延迟——否则用户会看到一条已经跑完的工具还在转圈。
- 组件卸载时清掉未执行的 timeout。

## 任务 C：诚实的存活信号

用户分不清「模型正在想」和「画面死了」，要给可验证的证据。三条都要做。

### C1. 活动计时器

`ThinkingChain` 的 active pill 上加「· 已用 12s」，本地每秒 tick（基于 `thinking.startedAt`）。

这是最便宜的存活证明，而且**不依赖网络**——网断了它照样在走，正好把「模型慢」和「画面冻结」区分开。

文案走 i18n（`planText.ts`，zh / en / ja 三语都要加）。

### C2. 把重连状态暴露出来

`useAgentWatchStream` 的退避重连（`WATCH_RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000]`）目前对 UI **完全不可见**——断一次就是最长 5 秒画面冻结，用户毫不知情。

给该 hook 的 input 加一个可选回调：

```ts
onConnectionState?: (state: 'live' | 'degraded') => void
```

- `failuresRef.current >= 2` 时报 `degraded`（此时已经静默了 1.5 秒以上）
- 成功读到帧时（`failuresRef.current = 0` 那处）报 `live`
- 注意：`done.reason === 'rotate'` 的连接轮换**不是故障**，不要报 degraded

`ui.tsx` 里存成 state 传给 `ThinkingChain`；`degraded` 时 pill 文案换成「连接不稳，重试中」（三语），并把 spinner 换个视觉以示区分（例如降低透明度）。

**宁可告诉用户网络在抖，也别让他盯着一个假装在转的 spinner。**

### C3. 工具行 running 计时

`ToolCallRow` 在 `status === 'running'` 时本地显示已用时长（服务端只在结束时才给 `durationMs`）。

`save_plan_days` 这类工具能跑 20 秒以上，现在这期间画面完全静止。

实现：用一个 `Map<id, number>` 的 ref 记下每条工具行**首次出现**的时刻。不要改 `ToolCallEntry` 里服务端字段的含义，`durationMs` 到达后仍以服务端值为准。

## 硬性约束

⚠️ **不要编造进度**：不许加百分比进度条，不许显示没有真实发生的步骤。假进度一旦被用户识破，所有进度指示就都不可信了，比现在更糟。

⚠️ **每秒 tick 的计时器不要触发整棵树重渲染**：把计时局部化到显示它的那个小组件里，别把 `now` 放到 `ThinkingChain` 顶层 state 上导致整个时间线每秒重渲染一次。

## 验收

```
npm run typecheck
npm test
```

两个都要过。（`npm run lint` 在本 worktree 没装 eslint，跑了没信号，可跳过。）

`npm test` 第一步是行数预算：**单文件不得超过 750 行**。`ThinkingChain.tsx` 约 270 行，加完本批仍应远低于上限；若接近就拆文件，不要动 `line-budget.allowlist.json`。

在 `tests/plan/` 下新增测试，至少覆盖：

- 工具行错开插入：多条同批到达时逐条出现；`running → done` 更新不被延迟；`active=false` 时立即全量。
- `onConnectionState`：连续失败 2 次报 `degraded`，成功读帧报 `live`，`rotate` 不报 `degraded`。

不要跑 `npm run dev` / `npm run build` / playwright。

## 报告

简短中文汇报：改了哪些文件、B / C1 / C2 / C3 各自怎么实现、两条验收命令的**实际输出**、有没有需要人工确认的取舍。不要 `git commit`。
