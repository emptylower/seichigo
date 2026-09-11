# /plan Agent 派发优化：联合方案 v1

日期：2026-09-11｜作者：Claude、Astra｜状态：双方同意，按阶段实施与验收。

我们将先补齐所有执行入口的一次性 claim、同步幂等预扣与在线恢复，再以每次 run 独立的 Durable Object alarm 替换正常 Queue 派发，保留 Queue/SSE 降级和现有观察流，解决同 token 重复执行隐患并减少首字等待。**推测情景：**派发改造与同步预扣落地后首 reasoning 约 **7.1–7.9 秒**；CUT-7、POST 瘦身另行兑现 1.66 秒净省后约 **5.4–6.3 秒**。代价包括新增数据库字段与 DO 类、一次同步预扣约 **0.3–0.5 秒（推测）**、迁移排空及故障演练；三个阶段合计约 **7–11 人日（推测）**，不含等待真实流量形成样本的日历时间和未测定的运行资源费用。收益以端到端验收为准。

定稿依据：`scratch/arch-discussion/astra-round2.md` §3、§5；Claude 已接受全部不变量、协议、门槛与收益表，并提出三阶段实施（`scratch/arch-discussion/claude-round3.md:3`、`:8`、`:13`）。本稿只确定方案，未实施或部署。

## 1. 分阶段实施与验收

每阶段使用独立实施分支、部署记录和安全回退点。**Phase 0 不依赖 DO；Phase 1 依赖 Phase 0；Phase 2 依赖前两阶段。** 回退始终保留已经生效的安全不变量，不退回无 claim 的执行器，不删除新 namespace。启动暂停能力作为 Phase 0 的迁移前置项先提供，Phase 1 复用。

### Phase 0 — 与派发方式无关的正确性底座

**范围（文件级）：**

| 文件 | 改动 |
|---|---|
| `prisma/schema.prisma`、新增 Prisma migration | `TripPlan.agentRunStartedAt DateTime?`。 |
| `lib/tripPlan/repo.ts`、`repoPrisma.ts`、`repoMemory.ts` | begin 在同事务重置 startedAt；新增 token + startedAt IS NULL 的原子 `claimAgentRun`，返回 owner 并续租；保留运行期 renew；提供过期未 claim run 的条件撤销。 |
| `app/api/me/plans/[id]/agent/route.ts`、`app/api/internal/plan-agent/run/route.ts` | Queue/内联共用 claim；内部入口替换首次 renew，内联 loser 在 finally 前返回；同步预扣成功后才能派发，失败只处理本 token。保留结构化回答直写顺序。 |
| `lib/billing/service.ts`、必要的 ledger 接口/实现、新增 `lib/planAgent/runAdmission.ts` | reserve 按 runRef 幂等；事务内核验 token、claim 状态、TTL；撤销与退款同 DB 事务。统一用户锁 → TripPlan 行，不嵌套独立 ledger 事务。 |
| `lib/tripPlan/handlers/planById.ts`、`lib/planAgent/resume.ts`、相关 DTO / resume 校验 | 当前 token/TTL + 对应终态日志统一决定可恢复性；旧 stopped 日志不遮蔽新尝试；未 claim 过期 run 撤销退款后重读账户。 |
| `lib/planAgent/queueMessage.ts`、内部 run 路由 | 完整 v1 载荷新增可选 dispatchedAt；新消息按它计算软截止，旧消息缺字段沿用入口起算。 |
| POST 路由、`wrangler.jsonc` | 提前提供 `PLAN_AGENT_STARTS_PAUSED`，迁移期间保留 stop/观察能力；保持 Queue 为生产路径。 |
| `tests/tripPlan/`、`tests/planAgent/`、`tests/billing/`、`tests/worker/`、相关 API 测试 | 共用 claim、计费和恢复的并发/故障测试，包含真实数据库领取竞争。 |

**上线顺序：**隔离环境验证 → 暂停新启动且确认生效 → 排空旧 Queue 消息和旧执行者 → 核对遗留 token/账本 → 新增字段并上所有入口使用 claim 的版本 → 再核对无活跃旧 token/旧执行者 → 开放 Queue 基线。失联遗留 run 先按条件失效/恢复处理；不以固定等待时长代替核对，不让迁移后的 NULL startedAt 授予旧活跃 run 第二次执行权。

