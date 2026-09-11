import type { Prisma } from '@prisma/client'

export type TripPlanStatus = 'draft' | 'upcoming' | 'ongoing' | 'done'
export type TripPlanItemType = 'point' | 'transit' | 'meal' | 'lodging' | 'attraction' | 'free'

export const TRIP_PLAN_STATUSES: TripPlanStatus[] = ['draft', 'upcoming', 'ongoing', 'done']
export const TRIP_PLAN_ITEM_TYPES: TripPlanItemType[] = ['point', 'transit', 'meal', 'lodging', 'attraction', 'free']

/** 计划创建时的默认标题；标题侧信道用它判断"是否还没有标题" */
export const DEFAULT_PLAN_TITLE = '未命名巡礼计划'

export type TripPlanPointLite = {
  id: string
  name: string
  nameZh: string | null
  /** §0.4 英文译名（AnitabiPointI18n language='en'）；可选以兼容现有 fixture */
  nameEn?: string | null
  lat: number | null
  lng: number | null
  image: string | null
}

export type TripPlanItem = {
  id: string
  dayId: string
  sortOrder: number
  type: TripPlanItemType
  pointId: string | null
  timeHint: string | null
  title: string
  note: string | null
  reason: string | null
  payload: Prisma.JsonValue | null
  point: TripPlanPointLite | null
}

export type TripPlanDay = {
  id: string
  planId: string
  dayIndex: number
  date: Date | null
  citySlug: string | null
  summary: string | null
  items: TripPlanItem[]
}

export type TripPlan = {
  id: string
  userId: string
  title: string
  status: TripPlanStatus
  startDate: Date | null
  dayCount: number
  bangumiIds: number[]
  preferences: Prisma.JsonValue | null
  /** M4 阶段缓存（works/dates/points/enrich/deliver/revise）：仅展示用，真值由证据推断 */
  stage: string | null
  /** 当前 agent 运行持有者 token（beginAgentRun 写入、endAgentRun 清空；无运行时为 null） */
  agentRunToken: string | null
  /** busy 位到期时间（TTL 启发式，到期可被新请求接管；无运行时为 null） */
  agentBusyUntil: Date | null
  createdAt: Date
  updatedAt: Date
}

export type TripPlanWithDays = TripPlan & { days: TripPlanDay[] }

/**
 * 阶段推断的轻量投影（2026-09-10 CUT-3）：derivePlanStage 对计划的全部读取
 * 就是这四个字段——不读 stage/title/status/userId/preferences/updatedAt，不读
 * day 的任何列，更不读 item.point。hasPointItem 必须由仓储层自带"存在任一
 * items[].pointId 为真值（非 null 且非空串）的条目"谓词，不许结构性放宽成
 * 传一棵截断的 days 树——否则类型检查照过、stage 静默变错。
 */
export type TripPlanStageInputs = {
  bangumiIds: number[]
  startDate: Date | null
  dayCount: number
  /** 是否存在任一 items[].pointId 为真值（非 null 且非空串）的条目 */
  hasPointItem: boolean
}

export type TripPlanItemInput = {
  type: TripPlanItemType
  pointId?: string | null
  timeHint?: string | null
  title: string
  note?: string | null
  reason?: string | null
  payload?: Prisma.JsonValue | null
}

export type TripPlanDayInput = {
  dayIndex: number
  date?: Date | null
  citySlug?: string | null
  summary?: string | null
  items: TripPlanItemInput[]
}

export type TripPlanMetaUpdate = {
  title?: string
  status?: TripPlanStatus
  startDate?: Date | null
  dayCount?: number
  bangumiIds?: number[]
  preferences?: Prisma.JsonValue | null
}

/**
 * 'ask' 是 ask_user 工具落库的结构化提问行：content 为 AskUserPayload（无
 * role 字段，不会进入模型回放消息，仅供前端重建交互组件）。
 * 'daymap' 是 save_plan_days 成功后追加的行程交付快照行：content 为
 * DaymapMessagePayload（同样无 role 字段、不进模型回放，前端按对话时间线
 * 渲染历史地图）。不可变载荷——后续保存追加新行，绝不改写旧行。
 * Prisma 侧 kind 是无约束的 String，新增值不需要迁移。
 */
