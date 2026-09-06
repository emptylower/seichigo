import { describe, expect, it } from 'vitest'
import { MemoryUsageLedger } from '@/lib/billing/ledgerMemory'

const period = new Date('2026-09-01T00:00:00Z')

describe('MemoryUsageLedger', () => {
  it('balance sums deltas within the period and balanceAfter tracks it', async () => {
    const ledger = new MemoryUsageLedger()
    const grant = await ledger.append({ userId: 'u1', planId: null, runRef: null, kind: 'grant', deltaMicros: 1000, periodStart: period })
    expect(grant.balanceAfter).toBe(1000)
    const reserve = await ledger.append({ userId: 'u1', planId: 'p1', runRef: 'r1', kind: 'reserve', deltaMicros: -300, periodStart: period })
    expect(reserve.balanceAfter).toBe(700)
    expect(await ledger.balance('u1', period)).toBe(700)
    expect(await ledger.balance('u1', new Date('2026-10-01T00:00:00Z'))).toBe(0)
    expect(await ledger.balance('u2', period)).toBe(0)
  })

  it('findOpenReserve returns the reserve only while no settle/refund shares its runRef', async () => {
    const ledger = new MemoryUsageLedger()
    await ledger.append({ userId: 'u1', planId: 'p1', runRef: 'r1', kind: 'reserve', deltaMicros: -300, periodStart: period })
    expect((await ledger.findOpenReserve('r1'))?.deltaMicros).toBe(-300)
    await ledger.append({ userId: 'u1', planId: 'p1', runRef: 'r1', kind: 'settle', deltaMicros: 100, periodStart: period })
    expect(await ledger.findOpenReserve('r1')).toBeNull()
  })

  it('listOpenReserves returns unsettled reserves older than the cutoff', async () => {
    const ledger = new MemoryUsageLedger(() => new Date('2026-09-06T00:00:00Z'))
    await ledger.append({ userId: 'u1', planId: 'p1', runRef: 'old', kind: 'reserve', deltaMicros: -300, periodStart: period })
    ;(ledger as unknown as { now: () => Date }).now = () => new Date('2026-09-06T01:00:00Z')
    await ledger.append({ userId: 'u1', planId: 'p2', runRef: 'new', kind: 'reserve', deltaMicros: -300, periodStart: period })
    const stale = await ledger.listOpenReserves('u1', new Date('2026-09-06T00:30:00Z'))
    expect(stale.map((e) => e.runRef)).toEqual(['old'])
  })
})
