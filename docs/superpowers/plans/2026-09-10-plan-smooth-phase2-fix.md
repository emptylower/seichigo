# 阶段二修正：收起再展开不应重放工具行错开动画

worktree：`/Users/mac/Desktop/seichigo-wt-plan-fe` ／ 分支：`feat/plan-thinking-smooth-render`

> 阶段二功能实现正确、测试全过。这份只修一个交互瑕疵（你自己在报告「取舍 3」里指出的那个）。**改动很小，不要重构、不要改其他行为。**

## 效率要求

**只读 1 个文件**：`app/(authed)/plan/[id]/components/ThinkingChain.tsx`。

不要读其他文件，不要调用任何技能，不要 grep 全仓库。

## 问题

`ThinkingTimeline` 里 `shownCount` 的初值是 `active ? 0 : thinking.toolCalls.length`，而 `ThinkingTimeline` 在用户收起时会**整个卸载**（`ThinkingChain` 里是 `expanded ? <ThinkingTimeline …/> : null`）。

于是每次用户收起再展开一个**进行中**的时间线，已经看过的工具行会从 0 开始按 80 ms 重新错开一遍。10 条工具行就是 800 ms 的重放动画。用户会以为「它又在加载了」——这正是本次改动要消灭的那种困惑，比不做动画更糟。

`firstSeenAtRef`（工具行首见时刻的 Map）有同样的问题：卸载后重置，导致 running 行的已用时长从 0 重新开始计。

## 修法

`ThinkingChain` 组件本身**不随展开/收起卸载**（只有 `timeline` 是条件渲染），所以把跨展开需要保持的状态提到 `ThinkingChain` 层：

1. 把 `shownCount` 的 state 与推进它的 80 ms 步进器 effect 从 `ThinkingTimeline` 提到 `ThinkingChain`，作为 prop 传给 `ThinkingTimeline`。
2. 把 `firstSeenAtRef` 也提到 `ThinkingChain`，同样作为 prop 传下去。

这样：

- 收起再展开：已揭示的行**立即全部显示**，只有此后新到达的行才继续错开。
- running 行的已用时长跨展开连续，不会归零重算。
- 新回合开始时（`thinking.startedAt` 变化或 `active` 由 false 变 true）这些状态要重置，否则上一轮的揭示进度会漏到新一轮。请确认这一点并加测试。

**不要**改的东西：80 ms 间隔常量、`active=false` 时立即全量的行为、`running → done` 更新不被延迟的性质、`ElapsedTick` / `RunningElapsed` 的局部化计时（它们必须留在叶子组件里，不要提升）。

## 验收

```
npm run typecheck
npm test
```

两个都要过。（`npm run lint` 本 worktree 没装 eslint，跑了没信号，可跳过。）

给 `tests/plan/thinking-chain-stagger.test.tsx` **新增**用例（已有断言不要改）：

- 进行中时间线收起再展开：已揭示的行立即全量显示，不重放错开。
- 新回合开始时揭示进度重置。

`ThinkingChain.tsx` 当前 337 行，行数预算上限 750，改完仍应远低于上限。

不要跑 `npm run dev` / `npm run build` / playwright。不要 `git commit`。

## 报告

简短中文汇报：怎么修的、新增了哪些测试、两条验收命令的**实际输出**。