export type TripPlanMessageKind = 'human' | 'assistant' | 'tool' | 'ask' | 'daymap'

export type TripPlanMessage = {
  id: string
  planId: string
  kind: TripPlanMessageKind
  content: Prisma.JsonValue
  createdAt: Date
}

/** 运行日志写入入参（M4 §7）：loop 在每回合结束（finally）追加一条 */
export type TripPlanRunLogEntry = {
  planId: string
  runToken?: string | null
  turnIndex: number
  stage: string
  enrichReport?: Prisma.JsonValue | null
  gateReport?: Prisma.JsonValue | null
  toolCalls?: Prisma.JsonValue | null
  modelUsage?: Prisma.JsonValue | null
  durationMs: number
}

export type TripPlanRunLogRecord = TripPlanRunLogEntry & {
  id: string
  createdAt: Date
}

/** §0.1 契约：运行实况行（plan GET 在 agentBusy 时附带；reasoning 已截尾） */
export type TripPlanRunLiveRecord = {
  planId: string
  runToken: string
  reasoning: string
  statusText: string | null
  toolCalls: Prisma.JsonValue | null
  updatedAt: Date
}

/**
 * upsertRunLive 的写入语义：
 * - 行不存在或行上 runToken 与本次不同 → 视为新 run 接管，整行重置；
 * - runToken 相同 → reasoningAppend 追加 / reasoningReplace 整体替换，
 *   statusText/toolCalls 传入时覆盖（undefined = 保持原值）；
 * - reasoning 超过 RUN_LIVE_REASONING_MAX 字符时截头保尾。
 */
export type TripPlanRunLivePatch = {
  runToken: string
  reasoningAppend?: string
  reasoningReplace?: string
  statusText?: string | null
  toolCalls?: Prisma.JsonValue | null
}

/** 运行实况 reasoning 的持久化上限（超出保留末尾） */
export const RUN_LIVE_REASONING_MAX = 20_000

/**
 * 用户停止的实况行标记（stopAgentRun 写入 TripPlanRunLive.statusText；同
 * run 的后续实况 flush 不覆盖）。常量归属仓储层（第十一轮修复 L5）：repo/
 * repoMemory/repoPrisma 与 planAgent/stop.ts 共用，agent 层从这里 re-export。
 */
export const RUN_STOP_MARKER = '__stop_requested__'

/** reasoning 截尾：超出上限时保留末尾（最新的思考在后） */
export function clampRunLiveReasoning(text: string): string {
  return text.length > RUN_LIVE_REASONING_MAX ? text.slice(text.length - RUN_LIVE_REASONING_MAX) : text
}

