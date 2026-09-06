import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'
import type { LedgerAppendInput, LedgerEntry, LedgerKind, UsageLedgerRepo } from './ledger'

type Row = {
  id: string
  userId: string
  planId: string | null
  runRef: string | null
  kind: string
  deltaMicros: bigint
  balanceAfter: bigint
  periodStart: Date
  createdAt: Date
}

function toEntry(row: Row): LedgerEntry {
  return {
    id: row.id,
    userId: row.userId,
    planId: row.planId,
    runRef: row.runRef,
    kind: row.kind as LedgerKind,
    deltaMicros: Number(row.deltaMicros),
    balanceAfter: Number(row.balanceAfter),
    periodStart: row.periodStart,
    createdAt: row.createdAt,
  }
}

type Db = Prisma.TransactionClient | typeof prisma

/**
 * Prisma 实现。withUserLock 开事务并取 pg_advisory_xact_lock(hashtext(userId))，
 * 与 repoPrisma.beginAgentRun 的锁键一致，fn 内的 balance/append 走同一事务。
 */
export class PrismaUsageLedger implements UsageLedgerRepo {
  private db: Db = prisma

  async balance(userId: string, periodStart: Date): Promise<number> {
    const agg = await this.db.usageLedger.aggregate({ where: { userId, periodStart }, _sum: { deltaMicros: true } })
    return Number(agg._sum.deltaMicros ?? 0n)
  }

  async append(input: LedgerAppendInput): Promise<LedgerEntry> {
    const balanceAfter = (await this.balance(input.userId, input.periodStart)) + input.deltaMicros
    const row = await this.db.usageLedger.create({
      data: {
        userId: input.userId,
        planId: input.planId,
        runRef: input.runRef,
        kind: input.kind,
        deltaMicros: BigInt(Math.round(input.deltaMicros)),
        balanceAfter: BigInt(Math.round(balanceAfter)),
        periodStart: input.periodStart,
      },
    })
    return toEntry(row)
  }

  async hasEntries(userId: string, periodStart: Date): Promise<boolean> {
    return (await this.db.usageLedger.count({ where: { userId, periodStart } })) > 0
  }

  async findOpenReserve(runRef: string): Promise<LedgerEntry | null> {
    const rows = await this.db.usageLedger.findMany({ where: { runRef } })
    const reserve = rows.find((r) => r.kind === 'reserve')
    if (!reserve) return null
    return rows.some((r) => r.kind === 'settle' || r.kind === 'refund') ? null : toEntry(reserve)
  }

  async listOpenReserves(userId: string, olderThan: Date): Promise<LedgerEntry[]> {
    const reserves = await this.db.usageLedger.findMany({
      where: { userId, kind: 'reserve', createdAt: { lt: olderThan }, runRef: { not: null } },
    })
    if (!reserves.length) return []
    const closed = await this.db.usageLedger.findMany({
      where: { runRef: { in: reserves.map((r) => r.runRef as string) }, kind: { in: ['settle', 'refund'] } },
      select: { runRef: true },
    })
    const closedRefs = new Set(closed.map((c) => c.runRef))
    return reserves.filter((r) => !closedRefs.has(r.runRef)).map(toEntry)
  }

  async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))::text`
        const scoped = new PrismaUsageLedger()
        scoped.db = tx
        return fn.call(scoped)
      },
      { maxWait: 10_000, timeout: 15_000 },
    )
  }
}
