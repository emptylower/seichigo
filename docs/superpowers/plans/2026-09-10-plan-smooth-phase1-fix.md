# 阶段一修正：useSmoothText 的两个效率缺陷

worktree：`/Users/mac/Desktop/seichigo-wt-plan-fe` ／ 分支：`feat/plan-thinking-smooth-render`

> 阶段一的功能实现是对的（测试全过、行为正确），这份只修两个效率缺陷。**改动很小，不要重构、不要改行为、不要动测试断言的语义。**

## 效率要求

**只读这 2 个文件**，不要读别的：

1. `app/(authed)/plan/[id]/hooks/useSmoothText.ts`（118 行，主战场）
2. `app/(authed)/plan/[id]/components/ThinkingChain.tsx` 的 `ThinkingTimeline` 函数（只看 `followBottom` 那一段，确认 onFrame 做了什么即可）

不要调用任何技能，不要 grep 全仓库，不要通读其他文件。

## 缺陷 1：rAF 每帧强制重排，且永不停歇

`useSmoothText` 的 rAF `tick` 里，`onFrameRef.current?.()` 是**无条件**调用的——只要 `!done`，循环就一直以 60fps 转下去，不管这一帧有没有真的推进字符。

而调用方传进来的 `onFrame`（`ThinkingTimeline` 的 `followBottom`）会读 `el.scrollHeight` / `el.scrollTop` / `el.clientHeight`，这三个都是**强制 layout（reflow）**的属性。

思维链在 run 期间是默认展开的，一个 10 分钟的 run 就是约 36000 次强制重排——包括中间那些几十秒的工具调用期间（一个字都没新增，照样每帧重排一次）。这直接抵消了本次改动的目的。

**修法**（两条都要）：

1. `onFrame` 只在**本帧真的推进了字符**时才调用。没有推进就不调。
2. `remaining === 0` 时**让 rAF 循环停下来**，不要空转。target 再次变长时重新启动循环。

   实现建议：用一个 ref 记录当前是否有活跃的 rAF；在第一个 effect（检测到 `target.length > st.lastTarget.length`）里，若循环已停就重新 `requestAnimationFrame`。或者你有更简洁的写法也可以，只要满足：**空闲时零 rAF 回调、零 onFrame 调用**，且 target 变长后能立刻恢复推进。

   注意 `done` 时的收尾 `onFrame` 调用（第二个 effect 里那次）要保留——那次是必要的，让滚动跟到最终位置。

## 缺陷 2：每帧 O(n) 字符串分配

第一个 `useEffect` 没有依赖数组，**每次 commit 都会执行**——而推进期间每帧都有一次 `setRenderedLen` 导致的 commit。

effect 体里的 `const rendered = st.lastTarget.slice(0, st.renderedLen)` 会分配一个新字符串，随后 `target.startsWith(rendered)` 是 O(n) 扫描。reasoning 最长 20000 字符，于是推进期间每帧一次 20KB 分配 + 20000 字符比较。

**修法**：在 effect 顶部加提前返回——`target` 与 `st.lastTarget` 相同时，除了刷新 `onFrameRef.current` 之外什么都不做（前缀校验和 EMA 更新都只在 target 真的变化时才有意义）。

注意 `onFrameRef.current = opts?.onFrame` 的刷新要保留在提前返回**之前**，否则调用方换了回调引用会失效。

## 不要动的东西

- 速率自适应逻辑（EMA、钳位、步进上限）——已经正确，别改参数。
- 前缀校验（snap 到末尾）、`done` flush、reduced-motion 直通、卸载 cancel——都正确。
- `ThinkingTimeline` 的 DOM 结构、min-h 占位、单滚动容器、贴底判据（< 40）——都正确。
- 现有测试的断言语义。可以**新增**测试，不要弱化已有的。

## 验收

```
npm run typecheck
npm test
```

两个都要过（`npm run lint` 在本 worktree 没装 eslint，跑了也没信号，可跳过）。

给 `tests/plan/useSmoothText.test.tsx` **新增**至少 2 个用例：

- 空闲时（target 不再变长）不再产生 rAF 回调 / 不再调用 `onFrame`。
- target 再次变长后能恢复推进。

不要跑 `npm run dev` / `npm run build` / playwright。不要 `git commit`。

## 报告

简短中文汇报：两个缺陷各自怎么修的、新增了哪些测试、两条验收命令的**实际输出**。