export interface TripPlanRepo {
  createPlan(input: { userId: string; title: string }): Promise<TripPlan>
  listPlans(userId: string): Promise<TripPlan[]>
  getPlan(id: string): Promise<TripPlanWithDays | null>
  /**
   * 只取 title 的轻量投影（2026-09-10 CUT-8）：标题侧信道原先为读一个
   * title 拉整棵 PLAN_INCLUDE（多条串行 SQL、20+ KB），在 pool=1 下与
   * 主 loop 抢唯一连接。null 唯一对应"计划不存在"；空串原样返回。
   */
  getPlanTitle(planId: string): Promise<string | null>
  /**
   * CUT-3：阶段推断专用轻量投影——单条 SQL（过滤型 relation count 走 EXISTS
   * 子查询），替代原先为推断阶段拉整棵 PLAN_INCLUDE（5 条串行 SQL、23 KB，
   * 其中第 4/5 条完全是为了 item.point，而 derivePlanStage 根本不读它）。
   * null 唯一对应"计划不存在"。getPlan 保留不动，新方法是并存不是替换。
   */
  getStageInputs(planId: string): Promise<TripPlanStageInputs | null>
  updateMeta(id: string, patch: TripPlanMetaUpdate): Promise<TripPlan>
  replaceDays(id: string, days: TripPlanDayInput[]): Promise<TripPlanWithDays>
  countPlansCreatedSince(userId: string, since: Date): Promise<number>
  appendMessage(planId: string, kind: TripPlanMessageKind, content: Prisma.JsonValue): Promise<TripPlanMessage>
  listMessages(planId: string): Promise<TripPlanMessage[]>
  countHumanMessagesSince(userId: string, since: Date): Promise<number>
  /**
   * agent 运行的原子起步：配额检查、同计划互斥（busy 位）、人类消息落库
   * 必须是同一个原子操作。拆开任意两步都会被并发请求穿过——配额分离会
   * 无限烧模型额度，互斥分离会让两个循环交错写同一份对话历史。
   * busy 位带 TTL（busyTtlMs），进程崩溃未清锁时到期自动可接管。
   * content 传 null（第八轮 resume 回合）时只抢 busy 位不追加 human 消息；
   * 配额检查仍按已落库 human 数计算。
   */
  beginAgentRun(input: {
    planId: string
    userId: string
    content: Prisma.JsonValue | null
    since: Date
    limit: number
    busyTtlMs: number
  }): Promise<BeginAgentRunResult>
  /**
   * 运行结束（含失败）时清除 busy 位；必须放在 finally 里，并传入
   * beginAgentRun 返回的 token。释放前校验 token 匹配当前持有者——否则
   * TTL 到期后新请求已接管，旧请求这时才跑到 finally，无条件释放会把
   * 新持有者的锁也清掉（ABA：旧请求以为自己在释放自己的锁，实际释放的
   * 是别人的）。token 不匹配时静默跳过，不影响当前持有者。
   */
  endAgentRun(planId: string, token: string): Promise<void>
  /**
   * 第八轮 F3：run 存活期间续租 busy 位——token 仍是当前持有者时把
   * agentBusyUntil 推迟到 now + ttlMs；已被接管（token 不匹配）时是空操作，
   * 绝不动新持有者的锁。route 在每次模型调用前调用，配合缩短到 3 分钟的
   * TTL：活着的 run 靠不断续租保住持有权（单次慢推理可超过 TTL），硬杀的
   * run 最长 3 分钟自动释放。返回是否续租成功。
   */
  renewAgentRun(planId: string, token: string, ttlMs: number): Promise<boolean>
  /**
   * 续租并返回计划归属用户。token 不符与计划不存在都返回 null（同一语义）。
   * P0-A（2026-09-11）：内部执行路由已改用 claimAgentRun（一次性领取），
   * 本方法保留给仍需"纯续租 + 取归属"的调用方，不再承担执行入口栅栏。
   */
  renewAgentRunOwner(planId: string, token: string, ttlMs: number): Promise<{ userId: string } | null>
  /**
   * 一次性执行领取：token 匹配且尚未启动才成功——原子写 agentRunStartedAt=now
   * 并续租，返回归属用户。token 失效、或同 token 已被别的执行者领取，都返回
   * null（调用方一律 skipped）。联合方案 v1 不变量 1：一个 token 至多领取成功
   * 一次（Cloudflare Queue at-least-once 下两个消费者拿同一条消息，只有第一个
   * 能通过这里，第二个绝不再跑模型）。
   */
  claimAgentRun(planId: string, token: string, ttlMs: number): Promise<{ userId: string } | null>
  /**
   * 当前 run 租约状态（服务端专用：恢复推断与撤销；不进领域类型 TripPlan、
   * 不进 view——token 绝不能泄露给客户端）。无 token 时返回 null。
   */
  getAgentRunState(planId: string): Promise<{ token: string; busyUntil: Date | null; startedAt: Date | null } | null>
  /**
   * 第十一轮 A3（§0）：用户显式停止正在运行的 run。条件清空 busy/token
   * （仍是当前持有者才动），并在 TripPlanRunLive 行写停止标记
   * statusText='__stop_requested__'（跨隔离体可见：运行中的租约看守与循环
   * 收尾据此区分"用户停止"与"被新请求接管"；同 run 的后续实况 flush 不
   * 覆盖标记，新 run 接管时随行重置）。返回是否真的停掉了 run。
   */
  stopAgentRun(planId: string): Promise<boolean>
  /**
   * 第十一轮 A3：该 run 的 token 已不再是当前持有者（用户停止已清空，或已
    * 被新请求接管）→ true。模型流式期的租约看守定期轮询（默认 3 秒）。
   */
  isAgentRunStopped(planId: string, token: string): Promise<boolean>
  /**
   * 与 appendMessage 语义相同，但 token 校验与写入在同一个原子操作内完成
   * （Prisma 实现用 `SELECT ... FOR UPDATE` 锁住该计划行再校验再写），不留
   * "先查后写"之间的窗口。token 已不是当前持有者时返回 null 且不写入。
   *
   * busyTtlMs 只是"疑似失联"的启发式判断——原请求可能其实还活着，只是这
   * 一轮工具执行慢（比如 search_bangumi_tv 的网络请求），TTL 到期只代表
   * 新请求*可以*接管，不代表旧请求已经停止。agent 循环的每一次落库—— 包
   * 括 save_plan_days/update_plan_meta 这类工具触发的写——都必须用这一组
   * 原子方法而不是裸的 appendMessage/replaceDays/updateMeta，否则旧请求
   * 仍可能在被接管后继续写，复现最初要修的交叉写 bug。
   */
  appendMessageIfActive(
    planId: string,
    token: string,
    kind: TripPlanMessageKind,
    content: Prisma.JsonValue,
  ): Promise<TripPlanMessage | null>
  /** 同上语义，供 save_plan_days 工具替代裸的 replaceDays。 */
  replaceDaysIfActive(planId: string, token: string, days: TripPlanDayInput[]): Promise<TripPlanWithDays | null>
  /** 同上语义，供 update_plan_meta 工具替代裸的 updateMeta。 */
  updateMetaIfActive(planId: string, token: string, patch: TripPlanMetaUpdate): Promise<TripPlan | null>
  /**
   * 乐观版本守卫的整份替换天数（S2，补齐续跑写回用）：updatedAt 仍等于
   * expectedUpdatedAt 时在同一事务里"推进版本戳 + 删旧天数 + 写新天数"；
   * 期间被任何并发保存改动（或计划已不存在）则什么都不写并返回 null。
   * 与 run-token 栅栏互补：栅栏拦"被新 run 接管"，版本守卫拦"任何来源的
   * 并发写"（含不走栅栏的手动保存路径）。
   */
  replaceDaysIfUnchanged(id: string, expectedUpdatedAt: Date, days: TripPlanDayInput[]): Promise<TripPlanWithDays | null>
  /**
   * 原子地"整份替换天数 + 追加 kind=daymap 交付物消息"：daymap 内容由
   * 调用方基于替换后的完整计划快照构建。两写必须在同一个锁/事务窗口内
   * 完成——绝不出现"天数已替换、交付物消息丢失"的半截成功状态（那会让
   * 用户以为保存成功却在刷新后丢失当时的地图）。
   */
  replaceDaysWithDaymap(
    planId: string,
    days: TripPlanDayInput[],
    buildDaymapContent: (plan: TripPlanWithDays) => Prisma.JsonValue,
  ): Promise<ReplaceDaysWithDaymapResult>
  /** 同上语义的 run-token 栅栏版本（save_plan_days 在 agent 运行期使用）。 */
  replaceDaysWithDaymapIfActive(
    planId: string,
    token: string,
    days: TripPlanDayInput[],
    buildDaymapContent: (plan: TripPlanWithDays) => Prisma.JsonValue,
  ): Promise<ReplaceDaysWithDaymapResult | null>
  /**
   * 该计划当前是否有 agent 运行（agentBusyUntil 存在且晚于 now）。plan GET
   * 用它向前端暴露运行状态：断线的浏览器据此进入轮询恢复而不是误判已完成。
   */
  isAgentBusy(planId: string): Promise<boolean>
  /**
   * M4 阶段缓存回写：只做展示，失败由调用方忽略；真值永远以
   * derivePlanStage 的证据推断为准（不一致时下一次 run 会改回来）。
   */
  updateStage(planId: string, stage: string): Promise<void>
  /**
   * CUT-6（2026-09-10）：带 run-token 栅栏的阶段缓存写。写时机从"推断完立即
   * await"推后到"首次模型请求发出之后"再后台派发，推后之后"执行时仍持有
   * busy 位"不再恒真——沿用无栅栏 updateStage 会把接管 run 已写下的 stage
   * 覆写回旧值（凭空触发 plan_updated + 客户端全量 refetch，且缓存一直错到
   * 下一次 run）。token 已不是当前持有者时影响 0 行，语义同 endAgentRun。
   */
  updateStageIfActive(planId: string, token: string, stage: string): Promise<void>
  /** M4 运行日志：追加一条 run 记录（loop 在 finally 里调用，失败不冒泡由调用方兜底） */
  appendRunLog(entry: TripPlanRunLogEntry): Promise<TripPlanRunLogRecord>
  /**
   * F2：把 run 成本写进 stopAgentRun 已落笔的 stopped 日志（用户停止的 run
   * 同样发生了真实的模型/Google 消耗；匹配 planId + runToken + stage=stopped
   * 的全部行，幂等覆盖 modelUsage）。
   */
  updateRunLogModelUsage(planId: string, runToken: string | null, modelUsage: Prisma.JsonValue): Promise<void>
  /** M4 运行日志读取：按时间升序（回归分析/后续思维链持久化复用） */
  listRunLogs(planId: string): Promise<TripPlanRunLogRecord[]>
  /** 运行实况写入（第七轮 A1）：每计划一行，由当前 run 的 writer 覆盖；语义见 TripPlanRunLivePatch */
  upsertRunLive(planId: string, patch: TripPlanRunLivePatch): Promise<TripPlanRunLiveRecord>
  /** 运行实况读取：无行返回 null（plan GET 据此组装 live 字段） */
  getRunLive(planId: string): Promise<TripPlanRunLiveRecord | null>
  /** 运行实况清除：run 结束（writer.finish）时删除行 */
  clearRunLive(planId: string): Promise<void>
  /**
   * 2026-09-06 §0.6.1 轻量快照：观察流每 500 ms 读一次的最小字段集（一次
   * 往返）。live 只在 agentBusy 且实况行 runToken 仍是当前持有者时附带
   * （与 GET 的 live 判定同规则）；chatRevision 沿用 GET 公式
   * （messageCount × 1e14 + lastMessageAt），只在变化时才需要取全量消息。
   * planRevision 由与运行租约无关的字段拼成（见 composePlanRevision），
   * renewAgentRun 只写 agentBusyUntil 不会动它——观察流据此判 plan_updated，
   * 不会被心跳续租刷成误报。
   */
  getRunSnapshotMeta(planId: string): Promise<TripPlanRunSnapshotMeta | null>
}