**验收门槛：**下方 F1、F3–F8、F10–F13 的非 DO 部分全部通过；重复 execute、误清新 token、重复主预扣均为 0；未 claim 恢复退款与迟到 reserve 的竞争结果可验证。Phase 0 以正确性验收，不要求改善延迟。

**回退方式：**暂停新启动，保留 stop/GET/watch；存在已验证的 Phase 0 安全版本时回到该版本，保留新字段与 claim/预扣/恢复契约；尚无安全基线时保持暂停并前向修复，不回到无 claim 的旧执行器。

**工作量：4–6 人日（推测）**，含事务协调、兼容迁移、并发验证与一次排空演练。

### Phase 1 — DO 派发器，默认 Queue，单账号 canary

**范围（文件级）：**

| 文件 | 改动 |
|---|---|
| 新增 `worker/planRunDispatcher.ts` | `idFromName(runToken)`；完整载荷与 alarm 可靠接纳；重复提交不覆盖；alarm await 自引用内部请求和 drain，分类响应/故障，仅清本 run payload。 |
| `worker/entry.ts`、`wrangler.jsonc` | 导出与绑定新 DO；保留既有 migration，追加 `v2 new_sqlite_classes`（实施时若 tag 已占用，使用下一个唯一 tag）；保留 self binding、Queue。 |
| `lib/anitabi/cf/bindings.ts`、Worker env 类型、必要的 `lib/planAgent/dispatch.ts`、POST 路由 | DO 绑定类型、派发选择、5 秒接纳等待预算、accepted/rejected/unknown 协议及 Queue/SSE 降级；复用 Phase 0。 |
| `lib/planAgent/queueMessage.ts`、`lib/planAgent/runTimings.ts`、内部 run 路由、`worker/planAgentConsumer.ts` | transport、持久接纳、alarm/消费者入口、内部入口等分段计时及关联字段；保持旧载荷兼容。 |
| `app/(authed)/plan/[id]/ui.tsx`、相关观察 hook | unknown 可观察状态与本轮 reasoning 首次实际渲染埋点；兼容 queued/runToken 响应契约。 |
| `tests/worker/`、`tests/planAgent/`、相关 API/前端测试 | DO 接纳、重试、重复派发、观察断连及平台长流演练。 |

**上线顺序：**隔离 Worker/DO namespace 先验证，测试绑定不指向生产执行入口 → 部署 DO 类，dispatch=queue → 建立安全回退基线 → 单个白名单账号启用 DO、同时人为控制 1 个 run → 观察完整长 run 和恢复。不开启未经验证的全量 DO。

**验收门槛：**F1–F13 涉及 DO 的部分全部通过；DO 派发总段 P50 ≤ **300ms**、P95 ≤ **1000ms**；新 DO 创建/已有 DO 重入、冷热分别报告。正常样本出现无法解释的丢失、恢复挂死或计费错误，不扩大白名单。

**回退方式：**新 run 切回 queue 或清空 DO 白名单，保留 Phase 0、DO 类、binding 与 namespace；已接受 DO 继续完成或按恢复协议处理。严重正确性问题先暂停新启动。不得跨 DO 类生命周期变更回滚到旧版本；配置回退需等待发布生效。

**工作量：2–3 人日（推测）**，含 dispatcher、端到端埋点及隔离故障演练。

### Phase 2 — 按端到端收益放量

**范围（文件级）：**调整 `wrangler.jsonc` 对应派发/白名单配置；使用 Phase 1 的 timings 和浏览器埋点形成分层验收记录。本阶段不新增执行架构；CUT-7、POST 瘦身另行验收。

**验收门槛：**同模型、同优化版本的轻/重计划对照中，浏览器首次可见 reasoning 的 **P50 改善 ≥2.0 秒、P95 改善 ≥1.0 秒**；任一层尾延迟恶化不推广。轻/重 × DO/Queue 每格 **≥40 个可比启动**，记录同期失败；统计不稳定则继续观察。完整规则见 §3。

**放量顺序：**保持单账号基线 → 小批扩大白名单并观察完整使用周期和长 run → 达标后继续扩大；未达标停在 canary。正常运行总活跃 run ≥10、持续积压或新增 DB/模型限流时暂停扩量、切 queue，压力继续上升则暂停新启动。

