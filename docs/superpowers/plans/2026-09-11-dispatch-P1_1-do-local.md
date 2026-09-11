# Phase 1.1：DO alarm 在本 isolate 直接调 OpenNext handler（开关默认关，受控实验）

worktree：`/Users/mac/Desktop/seichigo-wt-dispatch1` ／ 分支：`feat/dispatch-phase1-1`

> 背景：Phase 1 DO 派发 canary 实测 alarm 入口→内部路由入口 0.55–1.09s（`WORKER_SELF_REFERENCE.fetch` 在 DO 所在 colo
> 打到冷的 Next isolate）。本批把这一跳改为**本 isolate 直接调用 OpenNext 生成的默认 handler**。
> 同目录 `2026-09-11-dispatch-P1_1-astra-review.md` 是评审意见，**§2 与 §6 的边界必须照做**；本任务书已把它们写成硬约束。
> 这是受控实验：独立开关 `PLAN_AGENT_DO_LOCAL` 默认关，收益靠 A/B 实测，不预设。

## 效率要求
- **只读下面列出的文件**，不要读前端、不要读 `lib/billing/**`、不要读 `lib/planAgent/loop.ts`、不要 grep 全仓。
- **不要调用任何技能**，直接干活。

### 必读文件
1. `worker/planRunDispatcher.ts`（全文）、`worker/entry.ts`、`worker/drainResponse.ts`、`worker/cloudflare-workers.d.ts`
2. `.open-next/worker.js`（本地已构建，约 40 行——看默认导出 `fetch(request, env, ctx)` 的形状；**不要 import 它进 dispatcher**）
3. `app/api/internal/plan-agent/run/route.ts` 的请求头解析段（`x-plan-agent-transport` / `consumer-at` / `consumer-seq`）
4. `lib/planAgent/runTimings.ts`（`transport` 联合类型）
5. `wrangler.jsonc` 的 `vars`
6. `tests/worker/planRunDispatcher.test.ts`

## 边界
允许改：上述 1、3、4、5、6 + `lib/anitabi/cf/bindings.ts`（若类型需要）。
**绝不要改**：执行体（`lib/planAgent/loop.ts` / `execute.ts` / `runAdmission.ts` / `resume.ts` / `dispatch.ts`）、`lib/tripPlan/**`、`lib/billing/**`、`app/(authed)/**`、`app/api/me/**`、`prisma/**`、`package.json`、`line-budget.allowlist.json`。
`worker/` 仍**不得 import 任何 `@/` 应用代码或 `.open-next/**`**。
不要 `git commit` / `push`；不要跑 `dev` / `build` / `cf:*` / `wrangler` / playwright / prisma。

## 改什么

### 1. 注入（评审 §2）
`worker/planRunDispatcher.ts` 新增模块级：
```ts
export type OpenNextFetchHandler = { fetch(request: globalThis.Request, env: unknown, ctx: unknown): Promise<globalThis.Response> }
let localHandler: OpenNextFetchHandler | null = null
/** 由 worker/entry.ts 在模块求值时注册（不在 HTTP fetch 内——DO alarm 可能在从未跑过 HTTP 的 isolate 上启动）。只保存 handler，不捕获任何 env/ctx。 */
export function registerPlanRunLocalHandler(h: OpenNextFetchHandler): void { localHandler = h }
```
`worker/entry.ts`：`import handler from '../.open-next/worker.js'` 已有，紧接着 `registerPlanRunLocalHandler(handler)`（模块顶层）。

