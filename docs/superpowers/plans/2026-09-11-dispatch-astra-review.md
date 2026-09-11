# Astra 第二轮：A′ v1 收敛稿

日期：2026-09-11。依据：`scratch/arch-discussion/claude-round2.md`、当前工作区源码及 Cloudflare 官方文档。本轮仅写本文，未改源码、未做 git 操作、未运行测试或生产命令。文件行号对应本轮读取版本；Claude 提供的生产情况和优化基线属于对方报告，未独立复测。下文“约定/门槛”是拟议设计，不是已经实现或已经达到的事实。

**结论：选 A4(a) 同步预扣；接受 v1 暂不实现全局 cap；有条件接受“未知不自动回落”；接受把全面 AbortSignal 改造移出 v1。修正下列协议、恢复与迁移边界后，无致命点。**

本文给出我愿意签字的完整 v1 定稿候选。Claude 第二轮已同意的核心与本文新增细则分别标明；我不代替 Claude 对尚未看到的细则签字。签字范围是实施与受控验证方案，不是生产性能保证。

## 1. 对每条裁决的答复

| 项 | 同意 / 不同意 | 收敛决定与依据 |
|---|---|---|
| A1：一次性 claim | **同意** | 新增 `agentRunStartedAt`，begin 新 token 时置空，内部入口用条件 UPDATE 替换首次 renew；DO、Queue、内联都经过它。当前 renew 只匹配 token 并续租，确实不能阻止同 token 二次执行（`lib/tripPlan/repoPrisma.ts:345`）。保留“每 token 至多一次进入执行体”，不承诺跨 token 外呼恰好一次。 |
| A2：alarm 可重试 | **同意原则；不同意“只剩几毫秒窗口”的量化** | claim 在执行入口，而非 DO，所以 DO 不写执行 started 标记。claim 后到执行完成前任何硬终止都需恢复，不只 execute 前的几毫秒；未测其概率/时长。alarm 至少一次、异常重试最多 6 次的行为有官方依据：[Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)。 |
| A3：per-run DO | **同意** | `idFromName(runToken)`；同 key 幂等接纳，不覆盖、不因重复提交重置 deadline；外部 I/O 不包进长时间 `blockConcurrencyWhile`。 |
| A4：同步还是乱序账本 | **选 (a)，同意你的倾向** | 先确认预扣成功，再派发；同 runRef 幂等。不能只是 await 今天会吞错的 helper（POST 路由 `app/api/me/plans/[id]/agent/route.ts:181`–`:187`）。非管理员预扣失败不运行模型，条件清理本 token。0.3–0.5 秒只作为你的估值，待测。 |
| A5：deadline / 强制取消 | **同意延期全面强制取消；同意提前计算预算，但须定义时钟与过期处理** | `dispatchedAt` 是首次派发前的服务端时间，重试和换 transport 不刷新。它不是 alarm 平台计时起点。现有代码仍仅在循环边界检查（本轮 `lib/planAgent/loop.ts:405`、`:445`），v1 明确允许在途操作跨过软截止，不能写“13 分钟内一定完成”。 |
| A6：分阶段实测 | **同意** | 接受持久接纳、alarm 入口、内部入口的分段埋点与 transport 标记；冷热分类不能继续只用 consumerSeq。当前 seq 仅在 queue 调用递增（`worker/planAgentConsumer.ts:55`、`:79`）。 |
| A7：v1 无全局 cap | **同意用于受控低流量放量，不同意把切回 Queue 称为硬过载保护** | “当前远低于 10 并发”来自 Claude 报告（`claude-round2.md:17`），不是本轮测量。开关只改变后续派发，不撤回已开始的 DO；Queue 自己的 10 并发不包括这些在途 DO（`wrangler.jsonc:36`）。v1 用白名单、有人观察和暂停新启动控制暴露，不新增 admission DO。 |
| A8：消息与响应分类 | **同意消息复用；不同意按 HTTP 状态笼统判断未接受** | `v:1` 必须保留（`lib/planAgent/queueMessage.ts:48`）。只有应用协议明确证明在持久接纳前拒绝，才是 rejected；普通 5xx、throw、断连、无法解析响应都可能是 unknown，不能从“未收到 accepted”推出“没写 storage”。详见 §3.3。 |