**回退方式：**收缩至上一批已验证白名单，或新 run 全部切 queue；保留 Phase 0/1 安全基线。切 queue 不取消在途 DO，也不立即把全局并发降至 10。

**工作量：1–2 人日（推测）**，用于数据复核、分批放量与回退演练；自然流量采样等待不计入人日。

## 2. 六条不变量（原样保留）

以下“POST 路由”指 `app/api/me/plans/[id]/agent/route.ts`；源码行号沿用双方签署的第二轮审查依据。

1. **一个 token 至多领取成功一次。** claim 不在 DO 中做；它属于最终执行入口。begin 生成新 token 才能重置 startedAt。运行中 renew 不检查 startedAt IS NULL，否则执行者将无法续租。stop/end 不把旧 token 恢复成可领取状态。
2. **预扣成功先于派发。** 管理员沿用豁免（`lib/billing/service.ts:128`）。非管理员失败/结果未确认时不发 DO、Queue 或内联执行；查清同 runRef 的账本结果，不能盲目再追加 reserve。reserve 提交前在同一事务中检查 token 仍为本 run、尚未 claim 且租约未过期，并与撤销操作采用同一锁顺序；不能在事务外查 token、事务内只记账，否则迟到 reserve 可在撤销后重新扣款。失败路径只条件处理自己 token，不释放新 run；涉及已确认预扣时使用下述原子撤销/退款。由于人类消息已在 begin 落库，重试应走 resume，不要求用户重复发送同一消息。
3. **claim loser 没有执行副作用。** 不调用 execute、不结算、不释放租约；内联路径提前 return，不能进入现有无条件 finally（POST 路由 `:283`）。已由其他 transport 领取时，返回兼容 202 让前端观察；已终态/stale 时让前端读取最终状态，不伪造业务成功。
4. **恢复是接管，不是同 token 重放。** 使用当前 plan 的 token/TTL 和按 runToken 对应的日志。TTL 过期且 token 仍在、该 token 尚无终态证据时，GET/watch 显示可恢复；旧 stopped 日志不能遮蔽它。主动 stop 清 token（`lib/tripPlan/repoPrisma.ts:359`），无新尝试时仍不得自动续跑。terminal 判定需兼容 interrupted 的既有续跑语义。
5. **未 claim 的过期 run 可以安全撤销。** 用户在线发起恢复时，在**同一数据库事务**内，以 `id + token + startedAt IS NULL + TTL已过期` 条件更新使旧 token 失效，并退款其已确认 open reserve；两者一起提交或一起回滚，之后才进行新 run 的账户预检/预扣。若事务响应丢失，以 token/账本现状核对结果，不再追加退款。如果旧 claim 先赢，撤销条件失败，绝不能按“没运行”退款。恢复发生在故障慢路径，不给正常 POST 再加全局扫描。撤销后新 token 接管，迟到 alarm 必须 stale。
6. **已 claim 的失联 run 不猜实际成本。** 保留既有日志/计费和新 token 恢复方式；可恢复状态不保证预算一定允许，也不保证自动退回全部预扣。余额阻断、结算不明或清理失败必须显式暴露并可核对，不能无限“思考中”。16 分钟清扫不是无条件退款保证（`lib/billing/service.ts:202`；`lib/billing/serverDeps.ts:17`）。无人在线自动扫尾仍不在 v1。

## 3. 共用协议、开关与验收

**事务边界：**共享用户锁 → TripPlan 行的顺序；reserve 有效性检查、撤销与退款使用事务作用域 repo。恢复读取不混用不同 token 的 TTL/日志；真正执行资格始终由 begin/claim 的原子条件决定。

**接纳协议：**区分 POST→DO 接纳与 DO→内部路由执行。DO 接纳等待预算为 5 秒，取消等待不代表远端未提交。

| 结果 | 判定 | 行为 |
|---|---|---|
| accepted | 有效 accepted:true，载荷/alarm 已可靠提交或同 run 已接纳 | 202 `{queued:true, runToken, dispatchState:'accepted'}`；不再派发其他 transport。 |
| rejected | 应用协议明确证明持久接纳前被拒；不能仅凭状态码 | 可降级的派发不可用走 Queue；非法消息/鉴权错误直接失败并条件清理，不绕过校验。 |
| unknown | 超时、断连、一般 5xx/throw、响应不可解析 | 202 `{queued:true, runToken, dispatchState:'unknown'}`，记录告警；不自动回落 Queue/SSE，沿在线恢复处理，不承诺 90 秒必然自动成功。 |

