import type { LedgerAppendInput, LedgerEntry, UsageLedgerRepo } from './ledger'

export class MemoryUsageLedger implements UsageLedgerRepo {
  private entries: LedgerEntry[] = []
  private seq = 0
  constructor(public now: () => Date = () => new Date()) {}

  async balance(userId: string, periodStart: Date): Promise<number> {
    return this.entries
      .filter((e) => e.userId === userId && e.periodStart.getTime() === periodStart.getTime())
      .reduce((sum, e) => sum + e.deltaMicros, 0)
  }

  async append(input: LedgerAppendInput): Promise<LedgerEntry> {
    const balanceAfter = (await this.balance(input.userId, input.periodStart)) + input.deltaMicros
    const entry: LedgerEntry = { ...input, id: `ledger_${++this.seq}`, balanceAfter, createdAt: this.now() }
    this.entries.push(entry)
    return entry
  }

  async hasEntries(userId: string, periodStart: Date): Promise<boolean> {
    return this.entries.some((e) => e.userId === userId && e.periodStart.getTime() === periodStart.getTime())
  }

  async findOpenReserve(runRef: string): Promise<LedgerEntry | null> {
    const related = this.entries.filter((e) => e.runRef === runRef)
    const reserve = related.find((e) => e.kind === 'reserve')
    if (!reserve) return null
    return related.some((e) => e.kind === 'settle' || e.kind === 'refund') ? null : reserve
  }

  async listOpenReserves(userId: string, olderThan: Date): Promise<LedgerEntry[]> {
    const out: LedgerEntry[] = []
    for (const e of this.entries) {
      if (e.userId !== userId || e.kind !== 'reserve' || !e.runRef) continue
      if (e.createdAt.getTime() >= olderThan.getTime()) continue
      if (await this.findOpenReserve(e.runRef)) out.push(e)
    }
    return out
  }

  async withUserLock<T>(_userId: string, fn: () => Promise<T>): Promise<T> {
    return fn()
  }
}