### 2. alarm 的本地调用路径
`alarm()` 里，构造完请求头/body 之后：
- 若 `this.doEnv.PLAN_AGENT_DO_LOCAL === '1'` **且** `localHandler` 非空 → 走本地：
  - 请求头与自引用路径**完全相同**，外加 `'x-plan-agent-local': '1'`；`'x-plan-agent-consumer-at'` 取**调用 handler 之前**的时刻（这样 `selfRefHopMs` 就变成本 isolate 的初始化成本，可与旧路径对比）。
  - **env 传原始完整对象 `this.doEnv`**（不要重建子集；把 `PlanRunDispatcherEnv` 改成 `{ WORKER_SELF_REFERENCE; PLAN_AGENT_INTERNAL_SECRET; PLAN_AGENT_DO_LOCAL?: string } & Record<string, unknown>`）。
  - **ctx 用每次 alarm 独立的适配器**（评审 §1）：
    ```ts
    const tasks: Promise<unknown>[] = []
    const ctxAdapter = {
      waitUntil(p: Promise<unknown>) { tasks.push(Promise.resolve(p).catch(() => undefined)) },
      passThroughOnException() {},
      props: {},
    }
    ```
    不要把 `this.ctx`（DurableObjectState）直接传（它的 `waitUntil` 官方定义为无效），也不要展开宿主对象。
  - `const res = await localHandler.fetch(new Request(INTERNAL_RUN_URL, { method:'POST', headers, body }), this.doEnv, ctxAdapter)`
  - 状态分类与今天**逐字相同**（400/401/503 永久、200 drain、其它抛错走重试）。
  - **drain 之后、删 payload 之前，收束后台任务**：循环 `while (tasks.length > drained) await Promise.allSettled(tasks.slice(drained))`（处理等待期间新加入的任务），整体用 `Promise.race` 加上限 `min(ALARM_WALL_MS(15min) − (Date.now() − alarmStartedAt) − 30_000, 240_000)`；超时只 `console.warn` 记录未完成数量，不抛。（今天队列路径这些任务在响应结束 30s 后就被砍，本设计只会更好，但不承诺全部完成——注释里写清。）
- 否则 → 现有 `WORKER_SELF_REFERENCE.fetch` 路径**一字不动**；若开关为 '1' 但 `localHandler` 为空 → `console.error('[worker/planRunDispatcher] PLAN_AGENT_DO_LOCAL=1 but no handler registered, falling back to self-reference')` 后走旧路径（payload 语义不变）。
- 本地调用抛错的处理与旧路径一致（attempts<3 rethrow）；**不得**绕过 claim 再执行。

### 3. 埋点
- 内部路由：`x-plan-agent-local === '1'` 时 `transport = 'do-local'`（`runTimings.ts` 的联合类型加 `'do-local'`；`[planAgent/timing]` 日志与 `modelUsage.timings` 一并带出）。
- `alarm()` 第一条语句记 `alarmStartedAt`（用于上限计算）。

### 4. 开关
`wrangler.jsonc` vars 加 `"PLAN_AGENT_DO_LOCAL": "0"`（只加这一行，带注释：受控实验，仅在 DO canary 白名单基础上再开）。

## 测试（`tests/worker/planRunDispatcher.test.ts` 扩展）
- 注册：`registerPlanRunLocalHandler` 后、开关 '1' → alarm 调用 handler 而**不**调 `WORKER_SELF_REFERENCE.fetch`；传入 handler 的 `env` 与构造 DO 的 env **同一对象引用**；请求头含 `x-plan-agent-local: 1` 与全部既有头。
- 未注册 + 开关 '1' → 走自引用路径且 `console.error` 一次；开关 '0' → 走自引用路径，handler 不被调。
- ctx 适配器：handler 内 `ctx.waitUntil(p1)`，p1 resolve 时再 `ctx.waitUntil(p2)` → alarm 在**两者都 settle 后**才删 payload；一个永不 resolve 的任务 + 假定时器 → 到上限后 warn 并仍删 payload（不抛）。
- 分类回归：本地 handler 返回 401/503/400 → 删 payload 不重试；返回 5xx/抛错 → attempts<3 rethrow 且 payload 保留。
- 既有 12 个用例逐字不变。
- `worker/` 不 import `@/` 与 `.open-next`（既有断言扩展）。
- 内部路由：`x-plan-agent-local: 1` → timings.transport === 'do-local'。

## 验收
```
npm run typecheck
npm test
```

## 报告
简短中文汇报：注入点、ctx 适配器与收束上限怎么实现、本地路径与旧路径的分叉点在哪一行、两条验收命令的**实际输出**。不要 `git commit`。