未启用 DO、绑定不可用或可降级 rejected 时走 Queue；Queue.send 失败/unknown 可保留 SSE fallback，但必须共用 claim、不重复预扣。alarm 内部认证/格式错误永久告警，临时错误和 drain 中断可交平台有限重试；skipped 只终止这次派发，不动 winner。done 只表示流结束，业务结局看日志；payload 不在发请求前删除，完成后只清本 run 数据。

**软截止：**dispatchedAt 在成功预扣后、首次派发前取服务端时间，降级/重试不刷新；deadline=dispatchedAt+13 分钟。旧消息缺字段沿用入口起算；新字段非法拒绝。已过期的新消息不调用模型/标题/工具，应按领取结果走 interrupted、适用退款与条件释放；loser 只 skipped。不承诺在途慢操作被软截止强制取消。

| 开关 | 优先级与作用 |
|---|---|
| `PLAN_AGENT_STARTS_PAUSED=1` | 最高优先级，在 begin/预扣前拒绝新消息及 resume；保留 stop、GET/watch。Phase 0 先具备。 |
| `PLAN_AGENT_DISPATCH=queue` / `do` | 默认 queue；只选新 run 的正常派发方式，不关闭内部入口、不绕过 claim/预扣。 |
| `PLAN_AGENT_DO_CANARY_USER_IDS` | do 模式下仅服务端白名单走 DO，其余走 Queue。 |
| `PLAN_AGENT_QUEUE_ENABLED` | 只控制 Queue 可用性；生产基线为 1；不得因 Queue disabled 意外选择 DO，无队列时按内联降级规则处理。 |

开关若用 Wrangler vars 实现，需配置发布并等待生效；不是即时控制面。DO schema 生命周期变更与普通配置回退分开，保留既有 migrations，不顺带改为 exports（沿用已签署 `astra-round2.md` §3.4）。

**主终点：**同一浏览器单调时钟记录“发出本轮请求 → 本轮非空 reasoning 首次实际渲染”。排除占位 status、旧 reasoning、仅收包或 setState 时刻。没有 reasoning 的答案型响应单列，不计 0ms、不混入 reasoning 分位数，同时报告其占比和失败/未展示率。

**辅助指标：**POST 有效响应、持久接纳回执、首次派发→alarm 入口、内部入口→首模型 delta、首 reasoning 写库、用户终态、unknown→可恢复。跨 isolate 戳只作经校验的分段诊断，不重复累加并行阶段；冷热不只按 consumerSeq 判断。

**共同门槛：**所有适用演练通过，重复 execute、误清新 token、重复主预扣为 0；任一发生即暂停新启动。主终点两组均使用同步预扣、同优化版本，另报相对旧异步预扣生产版的净收益。不得只统计快且成功的样本；未知/未接纳/无 reasoning 且无终态的异常逐条解释。

**采样：**先少量排错，再轻/重 × 两路径每格至少 40 个可比启动；固定分位数计算方式，冷热另分桶，样本不足的桶不报告可靠 P95。40 样本的 P95 仅作推广筛选，不是长期 SLA；统计不稳延长观察，正式放量覆盖完整使用周期和长 run。6 秒是产品目标，不替代阶段门槛。

### 故障演练清单

