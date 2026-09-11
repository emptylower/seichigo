Phase 1.1 对抗式审查 · Astra · 2026-09-11

**结论：修正后支持。** 支持把完整 OpenNext `fetch` 注入 DO，先做隔离环境验证，再做可回退的单账号 canary；不支持把“换一个 fetch、其余语义完全相同、稳定净省 0.55–1.09s”作为已成立的生产结论。主要缺口是后台完成边界与性能归因，不是 DO 缺少 `waitUntil`，也不是 AsyncLocalStorage 天生不能在 DO 使用。

本审查只读取当前工作目录源码、现存 `.open-next` / `node_modules` 产物、已有观测报告和 Cloudflare 官方文档；没有运行应用、构建、测试、部署或 git。生成产物用于证明本地实现，未核验它与提案所称生产版本逐字一致。文中的测试均为实施验收要求，不能读作本轮已经通过。

先纠正证据边界：`scratch/codex-verify/phase1/report.md:7`、`:28`、`:29` 只有轻 3、重 2 个有效浏览器 T2 样本，`:35`、`:39` 明确刷新恢复、停止后继续被额度错误阻塞，未完成动作。这不否定提案另外声称的 7 轮服务端观测，但两者不是同一分母。当前材料只能说明改善方向，不能取代联合方案每格 ≥40 次、P95 和故障演练门槛（`scratch/arch-discussion/joint-plan-v1.md:51`、`:61`、`:109`–`:111`）。

| 优先级 | 发现 | 性质及处理 |
|---|---|---|
| P1 | drain EOF 不代表业务后台任务或框架 waitUntil 全部结束 | 必须明确完成/持久交接边界；不能把 timer 和 idle 驱逐窗口当完成保证 |
| P1 | “最长 13 分钟”不成立，现有 soft deadline 只在循环边界检查 | 已有风险；本轮不可宣称自然满足 15 分钟上限，必须验证硬杀恢复 |
| P1 | 本地首次 fetch 仍触发 OpenNext init 和 server handler 动态加载 | 收益前提未成立；按端到端 A/B 决定，不承诺整段净省 |
| P2 | 真实 DO ctx 可调用，但当前项目类型和测试假 ctx 不足以直接套提案代码 | 修正结构类型与注入方式，用真实 workerd 验证 |
| P2 | Prisma 正常按 requestId 隔离；跨对象 prune 是另一个生命周期问题 | 保留现有事务 pin，补交错/跨 TTL 验收，不凭推测重构 |

**1. 后台任务：活着时可以进展，EOF 后并没有自动获得持久完成保证。**