export type TripPlanRunSnapshotMeta = {
  agentBusy: boolean
  /** composePlanRevision 的产物：与运行租约无关的计划修订号（不透明字符串） */
  planRevision: string
  messageCount: number
  lastMessageAt: Date | null
  live: {
    runToken: string
    reasoning: string
    statusText: string | null
    toolCalls: Prisma.JsonValue | null
    updatedAt: Date
  } | null
}

/**
 * §0.6.1 计划修订号：只用与运行租约（agentBusyUntil/agentRunToken）无关的
 * 展示字段拼成——title/status/dayCount/startDate/bangumiIds/stage 加 days
 * 数量（TripPlanDay 无 updatedAt 列，天数增减即结构变化信号）。观察流的
 * plan_updated 只认它，续租心跳（renewAgentRun 写 agentBusyUntil 会顺带
 * 刷 TripPlan.updatedAt）不再误报。memory 与 prisma 实现共用本函数保证
 * 同语义；对调用方不透明，只做相等比较。
 */
export function composePlanRevision(plan: {
  title: string
  status: string
  startDate: Date | null
  dayCount: number
  bangumiIds: number[]
  stage: string | null
  dayTotal: number
}): string {
  return JSON.stringify([
    plan.title,
    plan.status,
    plan.dayCount,
    plan.startDate ? plan.startDate.getTime() : null,
    plan.bangumiIds,
    plan.stage,
    plan.dayTotal,
  ])
}

export type ReplaceDaysWithDaymapResult = { plan: TripPlanWithDays; message: TripPlanMessage }

export type BeginAgentRunResult =
  | { status: 'ok'; message: TripPlanMessage | null; token: string }
  | { status: 'quota_exceeded' }
  | { status: 'busy' }