### 1.1 A4(b) 不是目前描述的“两处小改”

当前 `settleRun` 入参只有 runRef、actualMicros、hadModelOutput（`lib/billing/service.ts:145`）。完全没有关联账目时，如何确定 userId、planId、periodStart、管理员豁免？append 需要这些字段（`lib/billing/ledger.ts:3`、`:16`）。而“查不到 → append”与 reserve 的检查/追加还须在同一用户锁规则下串行，否则只是把原竞态换了位置。因此 (b) 作为 v1.1 的独立账本协议设计，不在 v1 偷渡。

对“漏收，不是多扣用户”的补充：无 reserve/refund 的结算确实不记成本（`lib/billing/service.ts:164`–`:181`）；我第一轮也没有声称必然双扣。但**推测场景：**结算先成为空操作，随后 reserve 落账，用户余额仍会被这笔孤儿预扣暂时占用（同文件 `:133`）。不能把后果简化为“对用户余额无影响”。选择 (a) 后正常执行不再依赖这个顺序窗口。

### 1.2 “未知不回落”：接受政策，不接受其原论证

选择“不对 DO unknown 自动回落”是可接受的 v1 降级策略，代价是某次启动可能没有执行者，用户需等待恢复。它不是 claim 所要求的唯一安全策略；有共用 claim，unknown 回 Queue 原则上也可去重。这一轮按你的偏好保留不回落，减少恢复分支。

但 **“90 秒后一定 inferInterrupted 并自动续跑”不成立**：

- TTL 检查不清 token（`lib/tripPlan/repoPrisma.ts:389`）。resume 不追加 human（`:301`），而推断首先看旧 stopped 尾日志、再比较最后 human 与日志时间（`lib/planAgent/resume.ts:59`、`:68`）。**推测：**stopped → 手动 resume → DO 实际未收到，TTL 到期仍可能被旧 stopped 日志遮蔽。
- 浏览器 sessionStorage 已有记录时转为手动，不再次自动续（`app/(authed)/plan/[id]/ui.tsx:172`–`:188`）；浏览器离线不会发恢复请求。
- 余额还可能被已成功的预扣占用。resume 要先通过预算预检（POST 路由 `:138`），孤儿清扫阈值是 16 分钟，且活跃性只查 token 是否仍匹配（`lib/billing/service.ts:13`、`:207`；`lib/billing/serverDeps.ts:17`）。**推测：**只剩一次预扣额度的用户可能在 TTL 后拿到 402，而非成功续跑。

因此 v1 必须补最小的“当前 run 身份”恢复判断，以及**确认尚未 claim 的过期 run 的撤销与预扣释放**。不要求为已执行但成本未知的 run 做自动成本猜测，也不要求无人在线自动恢复。

### 1.3 其他裁决与生产事实

