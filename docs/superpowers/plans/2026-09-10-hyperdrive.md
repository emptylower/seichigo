# 接入 Hyperdrive：消除每 isolate 的 Postgres 建连成本

日期：2026-09-10 ／ worktree：`/Users/mac/Desktop/seichigo-wt-hyperdrive` ／ 分支：`perf/hyperdrive`

## 1. 背景：为什么要做

今天在生产实测出：**每次 Neon 往返约 0.6 秒**（连测 5 次 `GET /api/me/plans/:id` 稳定 3.1s，减掉 0.42s 的 isolate 基线，除以约 4–5 次往返）。

而网络层面东京（Worker 所在 colo）到新加坡（Neon 所在 `ap-southeast-1`）的 RTT 只有约 75ms。差的这 8 倍是**每个 Worker isolate 都要重新建立 Postgres 连接**（TCP + TLS + auth 多个往返）。

`lib/db/prisma.ts` 里 `CLOUDFLARE_POOL_MAX = 1` 加请求级 client（`prismaByRequestId`）的设计，本身就是在应对这个问题——每个请求级 client 就是一条新连接。Hyperdrive 在 Cloudflare 边缘维护到源库的连接池，Worker 连的是 Hyperdrive 而不是新加坡，建连成本就消失了。

规划 agent 的启动路径要做十次左右这样的往返，是当前首字延迟的主要成分之一。

## 2. 已经准备好的资源（不要重新创建）

两个 Hyperdrive 配置已建好，**都禁用了查询缓存**：

| 名称 | id | 端点 |
|---|---|---|
| `seichigo-nocache-pooled` | `54ccf978d8124d4abf2471693f47d226` | Neon pooler（生产现在用的那个） |
| `seichigo-nocache-direct` | `093adf75486249509fda61afc1af6614` | Neon 直连 |

**为什么必须禁缓存**：Hyperdrive 的查询缓存默认开启（`max_age` 60s + `stale_while_revalidate` 15s），而且**写入不会失效缓存**。本项目的 run-token 栅栏（`renewAgentRun` / `isAgentRunStopped` / `updateMetaIfActive`）、计费余量、session 全都要求读到最新值——读到陈旧 token 会让被接管的旧 run 继续写库，破坏并发正确性。官方文档也明确把 auth / session / permissions / billing / 读后写 列为必须走 cache-disabled 配置的场景。

禁缓存**不影响**连接池化收益，官方原话是「禁用缓存后你仍然获得 Hyperdrive 的连接池化与快速建连」。

## 3. 边界

允许改：
- `wrangler.jsonc`（只加 hyperdrive 段与一个 vars 键）
- `lib/db/prisma.ts`
- `lib/anitabi/cf/bindings.ts`（只为加 binding 的结构子集类型）
- 相应测试

**绝不要改**：`app/**`、`features/map/**`、`lib/planAgent/**`、`lib/billing/**`、`prisma/**`、`package.json`、`line-budget.allowlist.json`。

⚠️ **绝对不要动 `lib/db/prisma.ts` 里请求级 client 的 pruning 逻辑**——`prismaByRequestId`、`REQUEST_CLIENT_TTL_MS`、`activeTransactions` 计数那一整套是并发正确性核心（注释里写明了误断在途事务会导致对话中途报 "Transaction not found"）。本次只改**连接串从哪来**，不改 client 生命周期管理。

不要跑 prisma 迁移。不要 `git commit`、不要 `git push`、不要切分支。

## 4. 要做的改动

### 4.1 `wrangler.jsonc` 加绑定

两个都绑上，用一个 vars 键选用哪个——这样以后切换端点只改一个字符串、不用改代码：

```jsonc
"hyperdrive": [
  { "binding": "HYPERDRIVE", "id": "54ccf978d8124d4abf2471693f47d226" },
  { "binding": "HYPERDRIVE_DIRECT", "id": "093adf75486249509fda61afc1af6614" }
]
```

`vars` 加 `"HYPERDRIVE_ENDPOINT": "pooled"`（可选值 `pooled` / `direct` / `off`）。默认先用 `pooled`——它是生产现在就在用的端点，Neon scale-to-zero 的休眠/唤醒行为已经验证过；`direct` 留作对比实验；`off` 是回滚开关（走原来的 `process.env.DATABASE_URL`）。

### 4.2 `lib/anitabi/cf/bindings.ts` 加类型

按该文件的既有风格（结构子集，不直接引用 `worker-configuration.d.ts`）给 `CfBindingsEnv` 加：

```ts
/** Hyperdrive 绑定的结构子集：只用 connectionString */
HYPERDRIVE?: { connectionString: string }
HYPERDRIVE_DIRECT?: { connectionString: string }
```

**不要**跑 `npm run cf:typegen` 去重新生成 `worker-configuration.d.ts`（那会带进大量无关 diff）。

### 4.3 `lib/db/prisma.ts` 选连接串

`createPrismaClient` 现在是：

```ts
const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')
```

改成按下面的优先级取：

1. `HYPERDRIVE_ENDPOINT === 'direct'` → `getCfBindings()?.env?.HYPERDRIVE_DIRECT?.connectionString`
2. `HYPERDRIVE_ENDPOINT !== 'off'` → `getCfBindings()?.env?.HYPERDRIVE?.connectionString`
3. **回落 `process.env.DATABASE_URL`**

⚠️ **第 3 步的回落是必须的，不是保险**：
- Hyperdrive 是 binding，只能在请求上下文里经 `getCfBindings()` 拿到；
- Next 的预打包阶段（286 个静态页）跑在 **Node 环境、没有任何 binding**，构建会直接失败；
- 本地开发跑的是 `next start`（不是 `wrangler dev`），同样没有 binding。

所以拿不到 binding 时**静默回落**到 `process.env.DATABASE_URL`，不要报错、不要警告刷屏。只有连回落也没有时才抛 `DATABASE_URL is not set`（保持原错误文案）。

加一条**一次性**的 `console.log`（不要每个 client 都打）记录本次进程实际用的是哪条路径（`hyperdrive-pooled` / `hyperdrive-direct` / `env-fallback`），便于部署后确认绑定真的生效了——这是本次最容易「以为配上了其实在走回落」的地方。

### 4.4 不要改的参数

`PrismaPg` 的 `max`（Cloudflare 上是 1）、各超时值、`idleTimeoutMillis` 全部保持原样。Hyperdrive 负责源侧池化，客户端侧维持小池是正确的。

## 5. 验收

```
npm run typecheck
npm test
```

两个都要过。（`npm run lint` 本仓库没装 eslint、脚本带 `|| true`，无效验收，跳过。）

`npm test` 第一步是行数预算，单文件 ≤750 行。

测试至少覆盖：

- `HYPERDRIVE_ENDPOINT` 为 `pooled` / `direct` / `off` 三种取值分别选出正确的连接串。
- **拿不到 binding 时回落到 `process.env.DATABASE_URL`**（这条最关键，构建和本地开发都依赖它）。
- binding 与 `process.env.DATABASE_URL` 都没有时，抛出原来的 `DATABASE_URL is not set`。
- 请求级 client 的 pruning 行为不变（回归；`tests/lib/prisma-client-lifecycle.test.ts` 已有用例，注意该文件有**预先存在**的 typecheck 报错，不是你引入的，别去修它）。

不要跑 `npm run dev` / `build` / `cf:*` / playwright。

## 6. 报告

简短中文汇报：改了哪些文件、连接串选取逻辑怎么实现的、两条验收命令的**实际输出**、有没有需要人工确认的取舍。不要 `git commit`。
