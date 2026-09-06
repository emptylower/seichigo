import { describe, expect, it } from 'vitest'
import { createBillingService } from '@/lib/billing/service'
import { MemoryUsageLedger } from '@/lib/billing/ledgerMemory'
import { MemoryBillingUsers } from '@/lib/billing/usersMemory'
import { monthlyBudgetMicros } from '@/lib/billing/budget'
import { RESERVE_MICROS } from '@/lib/billing/priceTable'

function setup(now = new Date('2026-09-06T00:00:00Z')) {
  const ledger = new MemoryUsageLedger(() => now)
  const users = new MemoryBillingUsers()
  users.seed({ id: 'u1', tier: 'standard', periodStart: new Date('2026-08-20T00:00:00Z'), periodEnd: null, isAdmin: false })
  users.seed({ id: 'admin', tier: 'free', periodStart: new Date('2026-08-20T00:00:00Z'), periodEnd: null, isAdmin: true })
  const billing = createBillingService({ ledger, users, now: () => now })
  return { ledger, users, billing }
}

describe('billing service', () => {
  it('getAccount initializes the period and grants the full budget once', async () => {
    const { billing, users } = setup()
    const a = await billing.getAccount('u1')
    expect(a?.tier).toBe('standard')
    expect(a?.periodStart.toISOString()).toBe('2026-08-20T00:00:00.000Z')
    expect(a?.periodEnd.toISOString()).toBe('2026-09-20T00:00:00.000Z')
    expect(a?.budgetMicros).toBe(monthlyBudgetMicros('standard'))
    expect(a?.balanceMicros).toBe(monthlyBudgetMicros('standard'))
    expect(a?.remainingPercent).toBe(100)
    expect((await users.get('u1'))?.periodEnd?.toISOString()).toBe('2026-09-20T00:00:00.000Z')
    const again = await billing.getAccount('u1')
    expect(again?.balanceMicros).toBe(monthlyBudgetMicros('standard'))
  })

  it('rolls the period forward and grants a fresh budget when periodEnd has passed', async () => {
    const { billing } = setup(new Date('2026-09-25T00:00:00Z'))
    const a = await billing.getAccount('u1')
    expect(a?.periodStart.toISOString()).toBe('2026-09-20T00:00:00.000Z')
    expect(a?.periodEnd.toISOString()).toBe('2026-10-20T00:00:00.000Z')
    expect(a?.balanceMicros).toBe(monthlyBudgetMicros('standard'))
  })

  it('reserveRun deducts the reserve and settleRun adjusts to the actual cost', async () => {
    const { billing } = setup()
    const account = (await billing.getAccount('u1'))!
    const r = await billing.reserveRun({ account, planId: 'p1', runRef: 'run1' })
    expect(r.ok).toBe(true)
    expect((await billing.getAccount('u1'))!.balanceMicros).toBe(account.budgetMicros - RESERVE_MICROS.standard)
    await billing.settleRun({ runRef: 'run1', actualMicros: 250_000, hadModelOutput: true })
    expect((await billing.getAccount('u1'))!.balanceMicros).toBe(account.budgetMicros - 250_000)
  })

  it('settleRun refunds fully when the run produced no model output', async () => {
    const { billing } = setup()
    const account = (await billing.getAccount('u1'))!
    await billing.reserveRun({ account, planId: 'p1', runRef: 'run1' })
    await billing.settleRun({ runRef: 'run1', actualMicros: 0, hadModelOutput: false })
    expect((await billing.getAccount('u1'))!.balanceMicros).toBe(account.budgetMicros)
  })

  it('reserveRun refuses when the balance cannot cover the reserve and reports resetsAt', async () => {
    const { billing } = setup()
    const account = (await billing.getAccount('u1'))!
    const runs = Math.ceil(account.budgetMicros / RESERVE_MICROS.standard)
    for (let i = 0; i < runs; i++) {
      await billing.reserveRun({ account: (await billing.getAccount('u1'))!, planId: 'p1', runRef: `r${i}` })
    }
    const denied = await billing.reserveRun({ account: (await billing.getAccount('u1'))!, planId: 'p1', runRef: 'late' })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.resetsAt.toISOString()).toBe('2026-09-20T00:00:00.000Z')
  })

  it('canStartRun is a read-only precheck and force reserve skips the balance check', async () => {
    const { billing } = setup()
    const account = (await billing.getAccount('u1'))!
    expect(billing.canStartRun(account)).toBe(true)
    expect(billing.canStartRun({ ...account, balanceMicros: RESERVE_MICROS.standard - 1 })).toBe(false)
    const forced = await billing.reserveRun({ account: { ...account, balanceMicros: 0 }, planId: 'p1', runRef: 'f1', force: true })
    expect(forced.ok).toBe(true)
  })

  it('admins are never charged', async () => {
    const { billing, ledger } = setup()
    const account = (await billing.getAccount('admin'))!
    expect(account.isAdmin).toBe(true)
    const r = await billing.reserveRun({ account, planId: 'p1', runRef: 'a1' })
    expect(r.ok).toBe(true)
    await billing.settleRun({ runRef: 'a1', actualMicros: 999_999, hadModelOutput: true })
    expect(await ledger.findOpenReserve('a1')).toBeNull()
    expect((await billing.getAccount('admin'))!.balanceMicros).toBe(account.budgetMicros)
  })

  it('refundStaleReserves refunds unsettled reserves older than the cutoff', async () => {
    const { billing, ledger } = setup()
    const account = (await billing.getAccount('u1'))!
    await billing.reserveRun({ account, planId: 'p1', runRef: 'stale' })
    ledger.now = () => new Date('2026-09-06T01:00:00Z')
    await billing.refundStaleReserves('u1', new Date('2026-09-06T00:30:00Z'))
    expect(await ledger.findOpenReserve('stale')).toBeNull()
    expect((await billing.getAccount('u1'))!.balanceMicros).toBe(account.budgetMicros)
  })
})
