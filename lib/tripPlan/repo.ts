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
  createdAt: Date
  updatedAt: Date
}

export type TripPlanWithDays = TripPlan & { days: TripPlanDay[] }

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

export type TripPlanMessageKind = 'human' | 'assistant' | 'tool'

export type TripPlanMessage = {
  id: string
  planId: string
  kind: TripPlanMessageKind
  content: Prisma.JsonValue
  createdAt: Date
}

export interface TripPlanRepo {
  createPlan(input: { userId: string; title: string }): Promise<TripPlan>
  listPlans(userId: string): Promise<TripPlan[]>
  getPlan(id: string): Promise<TripPlanWithDays | null>
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
   */
  beginAgentRun(input: {
    planId: string
    userId: string
    content: Prisma.JsonValue
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
}

export type BeginAgentRunResult =
  | { status: 'ok'; message: TripPlanMessage; token: string }
  | { status: 'quota_exceeded' }
  | { status: 'busy' }
