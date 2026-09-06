export type LedgerKind = 'grant' | 'reserve' | 'settle' | 'refund'

export type LedgerEntry = {
  id: string
  userId: string
  planId: string | null
  runRef: string | null
  kind: LedgerKind
  /** 微美元；grant/refund/settle 为正或负调整，reserve 为负 */
  deltaMicros: number
  balanceAfter: number
  periodStart: Date
  createdAt: Date
}

export type LedgerAppendInput = Omit<LedgerEntry, 'id' | 'createdAt' | 'balanceAfter'>

/**
 * 用量账本仓储（设计 §8）。余量 = 同一 userId + periodStart 下 deltaMicros 之和。
 * withUserLock 串行化同一用户的"读余量 → 写账目"；prisma 实现用事务级 advisory lock。
 */
export interface UsageLedgerRepo {
  balance(userId: string, periodStart: Date): Promise<number>
  append(input: LedgerAppendInput): Promise<LedgerEntry>
  /** 该周期内是否已有任何账目（区分"余量为 0"与"从未记账"） */
  hasEntries(userId: string, periodStart: Date): Promise<boolean>
  /** 尚无 settle/refund 配对的 reserve */
  findOpenReserve(runRef: string): Promise<LedgerEntry | null>
  /** 同一 runRef 的全部账目（settle 兜底与 chargeExtra 取 userId/periodStart 用） */
  findByRunRef(runRef: string): Promise<LedgerEntry[]>
  /** 该用户所有早于 olderThan 且仍未配对的 reserve */
  listOpenReserves(userId: string, olderThan: Date): Promise<LedgerEntry[]>
  withUserLock<T>(userId: string, fn: (repo: UsageLedgerRepo) => Promise<T>): Promise<T>
}
