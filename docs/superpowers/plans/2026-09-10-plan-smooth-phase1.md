# 阶段一：打字机播放缓冲 + 布局稳定（前端）

worktree：`/Users/mac/Desktop/seichigo-wt-plan-fe` ／ 分支：`feat/plan-thinking-smooth-render`

> 这是「计划页思维链渲染平滑化」的**第一批**改动。第二批（工具行错开插入、存活信号）在另一份任务书里，本次**不要**做，也不要为它提前改结构。

## 效率要求（重要）

上一次执行本任务的会话因为一次性读了太多文件、context 过大而卡死。这次请：

- **只读下面「必读文件」列出的 3 个文件**，不要通读 `ui.tsx`、`ChatPane.tsx`、`lib/i18n/**`、`scripts/**`——本批改动用不到它们。
- **不要调用 `executing-plans` 之类的技能**，直接干活。
- 不要为了"了解上下文"去 grep 整个仓库。

### 必读文件

1. `app/(authed)/plan/[id]/components/ThinkingChain.tsx`（253 行，主战场）
2. `app/(authed)/plan/[id]/lib/chatState.ts`（138 行，看 `liveToThinkingTurn`）
3. `tests/plan/` 目录下任意一个现成测试（照抄它的写法与 import 风格即可）

## 背景（一句话）

服务端每 500 ms 推一帧**全量** reasoning 快照，前端整串替换后立刻渲染，用户看到的是「静止 500 ms → 一次蹦出约 200 字」，非常卡。要把渲染节奏和网络到达节奏解耦。

## 边界

允许改：`app/(authed)/plan/[id]/**`、`tests/plan/**`。

**绝不要改**：`lib/**`、`app/api/**`、`features/map/**`、`app/(authed)/map/**`、`prisma/**`、`wrangler.jsonc`、`package.json`、`line-budget.allowlist.json`。

不要 `git commit`、不要 `git push`、不要切分支。

## 任务 A：打字机播放缓冲

新建 `app/(authed)/plan/[id]/hooks/useSmoothText.ts`：

```ts
export function useSmoothText(target: string, opts?: { done?: boolean }): string
```

1. 内部维护 `renderedLen`（state）与 `targetRef`（ref），返回 `target.slice(0, renderedLen)`。
2. 用 `requestAnimationFrame` 推进 `renderedLen` 逼近 `target.length`。**不要用 `setInterval`。**
3. **速率自适应**（不要写死固定速度）：记录每次 `target` 变长的时刻，用 EMA（`alpha = 0.3`）估计到达间隔 `arrivalMs`，初值 500，钳在 `[250, 900]`。每帧目标速率 `charsPerMs = remaining / arrivalMs`——含义是「用大约一个到达周期把当前缓冲放完」，既不会提前放空卡住干等，也不会越积越多越落越远。
4. 每帧步进量钳在 `[1, 12]` 字符；`remaining > 600` 时（异常积压，如刷新后一次拿到整段）放宽上限到 40。
5. **前缀校验**：服务端 reasoning 有 20000 字符「截头保尾」，新 target 可能不以已渲染前缀开头。`!target.startsWith(rendered)` 时直接 `renderedLen = target.length`（snap 到末尾）并重置 EMA，**不要试图 diff**。
6. `opts.done === true` 时立刻 flush 到全长并停掉 rAF。run 结束后绝不允许屏幕上还有字在爬。
7. `prefers-reduced-motion: reduce` 时全程 snap（直接返回 `target`）。
8. 卸载时 `cancelAnimationFrame`。

接入：`ThinkingChain.tsx` 里的 `ThinkingTimeline`（第 122 行）用它渲染 reasoning。`ThinkingTimeline` 目前拿不到 `active`，从 `ThinkingChain` 传下去：`useSmoothText(thinking.reasoning, { done: !active })`。

**历史回看（`active === false`）必须直接全量显示**——用户展开一个早就结束的回合，不该看打字机重放。

## 任务 D：消掉布局跳动

1. 第 141 行现在是 `thinking.reasoning.trim() ? <div>…</div> : null`——框子凭空长出来，第一帧必然一次布局跳动。改成常驻，给约两行高的 `min-h` 占位。
2. 现在有**两层嵌套滚动容器**：第 137 行 `max-h-[50dvh] overflow-y-auto` 外层 + 第 143 行 `max-h-40 overflow-y-auto` 内层，而第 126–133 行的 effect **两个都写 `scrollTop`**，互相打架。收敛成**一个**滚动容器。
3. 自动滚动改成：
   - 只在用户**已经贴近底部**时才跟随（`scrollHeight - scrollTop - clientHeight < 40`）。用户手动上滚看历史时不要把他拽回去。
   - 跟随动作和打字机走**同一个 rAF tick**，让文字和滚动同步移动，而不是「文字先蹦一段、滚动条再追一下」。

## 验收

在 worktree 根目录（`node_modules` 已装好）：

```
npm run typecheck
npm run lint
npm test
```

三个都要过。`npm test` 第一步是行数预算：**单文件不得超过 750 行**，超了拆新文件，不要动 `line-budget.allowlist.json`。

在 `tests/plan/` 下加 `useSmoothText` 的单测（注入假时钟与假 rAF）：匀速推进、前缀不匹配时 snap 到末尾、`done` 时立即 flush、reduced-motion 时直通。

**不要**跑 `npm run dev` / `npm run build` / playwright。

## 报告

简短中文汇报：改了哪些文件、A 和 D 各自怎么实现、三条命令的**实际输出**。不要 `git commit`。