| 编号 | 场景与通过标准 |
|---|---|
| F1 | 同 token 并发、DO/Queue 重复、Queue unknown→SSE：仅一个 execute，loser 无执行/结算/清租约副作用。 |
| F2 | DO 已提交但 accepted 丢失：POST unknown，不自动第二 transport；原 run 可执行，重复消息不重跑。 |
| F3 | DO 实际未收到，包括 stopped→手动 resume：过期可恢复，旧 stopped 不遮蔽；撤销/退款原子完成，新 token 接管，迟到 alarm stale。 |
| F4 | 用户仅够一次预扣：未 claim 恢复先原子退款再重读账户，不因旧预扣挂死，不只依赖 16 分钟清扫。 |
| F5 | claim 后/模型中硬杀、自动 resume 后再硬杀：同 token 不重入；恢复或手动/预算阻断明确，无无限自动循环，不伪称已完整结算。 |
| F6 | stop T1→新建/resume T2，T1 后返回/重试：不动 T2 payload、租约、状态；无新尝试的主动 stop 不自动续。 |
| F7 | 重复 reserve、预扣失败/提交不明：至多一笔主 reserve，未确认不派发，只处理本 token。 |
| F8 | 撤销后退款前硬杀、提交响应丢失、迟到 reserve 超 TTL：撤销/退款同成同败，可核对重试；撤销后不能再扣款。 |
| F9 | 内部 400/401/503、读流中断、alarm 重试、存储后响应前故障：分类正确、有记录；不以 skipped/done 伪称成功，不误弃待处理载荷。 |
| F10 | 派发已过期、12:59 慢模型/工具：过期任务不开始外呼；记录跨软截止限制，硬杀后恢复/计费可检查，不要求此版强制取消。 |
| F11 | 刷新、切后台、离线、观察断开/重连：后台 run 独立继续；重连观察同 run，不因观察断开重复执行。 |
| F12 | 隔离环境 >10 并发、切 queue/暂停：记录 DB/模型错误和尾延迟；验证只影响新启动，暂停生效后不创建新 run。 |
| F13 | schema 新增时存在旧 run/消息、发布中断：未排空不开放，不用空 startedAt 给旧活跃 token 二次执行权。 |

## 4. 收益区间（推测情景）

假设 DO 总派发 D=100ms、模型首 delta 到可见余量 R=500ms、同步预扣 K=300–500ms，其余沿用四轮样本；TTFT 已包含在执行段中。新增位置/冷启动/事务成本如超出假设，按实测修正，不把 DO 往返在 D/K 中重复计入。

| 样本 | 仅 A′ 派发 + 同步预扣，尚未计额外优化 | 另有独立净省 1660ms 的优化落地后 |
|---|---:|---:|
| 1 轻 | 7.253–7.453s | 5.593–5.793s |
| 2 重 | 7.715–7.915s | 6.055–6.255s |
| 3 轻 | 7.105–7.305s | 5.445–5.645s |
| 4 重 | 7.116–7.316s | 5.456–5.656s |

**这是四样本情景值不是 P50/P95。** 原始数据见 `scratch/arch-discussion/claude-proposal.md:21`–`:24`；区间已由 Claude 接受（`claude-round3.md:8`）。只看 v1 派发约 7.1–7.9 秒，额外两项优化兑现后约 5.4–6.3 秒；若 D=1 秒，每格加 0.9 秒，分别约 8.0–8.8 秒和 6.3–7.2 秒。Phase 0 本身不承诺降低延迟。

## 5. v1 明确不做（原样保留）

- 无人在线时的自动恢复、持久 outbox、任务调度表或完整执行历史重构。
- A4(b) 无预扣时直接结算、乱序账本协议；也不自动猜测被硬杀 run 的真实外呼成本。
- 全局 admission DO / 严格跨 DO+Queue 的 10 并发保证。后续即使加单例计数，Queue 执行也须领取同一容量许可；“超额转 Queue”本身不是总 cap。
- 全面模型/工具 deadline AbortSignal 改造；不把沿用软截止包装成 15 分钟内必定优雅收尾。
- 独立消费者 Worker、Workflows 主链路迁移、DO.fetch 返回后 waitUntil 长任务、观察流给内联 POST 保活。
- 队列 region 工单和对“北美 v1”的事实断言。
- 重写观察流轮询架构；CUT-7 与 POST 瘦身作为独立优化验收，不与派发收益混记。
- 原样回滚到无 claim 的执行器、删除新 namespace、用生产账号直接做破坏性故障演练。

## 6. 双方签字

- **Claude 签字：同意。** 签署依据：`scratch/arch-discussion/claude-round3.md:3`、`:8` 及该文件的三阶段提议。
- **Astra 签字：同意。** 同意三阶段安排，按本稿既定安全回退边界实施。

签字确认设计、范围和验收约定；各阶段仍须取得对应测试、故障演练和性能证据后才能进入下一阶段。本次仅完成联合定稿，未修改源码、未执行 git 或部署操作。