- **B 同意暂不拆 worker；C 同意留作对照；D/E 同意不作为 v1 路径；F 同意暂不发工单。** C 的触发条件应看派发总耗时超过门槛，不把未隔离的慢段统称“alarm 冷启动”（Claude 的决定见 `claude-round2.md:29`–`:32`）。
- **不同意“已排除人为 delay”。** 你提供的 CLI 输出不暴露该字段，代码未配置也不等于平台设置不存在（`claude-round2.md:4`）。官方支持 queue-level delay，消息 `delaySeconds:0` 可覆盖它：[Batching, Retries and Delays](https://developers.cloudflare.com/queues/configuration/batching-retries/)。结论改为“未见代码主动加 delay；线上有效设置未核实”。不把继续查 region/delay 作为 A′ 试验的前置阻断。
- **同意主指标是浏览器首次可见 reasoning；接受四轮基线未含 CUT-7 / POST 瘦身为对方提供的基线说明**（`claude-round2.md:45`）。仍须把这两项净省实测与 dispatcher 净省分开记账。
- **数字需更正：**减 1.5 秒是 5.3–5.9 秒；减 1.66 秒是 5.1–5.8 秒。叠加同步预扣后的精确条件区间见 §3.7。这个算术差异不构成架构分歧。

## 2. 致命点裁决

**无致命点——限于落实本文修正后的 v1。** 同 token 双执行的原致命点已有一致解决方向。以下仍是实现/放量阻断条件，不能以“既有问题”名义省略：

1. 所有执行入口共用持久 claim，loser 不执行、不结算、不清 winner；所有在途旧执行者也纳入迁移边界。
2. unknown 不回落时，未 claim 与已 claim 的过期尝试都能被识别为可恢复状态；不得承诺无条件 90 秒自动成功。
3. 非管理员预扣失败不派发；确认未执行的过期尝试能安全撤销并释放已确认的预扣。

这些不是要求重写调度系统，而是让我们共同选定的降级行为确实可用。

## 3. 共同签字的 v1 方案（定稿候选）

### 3.1 范围与文件

v1 定位：**保留现有 agent 执行体和浏览器观察架构，以每 run 一个 DO alarm 替换正常派发；引入 transport 共用的一次性执行领取；允许失败后用户在线时新 token 恢复。** 当前共用执行入口、观察流分别见 `lib/planAgent/execute.ts:53`、`app/api/me/plans/[id]/agent/stream/route.ts:70`。

| 文件 / 新增项 | v1 要做的事 |
|---|---|
| `prisma/schema.prisma` + 一条新增 Prisma migration | `TripPlan.agentRunStartedAt DateTime?`；现有 token/TTL 在 schema `:1017`、`:1018`。不新增任务表，不用 startedAt 猜未 claim 尝试。 |
| `lib/tripPlan/repo.ts`、`repoPrisma.ts`、`repoMemory.ts` | begin 同事务重置 startedAt；新增 `claimAgentRun`，用 token + startedAt IS NULL 原子领取并返回 owner；保留运行期间续租。新增“条件撤销过期且未 claim 的本 token”能力，撤销必须与 claim 在同一 TripPlan 行上竞争。 |
| 新增 `worker/planRunDispatcher.ts` | per-run DO；完整载荷持久接纳与设 alarm；幂等 fetch；alarm await 自引用请求及读流；检查 HTTP/协议结果，记录重试/失败，仅清本 run 数据。 |
| `worker/entry.ts`、`wrangler.jsonc`、`lib/anitabi/cf/bindings.ts`、相关 Worker env 类型 | 导出新 DO、增 binding、保留 v1 migration 并追加 `v2 new_sqlite_classes`（若实施时已用该 tag，则选下一个唯一 tag）；现有 self binding 继续用。新增派发、白名单和启动暂停开关。 |
| `lib/planAgent/queueMessage.ts` | 在完整 v1 消息上加可选 `dispatchedAt` / `transport` 及计时关联信息；旧消息缺字段兼容，字段存在但非法则拒绝；tier 和 enqueuedAt 的现有含义不变。 |
| POST 路由、内部 run 路由、必要的 `lib/planAgent/dispatch.ts` 共用帮助模块 | 同步幂等预扣；所有 execute 前 claim；DO 三分类；Queue/SSE 降级；内联 loser 在 finally 之前早退；维护现有结构化回答直写顺序。业务逻辑尽量放共用模块，路由只接线。 |
| `lib/billing/service.ts`、必要的 ledger 接口/实现，以及新增 `lib/planAgent/runAdmission.ts` 事务协调模块 | reserve 在用户锁内按 runRef 幂等，提交前在同一事务中检查本 token 仍有效且未 claim；撤销未 claim run 与 open reserve 退款在同一 DB 事务提交。通过事务作用域 repo 适配器协调，不在外层事务内再嵌套开启另一笔 ledger 事务。无 reserve 的乱序结算重构不做。 |
| `lib/tripPlan/handlers/planById.ts`、`lib/planAgent/resume.ts`、相关读取 DTO / POST resume 校验 | GET/watch 和 canResume 共用当前 token/TTL/该 token 终态证据；避免旧 stopped 日志遮蔽后来发起的 resume。故障恢复路径必要时退款后重读 account，不能使用退款前的并发查询结果。 |
| `lib/planAgent/runTimings.ts`、前端 `app/(authed)/plan/[id]/ui.tsx` 及相应观察 hook | transport 分段计时；接纳 unknown 的可观察状态；本轮 reasoning 第一次实际渲染的浏览器埋点；兼容 `{queued:true, runToken}`，不把 queued 字段当平台接纳证明。 |
| `tests/worker/`、`tests/tripPlan/`、`tests/planAgent/`、`tests/billing/`、相关 API 测试 | 添加下面的并发、故障和协议覆盖；真实数据库并发验证 claim，不仅测 memory double。DO 长流/迁移演练另在隔离 Cloudflare 环境验证。 |

### 3.2 必须保持的运行不变量

1. **一个 token 至多领取成功一次。** claim 不在 DO 中做；它属于最终执行入口。begin 生成新 token 才能重置 startedAt。运行中 renew 不检查 startedAt IS NULL，否则执行者将无法续租。stop/end 不把旧 token 恢复成可领取状态。
2. **预扣成功先于派发。** 管理员沿用豁免（`lib/billing/service.ts:128`）。非管理员失败/结果未确认时不发 DO、Queue 或内联执行；查清同 runRef 的账本结果，不能盲目再追加 reserve。reserve 提交前在同一事务中检查 token 仍为本 run、尚未 claim 且租约未过期，并与撤销操作采用同一锁顺序；不能在事务外查 token、事务内只记账，否则迟到 reserve 可在撤销后重新扣款。失败路径只条件处理自己 token，不释放新 run；涉及已确认预扣时使用下述原子撤销/退款。由于人类消息已在 begin 落库，重试应走 resume，不要求用户重复发送同一消息。
3. **claim loser 没有执行副作用。** 不调用 execute、不结算、不释放租约；内联路径提前 return，不能进入现有无条件 finally（POST 路由 `:283`）。已由其他 transport 领取时，返回兼容 202 让前端观察；已终态/stale 时让前端读取最终状态，不伪造业务成功。
4. **恢复是接管，不是同 token 重放。** 使用当前 plan 的 token/TTL 和按 runToken 对应的日志。TTL 过期且 token 仍在、该 token 尚无终态证据时，GET/watch 显示可恢复；旧 stopped 日志不能遮蔽它。主动 stop 清 token（`lib/tripPlan/repoPrisma.ts:359`），无新尝试时仍不得自动续跑。terminal 判定需兼容 interrupted 的既有续跑语义。
5. **未 claim 的过期 run 可以安全撤销。** 用户在线发起恢复时，在**同一数据库事务**内，以 `id + token + startedAt IS NULL + TTL已过期` 条件更新使旧 token 失效，并退款其已确认 open reserve；两者一起提交或一起回滚，之后才进行新 run 的账户预检/预扣。若事务响应丢失，以 token/账本现状核对结果，不再追加退款。如果旧 claim 先赢，撤销条件失败，绝不能按“没运行”退款。恢复发生在故障慢路径，不给正常 POST 再加全局扫描。撤销后新 token 接管，迟到 alarm 必须 stale。
6. **已 claim 的失联 run 不猜实际成本。** 保留既有日志/计费和新 token 恢复方式；可恢复状态不保证预算一定允许，也不保证自动退回全部预扣。余额阻断、结算不明或清理失败必须显式暴露并可核对，不能无限“思考中”。16 分钟清扫不是无条件退款保证（`lib/billing/service.ts:202`；`lib/billing/serverDeps.ts:17`）。无人在线自动扫尾仍不在 v1。

第 4–5 条是本轮补齐的最小恢复细则，需要 Claude 确认；它们不要求新增第二个时间字段。当前 begin 使用用户 advisory lock（`lib/tripPlan/repoPrisma.ts:285`），账本另开事务（`lib/billing/ledgerPrisma.ts:90`）；新协调模块统一使用“用户锁 → TripPlan 行”的顺序，让迟到 reserve 与撤销/退款串行，不能把两次现有 service 调用误当成一笔事务。并发读取不得混用 T1 的 TTL 与 T2 的 token；真正 resume 时仍由事务性 begin/claim 决定谁赢，观察状态本身不授予执行权。

### 3.3 派发与回退协议

**先把两个边界分开：POST→DO 的接纳结果，DO→内部路由的执行结果。** 202 表示应用记录并接手这一尝试，不等于内部规划已成功。

| POST → DO 结果 | 严格定义 | v1 行为 |
|---|---|---|
| accepted | 收到有效 `{accepted:true}`；DO 已可靠提交载荷与 alarm，或确认同 run 已接纳 | 202 `{queued:true, runToken, dispatchState:'accepted'}`；不再发 Queue。 |
| rejected | 自有协议证明在持久接纳前拒绝；仅有状态码不足以证明 | 对适合降级的派发不可用原因尝试 Queue；非法消息/鉴权错误直接失败并清理未执行尝试，不通过 Queue 绕过校验。 |
| unknown | 超时、断连、一般 throw/5xx、响应格式不明，无法证明已接纳或未接纳 | 不自动发 Queue/SSE；202 `{queued:true, runToken, dispatchState:'unknown'}`；记录告警，观察/恢复按 §3.2。**不宣称“DO 未写入”。** |

DO 的接纳请求设**拟议 5 秒客户端等待预算**，超时归 unknown；这个数是 v1 操作取舍，非平台 SLA。调用方取消等待不等于远端取消持久化。unknown 不可占用 POST 直至客户端无限等待。

未启用 DO、绑定不可用，或可降级的明确 rejected，走现有 Queue；Queue.send 成功返回 202。Queue.send 失败/接受状态未知时，v1 可以保留现有 SSE fallback，但必须先共用 claim，且不重复 reserve。保留两种 unknown 策略的差异是有意的：DO 是新增路径，按 Claude 提议不猜测重派；Queue/SSE 保留既有体验，安全依据改为 claim。当前 Queue.send catch 及 SSE 路径见 POST 路由 `:231`、`:237`。

DO alarm 内部：沿用内部密钥，认证/格式错误视为永久故障并告警；临时 5xx、fetch/drain 中断可抛出交由平台有限重试，同 token 再进只会 winner 或 skipped。收到 skipped 即结束这次派发，不清 winner 租约。`done` 只说明流结束，业务结局仍看 run 日志；当前内部路由 catch 后也会写 done（`app/api/internal/plan-agent/run/route.ts:179`–`:183`）。payload 不在发请求前删除；完成后清本 run payload，避免永久保存消息正文。重复接纳/已清理后的迟到请求也必须靠数据库 claim 保持安全，不依赖 DO 内存标记。

### 3.4 期限、开关与上线顺序

**期限约定：**新消息的 `dispatchedAt` 在成功预扣后、首次 transport 调用前设置；降级与重试原样携带。内部路由用该时刻 + 13 分钟作软截止。旧消息缺它时保留原入口起算方式，避免发布期间静默改变老载荷语义。已经过期的新消息不得调用模型/标题/工具；必须走能记录 interrupted、对已确认未产出者退款并条件释放租约的结束分支，不能裸 return 留下 busy。若已被别的执行者领取，仍只 skipped。全面取消在途模型/工具不做；alarm/Queue 15 分钟平台墙钟依旧存在：[Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)。

**开关约定：**

- `PLAN_AGENT_DISPATCH=queue|do`：默认 queue；只选择新 run 的正常派发方式，不关闭内部执行入口，也不绕开 claim/同步预扣。
- `PLAN_AGENT_DO_CANARY_USER_IDS`：服务端白名单；do 模式下未命中仍走 Queue。v1 从单个测试账号开始。
- `PLAN_AGENT_STARTS_PAUSED=1`：在 begin/预扣前拒绝新消息和 resume；保留 stop、GET/watch。用于迁移排空和明确过载；不是把现有 Queue 开关置 0，因为那会落回内联（POST 路由 `:203`、`:237`）。
- 既有 `PLAN_AGENT_QUEUE_ENABLED` 只控制 Queue 是否可用；新代码要定义优先级，不能 queue 模式 + disabled 时意外选 DO。生产基线设为 1；本地无绑定才使用内联。

这些若用 Wrangler vars 实现，变更需要配置发布并等待生效，不是已经存在的即时控制面。切 queue 不取消在途 DO；必要时先暂停新启动，再处理在途。

**上线顺序（拟议操作，本轮未执行）：**

1. 在隔离 Worker、DO namespace 和测试 DB 完成 schema/claim/预扣/故障演练，禁止测试 binding 指向生产内部执行入口。
2. 先具备启动暂停能力，并确认对新启动生效；让原 Queue 积压和正在执行的旧 run 排空。核对内部在途调用、账本与未结束 token，不能只等固定 13 分钟就假定排空。
3. 执行新增 nullable 字段迁移，部署所有 transport 使用 claim 的版本、DO 类/binding/migration；仍暂停新启动、dispatch=queue。保留旧 DO 类和历史 migration。
4. 核对无旧执行者、无可再次投递的遗留活跃 token；对确认已失联的遗留 token 做条件失效/恢复处理后才开放。**推测风险：**旧 run 已在运行，迁移后 startedAt 默认 NULL，新重复消息会成功 claim，形成旧执行体 + 新执行体；因此只“加 nullable 字段然后渐进放量”不够。当前旧代码没有写 startedAt（`lib/tripPlan/repoPrisma.ts:293`、`:345`），这项切换检查是一次性成本。
5. 解除暂停，先全部走 Queue 验证新 claim/计费基线；再单账号 do，观察完整长 run 与故障恢复；最后逐步扩大白名单。达不到 §3.6 门槛就停止扩大，不把 D=100ms 当先验事实。
6. 回退：新 run 切 queue，保留 claim、恢复修正、同步预扣、新 schema 和 DO 导出；已接受 DO 继续完成或按恢复规则处理。严重正确性问题先暂停新启动。不要回滚到无 claim 的旧执行器，也不要删除 namespace。

DO 生命周期变更需真实部署应用，旧 migrations 仍可用，不必顺带迁到 exports；版本 rollback 不能跨 DO 类生命周期变更。[Class exports / migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)、[Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)。以上排空顺序是本轮新增的签字细则。

### 3.5 故障演练清单

全部为未来实施验收；本轮没有运行这些演练。注入故障与真实长流都需在隔离环境先做。

| 场景 | 必须观察到的结果 |
|---|---|
| 同 token 两个内部请求并发；DO 与 Queue 重复派发；Queue.send unknown 后 SSE | 只有一次 claim 成功及一次 execute 入口；loser 不运行模型/标题/工具、不结算、不 endAgentRun。 |
| DO 接纳已提交但 accepted 响应丢失 | POST 标 unknown；无自动第二 transport；DO 可正常执行；重复消息不再执行。 |
| DO 实际未收到，普通消息 / stopped 后手动 resume 两种 | TTL 后可恢复，不被旧 stopped 日志遮蔽；未 claim 的旧 token 先失效、预扣幂等释放，新 token 才运行；迟到 alarm stale。 |
| 前项用户余额仅够一次预扣 | 故障恢复退款后重读账户，不因旧预扣永久阻断新尝试；不以等待 16 分钟清扫作为唯一办法。 |
| claim 成功后、execute 前硬杀；模型中硬杀；自动 resume 后再硬杀 | 不允许同 token 再进；在线恢复可用或明确手动/预算阻断；没有无限自动循环，也不假装成本已完整结算。 |
| stop T1 后立即新建 / resume T2；T1 随后返回或 alarm 重试 | T1 不删除 T2 的 DO payload，不释放 T2 租约、不覆盖 T2 的状态；主动停止且无新尝试时不自动启动。 |
| 同 runRef 重复 reserve；reserve 明确失败；提交结果不明 | 至多一笔主 reserve；未确认预扣不派发；查账/清理只作用本 token，不误动新 run。 |
| 撤销更新之后、退款写入之前硬杀；事务提交后响应丢失；原 reserve 延迟超过 TTL | 撤销与退款一起回滚或一起成功，可重试核对；迟到 reserve 不能在 token 已撤销后落账；没有“token 丢了而退款无法重试”的余额挂起。 |
| 内部 400/401/503、body 中断、alarm 平台重试、存储后响应前故障 | 分类与 §3.3 一致；有失败记录；skipped 不等于业务成功；不得悄悄抛弃仍需处理的 payload。 |
| dispatchedAt 已过期；12:59 时模型/工具仍慢 | 过期新任务不开始外呼；慢调用可超过软截止的既有限制明确记录；硬终止后恢复/计费状态可检查，不要求此版强制取消。 |
| 浏览器刷新、切后台、离线；观察流断开后重连 | 后台执行独立继续；重连看到同 run；仅断观察不触发第二次执行。 |
| 10 个以上计划的隔离压力演练；切 queue / starts paused | 实测 DB/模型错误和尾延迟；确认开关只影响新启动，在途 DO 不会立即降至 10；暂停生效后不再创建新 run。 |
| schema 新增时仍有旧 run / 旧 Queue 消息；发布中断再恢复 | 上线流程挡住混合执行风险；未排空不开放；不能用空 startedAt 给旧活跃 token 再发执行权。 |

### 3.6 验收指标与门槛

**主终点：**浏览器发送本次请求时刻 → **本轮非空 reasoning 首次实际渲染**。用同一浏览器单调时钟记差，不拿服务端 epoch 直接与浏览器时钟相减。不计占位 status、旧 run reasoning、仅 SSE 收包或 React setState 调用。没有 reasoning 的答案型响应单列，不当 0ms，不混入 reasoning 分位数；同时报告全部有效启动中其占比、失败/未展示率。

**辅助终点：**POST 到有效响应、dispatch 请求到持久接纳回执、首次派发到 alarm 入口、内部入口到首模型 delta、首 reasoning 写库、用户终态、unknown 到可恢复。跨 isolate 时间戳作诊断，不能无校验地当精密单机计时；分段总和也不能与并行阶段重复相加。当前原始 delta 与可见 reasoning 有合并/落库差异（`lib/planAgent/eventCoalescer.ts:34`；`lib/planAgent/runLive.ts:49`），因此主终点必须在浏览器测。

以下是 **Astra 提议的推广门槛，需 Claude 确认；不是由四个样本推导出的平台保证**：

| 项 | v1 推广门槛 |
|---|---|
| 正确性 | §3.5 全部通过；同 token 重复 execute、误清新 token、重复主预扣均为 0。发现任一项即暂停新启动，先修复。 |
| DO 派发总段（首次派发前 → alarm 入口） | 样本 P50 ≤ 300ms，P95 ≤ 1000ms；新 DO 创建和已有 DO 重入分别报告。accept 往返并行于 alarm 时不重复加到总段。 |
| 主终点相对同期 Queue 对照 | 同模型/同优化版本、按轻重计划分层：P50 至少改善 2.0s，P95 至少改善 1.0s；任一层尾延迟恶化不推广。把同步预扣同时应用在两组，另报相对原生产异步预扣版本的净收益。 |
| 启动可用性 | 白名单正常样本中未接纳、unknown、无 reasoning 且无终态的异常要逐条解释；不得通过只统计成功快样本掩盖失败。正常样本若出现无法解释的派发丢失或恢复挂死，不扩大白名单。 |
| 无 cap 的运行边界 | 起步人为控制测试账号同时 1 个 run，逐步测到 10；正常运行若观察到总活跃 run ≥ 10、持续队列积压或新增 DB/模型限流，就暂停扩量，切 queue；若压力仍上升，暂停新启动。此为操作门槛，不冒充全局并发锁。 |

样本规则：第一批每层少量端到端样本只用于排错；对主终点准备轻/重 × 两条路径每格至少 40 个可比启动，记录同期失败数，使用固定分位数计算方法；冷热另分桶，不把样本不足的桶写成可靠 P95。40 个样本的 P95 仍仅是推广筛选，非长期 SLA；统计不稳定就延长观察。正式放量还需至少覆盖一个完整使用周期和长 run，不以四次手测替代。

6 秒可作为下一阶段主终点的产品目标，但不先设成未实现两项优化之前的否决阈值。若 DO 派发达标、用户首 reasoning 不改善，先查观察/模型段，不继续宣称成功省掉派发即达成目标。

### 3.7 诚实的收益区间

使用第一轮表中四个逐行基数：6953 / 7415 / 6805 / 6816ms（`scratch/arch-discussion/astra-round1.md` §4；原始数据 `scratch/arch-discussion/claude-proposal.md:21`–`:24`）。它们**已经包含假设 D=100ms 及可见余量 R=500ms**。M 已包含模型 TTFT，不另加。同步预扣 K=300–500ms 来自你的估值（`claude-round2.md:14`），以下全是**推测情景**：

| 样本 | 仅 A′ 派发 + 同步预扣，尚未计额外优化 | 另有独立净省 1660ms 的优化落地后 |
|---|---:|---:|
| 1 轻 | 7.253–7.453s | 5.593–5.793s |
| 2 重 | 7.715–7.915s | 6.055–6.255s |
| 3 轻 | 7.105–7.305s | 5.445–5.645s |
| 4 重 | 7.116–7.316s | 5.456–5.656s |

所以 **v1 派发改造本身约 7.1–7.9 秒；两个独立优化也兑现后约 5.4–6.3 秒**。对外用 5.5–6.5 秒作为后一情景的粗略目标也可以，但要明确包含哪些优化，不把它叫 A′ 自身的已验证收益。你写的 5.6–6.4 秒可视为保守近似，推导却混用了 1.5 与 1.66，应改用表格。

相对原样本的派发净节省为 `Q−D−K`：约 **2.15–2.35 / 4.63–4.83 / 5.39–5.59 / 6.69–6.89 秒**。这还没有为位置变化、额外冷启动、幂等预扣检查等新增净开销定价。内部 claim 替换 renew 可以不新增一次往返；内联则原本没有这次入口 claim，不能也声称免费。

若 D=1s，每格加 0.9s：仅 A′ 约 8.0–8.8s，叠加两项优化约 6.3–7.2s。DO 接纳往返若已经计入 D，不能又在 K 中加一次；如果预扣/持久化真实成本超出假设，或首 delta 不是首 reasoning，按实测修正。**这些是四个样本的范围，不是 P50/P95。**

## 4. 仍有分歧

核心架构已收敛：A4(a)、per-run DO、共用 claim、低流量 v1 不做 cap、全面 AbortSignal 后置，均可按双方已表达的方向推进讨论。尚需 Claude 对以下具体文字点头，不能写成两人已经签署：

1. **拒绝分类：**只承认协议证明的接纳前拒绝；一般 5xx/throw 归 unknown。你的 `claude-round2.md:23` 必须改写。
2. **恢复范围：**保留 unknown 不回落，但把当前 token 恢复判断、未 claim 撤销/退款纳入 v1；撤回“90 秒必然自动成功”。这比完全沿用现有 resume 多一点代码，是该政策的最小闭环。
3. **初次迁移与运行门槛：**先暂停/排空旧执行者，再启用 claim；接受 §3.6 的具体门槛和有值守放量，或提出等效数值。仅加类、开关 queue 并不足以证明旧 token 不会二次领取。

delay 的线上归因和 0.16 秒算术纠正不必阻止试验，只要报告保持证据边界。其他未知值交给验收，不要求在设计签字之前猜出答案。

**签字栏：**

- **Astra：同意本文 v1 定稿候选，用于实现与受控验证；签字条件为上述契约不被删减。**
- **Claude：核心方向依据第二轮回应已同意；本文新增恢复、迁移及门槛细则待其确认，未代签。**

## 5. v1 明确不做

- 无人在线时的自动恢复、持久 outbox、任务调度表或完整执行历史重构。
- A4(b) 无预扣时直接结算、乱序账本协议；也不自动猜测被硬杀 run 的真实外呼成本。
- 全局 admission DO / 严格跨 DO+Queue 的 10 并发保证。后续即使加单例计数，Queue 执行也须领取同一容量许可；“超额转 Queue”本身不是总 cap。
- 全面模型/工具 deadline AbortSignal 改造；不把沿用软截止包装成 15 分钟内必定优雅收尾。
- 独立消费者 Worker、Workflows 主链路迁移、DO.fetch 返回后 waitUntil 长任务、观察流给内联 POST 保活。
- 队列 region 工单和对“北美 v1”的事实断言。
- 重写观察流轮询架构；CUT-7 与 POST 瘦身作为独立优化验收，不与派发收益混记。
- 原样回滚到无 claim 的执行器、删除新 namespace、用生产账号直接做破坏性故障演练。

本轮到此形成可供双方逐项确认的 v1 文本；尚未取得 Claude 对新增细则的签字，也尚未证明实现可上线。