官方明确 `DurableObjectState.waitUntil` 存在，但不改变对象寿命或调用完成时机；有进行中的工作或 I/O 时对象会保持活动。因此“DO waitUntil 无效，所以内部异步逻辑跑不了”是错误推论。[Durable Object State — waitUntil](https://developers.cloudflare.com/durable-objects/api/state/#waituntil)

当前执行链的关键边界是：

- 内部路由在 `ReadableStream.start` 中 `await executePlanAgentRun`，并每 15 秒写 heartbeat；执行结束后关闭流（`app/api/internal/plan-agent/run/route.ts:185`–`:231`）。DO `await drainBody`，读到 EOF 才删除 payload（`worker/planRunDispatcher.ts:137`–`:140`；`worker/drainResponse.ts:8`–`:18`）。正常情况下，主执行和它启动的后台 I/O 可在这段时间并行进展；这不是对每个后台 promise 都完成的证明。
- CUT-6 在模型请求发出后派发 stage 写，并保留 token 栅栏（`lib/planAgent/loop.ts:260`–`:274`、`:433`–`:445`）。通常有整个模型回合可供它完成；仍可能遇到慢库、停止、硬杀，且写错会被吞掉。它是可重新推断的阶段缓存，源码本已接受硬杀丢失（`:254`–`:259`），不宜为它单独设计重型可靠队列。
- 图片镜像经 `runInBackground` 启动（`lib/planAgent/serverDeps.ts:103`–`:113`）；`runInBackground` 仅登记 promise，返回 `void`，不提供可等待的完成列表（`:69`–`:79`）。另外 runLive finish 只等最多 2 秒，剩余 promise 直接浮动，**没有走该函数**（`lib/planAgent/loop.ts:625`–`:633`）。因此只改这一处后台派发也不是全部覆盖。
- 补齐续跑在主 run 尾部登记（`lib/planAgent/loop.ts:669`–`:694`），默认 **2 轮、每轮先等 61 秒**，之后还要查库、补齐、写回和额外计费（`lib/planAgent/enrichContinuation.ts:89`–`:102`、`:151`–`:162`、`:175`–`:203`）。它没有传入主 run 的 deadline。两轮光等待已是 122 秒，不能用“70–140 秒后才驱逐”推导一定做完。

生命周期文档还必须读完整：timer 会阻止 hibernation，但 idle/non-hibernateable 状态仍有 70–140 秒驱逐规则；活动中的出站 TCP/WebSocket 有额外保活规则。**禁止休眠不等于无限保活**，也不能反向断言一到 70 秒所有 I/O 必被砍。[Lifecycle of a Durable Object](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)

对本项目的推论是：主流 drain 结束后，仍在查库的任务和仅等待 `setTimeout` 的任务不能混为一谈；后台可能正常完成，也可能在之后 idle 驱逐、部署、资源终止时丢失。不能承诺“drain 后立即闲置”，更不能把它作为持久任务系统。尤其 payload 已删除后，后续补齐失败不会自动重新执行主 alarm。补齐函数自己吞错（`enrichContinuation.ts:205`–`:207`），重试主 run 也无法补救它。

旧路径也不是可靠基线：HTTP Worker 的 waitUntil 在响应结束后只提供至多 30 秒延长，因此源码注释“waitUntil 保证 61 秒 sleep 醒来”（`serverDeps.ts:64`–`:67`）与官方上限不符；即使某些样本因流关闭较晚等原因成功，也不能作为契约。[Workers limits — Duration](https://developers.cloudflare.com/workers/platform/limits/#duration)

实施必须明确以下策略，而非默认把旧注释当保证：

- 对需要完成的短尾任务，可在**每次 alarm 独立的上下文适配器**中收集 waitUntil promise，先 drain，再收束任务；必须处理任务执行期间新增任务，不能只对初始数组调用一次 `Promise.all`。适配器保留真实 ctx 方法的接收者绑定，不能把宿主对象展开成普通对象后假定原型方法仍在。runLive 那条浮动 finish 需另行说明是否纳入。
- 采集范围还包括框架自身：OpenNext 的 node wrapper 无条件执行 `ctx.waitUntil(handler(...))`，然后返回 `promiseResponse`（`node_modules/@opennextjs/aws/dist/overrides/wrappers/cloudflare-node.js:90`–`:94`）。`fetch` resolve、流 EOF、所有框架后台工作结束是三个不同边界。不能只捕获 `serverDeps` 的任务。
- 对超出剩余 alarm 预算的两轮补齐，若承诺可靠执行，应先把可恢复参数/阶段持久写入，再由后续 alarm 或独立持久任务执行；重新读取计划并保留 token、busy、updatedAt 守卫和额外成本语义。不能把闭包写入 storage，也不能再次调用会被一次性 claim 拦下的主 run 路由。若本轮保持原有尽力而为语义，就必须在 canary 结论明确其限制、记录完成/中断，不能声称已解决后台可靠性。

不建议无界等待所有尾任务：接近 13 分钟时再等待两轮 61 秒已经没有充足余量。短尾收束与长补齐持久交接应分别设计。联合方案原本排除了无人在线自动恢复和完整持久调度重构（`scratch/arch-discussion/joint-plan-v1.md:144`–`:150`）；本审查不借此强行扩成全面迁移，但生产完成保证必须与实际选择一致。

**2. ctx、HTTP 上下文与注入：可行，但“上下文完全相同”说得过满。**

真实 DO 的 `this.ctx` 是 DurableObjectState，`waitUntil` 有兼容方法。因此不是天然 `undefined`。但项目本地声明 `worker/cloudflare-workers.d.ts:10`–`:13` 只有基类构造器，没有声明 `ctx/env`；`PlanRunDispatcherCtx` 仅有 storage（`worker/planRunDispatcher.ts:37`–`:39`）。直接写提案的 `this.ctx/this.env` 需要补类型或显式保存完整原始对象。现有单测传 `{ storage }`（`tests/worker/planRunDispatcher.test.ts:68`–`:75`），无法供 OpenNext 无条件 `waitUntil.bind(ctx)` 使用；`serverDeps` 的可选调用不能替框架兜底。

完整路径实际有两层 ALS：

| 上下文 | 本地证据 | 意义 |
|---|---|---|
| Cloudflare bindings | `.open-next/cloudflare/init.js:5`–`:13` 定义 symbol getter，再执行 ALS.run({env, ctx, cf: request.cf})；`lib/anitabi/cf/bindings.ts:103`–`:114` 读取 | 原始 env 和传入 ctx 可被业务取到；不会把 DO ctx 自动变成 HTTP ExecutionContext |
| OpenNext requestId | `node_modules/@opennextjs/aws/dist/core/requestHandler.js:15`–`:28` | 服务端处理器建立请求 ALS；requestId 由内部 middleware 传入或由服务端生成，不是 init.js 一步同时生成两套上下文 |
| 路由流程 | `.open-next/worker.js:17`–`:40` | 完整 fetch 依次跑 skew、middleware、动态导入和 server handler |

所以应注入 **`.open-next/worker.js` 的完整默认 handler**，不能省事改为直接 import 应用 POST 或只调 server handler，再声称 bindings 与 requestId 都已经建立。

对提案列出的 HTTP-only 怀疑逐项判断：

- `new Request` 通常没有入站 `cf` 元数据。当前 init 只存值，edge wrapper 用可选访问读取字段（`node_modules/@opennextjs/aws/dist/overrides/wrappers/cloudflare-edge.js:23`–`:36`）；没有发现当前 internal run 因 `request.cf` 缺失而必然崩溃的证据。不要伪造地区/IP 来“补齐”上下文。
- middleware 仍会走，不会因为是本地调用自动跳过。当前应用 middleware 对 `/api/` 直接放行（`middleware.ts:128`–`:129`）；业务执行 locale 来自消息（内部路由 `:202`），应覆盖 zh/en/ja 验收。
- 当前生成的 skew protection 是 `if (false)`；即便开关日后开启，该代码在没有 deployment id 时也退出（`.open-next/cloudflare/skew-protection.js:5`–`:13`）。当前无据认定会重定向到外部，但升级 OpenNext 后要重新检查。
- `caches` 不是原始 HTTP Request 自带的属性；不能用缺少真实入站 HTTP 这一点证明 Cache API 必坏。这里也不以静态检索宣称整个 OpenNext 在 DO 已获兼容验证：必须跑真实 workerd 完整路径，包含绑定、Node 兼容和流式桥接。
- env 必须传原始完整对象。`PlanRunDispatcherEnv` 只有 secret/self binding 是类型子集，不是生产绑定清单；若实现真的重建成这个子集，将丢掉 Hyperdrive/R2 等（`worker/planRunDispatcher.ts:24`–`:27`；`wrangler.jsonc:92`–`:112`）。init 首次 fetch 还把字符串绑定写进 process.env（`.open-next/cloudflare/init.js:62`–`:81`）。

setter 应在 `worker/entry.ts` 模块求值时注册稳定函数，只保存 handler，不闭包捕获某个 DO 的 env/ctx/任务列表；不能放在默认 HTTP fetch 内，因为 DO alarm 可能在从未执行默认 fetch 的 isolate 上启动。调用时保留 handler 的方法接收者。缺注入必须明确失败并保留 payload 重试，不能返回假 200。`entry.ts:2` 已导入生成 handler，`:19` 导出 DO，此处注册可以保持 dispatcher 不依赖应用源码的边界。

**3. 15 分钟墙钟、CPU、内存：配置可用，但不能从“13 分钟”推出安全。**

`limits.cpu_ms=300000` **适用于 DO alarm**。官方 DO FAQ 明确包含 HTTP、WebSocket 和 Alarm，配置提高活动 CPU 预算；网络/存储等待不计 CPU。当前 namespace 为 SQLite，且同一 Worker 已配置此值（`wrangler.jsonc:18`–`:22`、`:135`–`:138`）。alarm 另有 15 分钟墙钟上限；直接调用 JS handler 不会另获一份 HTTP 事件预算。[Durable Objects limits — CPU / wall time](https://developers.cloudflare.com/durable-objects/platform/limits/)

直调之后 OpenNext、Prisma、模型流解析和后台处理都由这个 DO 执行。它仍然是异步 I/O 主导，不是“同步 CPU 跑 13 分钟”；但必须重新量 DO alarm 的总 CPU。不得靠 heartbeat 或 waitUntil 绕过上限。

当前 deadline 从 dispatchedAt 加 13 分钟计算（`app/api/internal/plan-agent/run/route.ts:119`–`:124`），但 `loop.ts:405` 只在新迭代前检查。模型调用随后可以长时间停在 `await modelCall`（`:433`–`:445`），并行标题也由 `Promise.all` 等待（`execute.ts:74`、`:118`–`:131`）。主流 EOF 还在结算、日志和 endAgentRun 之后。因此“最长 13 分钟”必须改为“循环启动软截止 13 分钟；在途操作可能超时”。这是既有实现与联合方案已承认的限制（`joint-plan-v1.md:94`、`:149`），不是本轮新发现的必改全面 AbortSignal 任务。

若 DO 在 claim 之后被硬杀，重试同 token 会返回 stale/skipped（内部路由 `:109`–`:117`）；它保证不重复领取，**不保证恢复未完成工作**。必须沿用现有新 token 接管、日志/账本核对及用户可恢复状态，不能清空 startedAt 让旧 token 再执行。alarm 的平台重试是有限且至少一次的执行机制。[Durable Objects alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

内存上限是每 isolate 128 MB，包含 JS heap 与 WASM；不是每个 run/DO 各自一份。[Workers limits — Memory](https://developers.cloudflare.com/workers/platform/limits/#memory) 本地能看到每计划依赖最多缓存 64 个（`serverDeps.ts:53`–`:60`）、Prisma 请求 Map 按 TTL 访问时清理（`prisma.ts:130`–`:175`），并没有整个进程内存证明。drain 逐块丢弃，不应改为 `text()` 累积主流。需要重计划及并发压测，测 CPU、内存、数据库连接和总耗时，而不是只测一句话首字。

**4. 同 isolate 多 DO：requestId 隔离有实现依据，TTL 的清理所有权仍需实测。**

正常经完整 handler 的每次调用进入独立请求 ALS，`prisma` 代理取当前 requestId，在 `prismaByRequestId` 下创建 max=1 的 client（`lib/db/prisma.ts:113`–`:119`、`:145`–`:175`、`:201`–`:218`）。共享 Map 不等于共享 client。Cloudflare 支持 AsyncLocalStorage；不同 DO 可以共享全局内存，因此不能把模块级可变 ctx 当成请求上下文。[AsyncLocalStorage](https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/)、[Durable Objects in-memory state](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/)

真正要攻击的是 prune，而非空泛的“并发 ALS 不安全”：B 的请求读取 Prisma 时，会遍历全局 Map，跳过 B 自己和 `activeTransactions>0` 的 client，对其他超过 30 秒未访问的 A 执行删除和 `$disconnect()`（`prisma.ts:130`–`:142`）。lastUsedAt 在顶层 proxy 访问时刷新，不是每个底层 SQL 结束时刷新；目前只有 `$transaction` 会 pin（`:155`–`:158`、`:206`–`:212`）。

因此 A 在模型思考/61 秒 sleep 期间被清掉，恢复后重新经 proxy 建自己的 client，是符合当前设计的，不构成串库。反例风险是 A 仍有未 pin 的非事务工作、保留 delegate，或 B 在不同 DO 的 I/O 上下文触发 A 的 disconnect。**尚无运行时证据证明这些在直调模式必然报错**；它们也不是该改动才首次存在。应保留事务保护并针对真实 DO 复现，出现错误再修，而非先把请求隔离撤掉改成全局 pool。

现有 `tests/lib/prisma-client-lifecycle.test.ts:40`–`:44` 用可变全局 `currentRequestId` 模拟 getStore，验证了 TTL/事务策略，没有验证真实并发 ALS。验收要覆盖不同对象交错 await、跨 30 秒、长事务、后台任务和重新进入 handler；同时验证 cf ctx/requestId 不串，绝不出现 `[db/scope] global-pool max=5` 的错误回落。单次 `[db/scope] request-scoped` 日志也不能代替每个并发请求的关联证明（`prisma.ts:182`–`:198`）。

**5. 省跳与省冷启动：先测成本迁移，再决定是否改变对象粒度。**

`consumerSeq=1` 只能证明该模块实例第一次走到 `++INVOCATION_SEQ`。序号在 alarm 发起内部请求时才递增，DO fetch/constructor 没有递增（`worker/planRunDispatcher.ts:53`、`:59`–`:63`、`:71`、`:125`）。完全可能是对象刚被 fetch 接纳、同一 isolate 随后第一次 alarm，或已经存在但尚未执行过此类 alarm。不能推出“alarm 每次新 isolate”，更不能推出 0.97–1.7 秒全是冷启动。

现有所谓 alarm 入口戳其实在读 payload、读 state、写 attempts **之后**、发起内部请求之前（`:109`–`:125`）。`queueDispatchMs` 因此含这些 storage 步骤；`selfRefHopMs` 的另一端在内部路由校验 secret、JSON、载荷之后才打戳（内部路由 `:48`–`:90`）。两段名称不是精确的纯调度/纯网络耗时。直调后同 isolate 同步工作还受时钟精度限制，测出 0ms 也不能证明没有初始化 CPU。

“DO 已付完整 Next 初始化”同样没有成立：`.open-next/worker.js:39` 首次 server 请求才动态 import `handler.mjs`，`.open-next/cloudflare/init.js:15`–`:23` 首次 fetch 才做 runtime/env 初始化。原来 DO 只走接纳和 alarm 转发，并未主动执行这些路径。最终 bundle 的模块求值/编译成本到底提前多少，仍需实测；不能由 entry 已 import handler 推出全套应用已热。

所以提案可能减少路由/跨执行上下文成本，同时把服务端第一次加载搬进 DO。0.55–1.09 秒是旧路径测得的段，不是承诺净收益；若主服务已热、DO 每次冷，净收益可能很小甚至变差。Service Binding 本身也不是一次普通公网绕行，不能仅凭延迟把那段全部命名为网络跳转。[Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)

| 方案 | 能解决什么 | 代价/审查意见 |
|---|---|---|
| 完整 handler 注入，per-run DO 不变 | 去掉显式 self binding 调用，改动范围最小 | 本轮优先实验；补生命周期边界与真实运行时证据 |
| per-plan DO 复用 | 连续对话有机会复用对象/已加载应用 | 不保证保温；当前单一 payload/state、duplicate 判断和无条件 delete 不能直接复用。旧 run 收尾可能删新任务，必须按 token 存任务、调度并栅栏清理（dispatcher `:81`–`:88`、`:137`–`:150`）。每对象只有一个 alarm，要设计多任务调度 |
| 固定少量分片/单例派发 DO | 提高复用机会、可能减少首次加载频率 | 会引入热点、队头等待和多 run 调度；单对象 alarm 不并行，不适合作为当前低延迟方案的顺手小改 |
| 单例心跳保温 | 最多提高该对象短期留存概率 | 不能让其他 per-run 对象或目标 Next isolate 保证热；有费用，不能防运行时回收/重启；不推荐 |
| 独立小 Worker 承载 DO | 缩小派发器执行代码，保留成熟内部路由边界 | 仍有服务调用和目标首次加载；可能比把 Next 移入每个 DO 更好，需比较，不能保证同时消除两段 |
| 抽纯业务执行器直接由 DO 调用 | 长期减少 middleware/HTTP 桥接开销 | 要显式处理 bindings、请求级 Prisma、认证/claim/计费和任务生命周期，超出本轮 setter 方案；不能复制一套业务入口 |

per-plan/分片涉及单 alarm 约束和重调度，见 [Alarms — scheduling multiple events](https://developers.cloudflare.com/durable-objects/api/alarms/#scheduling-multiple-events-with-a-single-alarm)。当前应先检验最小直调是否真的有端到端收益，不把保温、对象复用、业务抽取一起混入 1.1。

**6. 支持的实施边界与必须附带的验收。**

修订提案应先写明：完整 handler 模块级注入；原始完整 env、真实或正确适配的 ctx；每 alarm 独立任务状态；保留 claim、预扣、token 栅栏、accepted/rejected/unknown、payload 删除时机；明确长补齐是尽力而为还是持久交接；保留 self binding 与 Queue 用于对照/回退。直调抛错后不得绕过 claim 重新执行，也不能把所有失败伪造成成功。

| 验收组 | 必须执行的场景 | 通过标准 |
|---|---|---|
| 注入/协议单测 | 模块初始化注册；无注入；完整 env/ctx 传递；200 长流、stale、400/401/503、5xx、fetch/drain 异常；嵌套后台任务 | 缺注入不丢 payload；只在既定完成边界删除；无模块级 ctx 串用；保持原重试/永久失败分类 |
| 真实 workerd | 从未执行默认 HTTP fetch 的 DO 直接 alarm 调完整生成 handler；使用与生产一致的 compatibility flags | 无 `waitUntil is not a function` / Illegal invocation；到达正确路由；cf bindings 和 OpenNext requestId 可用；Hyperdrive/R2 等实际依赖可访问 |
| 后台完成 | 慢 CUT-6、模型立即异常、停止后 stage 栅栏、慢 runLive finish、R2 镜像、两轮真实 61 秒补齐、EOF 后无新入站请求 | 有每项完成/失败/交接证据；必须完成的任务在 alarm 完成前结束或已持久接纳；长补齐不靠 idle 猜测；写回/额外成本不重复 |
| Prisma 并发 | 多个 DO 交错 await；A 空闲 >30 秒由 B prune 后恢复；A 长事务跨 TTL；慢非事务/保留 delegate；后台访问 bindings | requestId/client/ctx 关联正确，无跨请求 I/O 错误、事务被误断、global-pool 回落；空闲淘汰后正常重建 |
| 时限/资源 | 重计划完整运行；12:59 开始慢模型/工具；接近 15 分钟；隔离环境模拟终止/重新投递；并发 1/2/5/10，扩量前含 >10 压力 | 记录总 CPU/墙钟/内存/连接；不突破配置预算；硬杀后不重复 execute/主扣费、不误清新 token，可按既有协议恢复；不宣称强制优雅收尾 |
| 用户流程 | 真正触发运行中刷新/断开观察、停止后继续、多语言、旧 token 迟到、主 run 结束后的补齐被新 run 接管 | 刷新不重执行，停止有效，继续使用新 token；无重复回答、串计划、覆盖新状态；额度错误不计作完成流程 |
| 性能 A/B | Queue、原 DO+self、DO-local 同期同模型同优化版本；轻/重、首次/复用分别统计 | 先小样本排错；正式推广沿联合方案每格 ≥40，报告失败和无 reasoning 样本，不用 5 次成功外推 P95 |
| 回退 | 单独关闭 DO-local 回到 self 路径，再验证新启动切 Queue；观察在途任务 | 保留 DO class/namespace、一次性 claim 与预扣/恢复语义；配置生效及在途处理有证据，不要求删除 namespace |

现有 dispatcher 单测 mock 了整个 `cloudflare:workers` 和内部 fetch（`tests/worker/planRunDispatcher.test.ts:10`–`:19`、`:61`–`:75`），可以继续验证协议，但不能拿它证明 OpenNext/ALS/DO 生命周期兼容。运行时故障演练使用隔离资源，不能调用生产执行入口制造硬杀；这也是联合方案已定边界（`joint-plan-v1.md:49`、`:153`）。

性能必须至少分别记录：DO 接纳/构造、alarm 第一条语句、storage 后、完整 handler 调用前、实际内部路由开始、模型发出/首字节、浏览器首 reasoning、EOF、尾任务结束或交接。用模块实例标识、对象构造次数、handler 首次调用标记区分生命周期，不再用 seq=1 代替全部冷启动证据。比较各段及浏览器总耗时，防止省下的 selfRefHop 被 local 首次加载搬回去。

提案删除的只有后一段；即便后一段归零，按它自己的观测，前段 0.97–1.7 秒仍高于既定派发总段 P50≤300ms。**1.1 有净收益与 Phase 1 派发门槛达标是两件事。** 保留联合方案门槛；若要改门槛，应另行明示决策，不能靠改埋点名称达标。

最终判定：该方向值得做受控实验，核心上下文机制具备静态可行性；先修正文中的生命周期与收益断言，补注入/完成边界和上述证据，再决定推广。目前没有足够依据无条件支持直接上线，也没有证据要求因 DO 不支持 waitUntil/ALS 而否决整个方向。
