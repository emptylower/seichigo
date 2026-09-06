import { describe, expect, it } from 'vitest'
import { createBillingService } from '@/lib/billing/service'
import { MemoryUsageLedger } from '@/lib/billing/ledgerMemory'
import { MemoryBillingUsers } from '@/lib/billing/usersMemory'
import { monthlyBudgetMicros } from '@/lib/billing/budget'
import { RESERVE_MICROS } from '@/lib/billing/priceTable'

function setup(now = new Date('2026-09-06T00:00:00Z'), activeRuns = new Set<string>()) {
  const ledger = new MemoryUsageLedger(() => now)
  const users = new MemoryBillingUsers()
  users.seed({ id: 'u1', tier: 'standard', periodStart: new Date('2026-08-20T00:00:00Z'), periodAnchor: new Date('2026-08-20T00:00:00Z'), periodEnd: null, isAdmin: false })
  users.seed({ id: 'admin', tier: 'free', periodStart: new Date('2026-08-20T00:00:00Z'), periodAnchor: new Date('2026-08-20T00:00:00Z'), periodEnd: null, isAdmin: true })
  const billing = createBillingService({
    ledger,
    users,
    now: () => now,
    isRunActive: async (planId, runRef) => activeRuns.has(`${planId}:${runRef}`),
  })
  return { ledger, users, billing, activeRuns }
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

  it('G1：活跃 run 的 reserve 超过阈值也不被退；不活跃与无 planId 的被退', async () => {
    const { billing, ledger } = setup(new Date('2026-09-06T00:00:00Z'), new Set(['p1:live']))
    const account = (await billing.getAccount('u1'))!
    await billing.reserveRun({ account, planId: 'p1', runRef: 'live' })
    await billing.reserveRun({ account, planId: 'p2', runRef: 'dead' })
    // 无 planId 的 reserve（历史数据/内部路径）没有活跃判定依据，视为不活跃
    await ledger.append({ userId: 'u1', planId: null, runRef: 'orphan', kind: 'reserve', deltaMicros: -RESERVE_MICROS.standard, periodStart: account.periodStart })
    ledger.now = () => new Date('2026-09-06T01:00:00Z')
    await billing.refundStaleReserves('u1', new Date('2026-09-06T00:30:00Z'))
    expect(await ledger.findOpenReserve('live')).not.toBeNull()
    expect(await ledger.findOpenReserve('dead')).toBeNull()
    expect(await ledger.findOpenReserve('orphan')).toBeNull()
  })

  it('G1：reserve 已被误退后 settleRun 仍补一条 -actual 的 settle', async () => {
    const { billing, ledger } = setup()
    const account = (await billing.getAccount('u1'))!
    await billing.reserveRun({ account, planId: 'p1', runRef: 'run1' })
    await billing.refundStaleReserves('u1', new Date('2026-09-06T00:00:01Z'))
    expect(await ledger.findOpenReserve('run1')).toBeNull()
    await billing.settleRun({ runRef: 'run1', actualMicros: 300_000, hadModelOutput: true })
    const settles = (await ledger.findByRunRef('run1')).filter((e) => e.kind === 'settle')
    expect(settles).toHaveLength(1)
    expect(settles[0]!.deltaMicros).toBe(-300_000)
    expect((await billing.getAccount('u1'))!.balanceMicros).toBe(account.budgetMicros - 300_000)
  })

  it('G4：滚动周期锚定 periodAnchor 而不是漂移后的 periodStart（1/31 → 2/28–3/31）', async () => {
    const now = new Date('2026-03-15T00:00:00Z')
    const ledger = new MemoryUsageLedger(() => now)
    const users = new MemoryBillingUsers()
    users.seed({
      id: 'drift',
      tier: 'standard',
      periodStart: new Date('2026-02-28T00:00:00Z'),
      periodAnchor: new Date('2026-01-31T00:00:00Z'),
      periodEnd: null,
      isAdmin: false,
    })
    const billing = createBillingService({ ledger, users, now: () => now, isRunActive: async () => false })
    const a = await billing.getAccount('drift')
    expect(a?.periodStart.toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(a?.periodEnd.toISOString()).toBe('2026-03-31T00:00:00.000Z')
  })

  it('G5：连续两次 settleRun 只产生一条 settle', async () => {
    const { billing, ledger } = setup()
    const account = (await billing.getAccount('u1'))!
    await billing.reserveRun({ account, planId: 'p1', runRef: 'run1' })
    await billing.settleRun({ runRef: 'run1', actualMicros: 100_000, hadModelOutput: true })
    await billing.settleRun({ runRef: 'run1', actualMicros: 150_000, hadModelOutput: true })
    const settles = (await ledger.findByRunRef('run1')).filter((e) => e.kind === 'settle')
    expect(settles).toHaveLength(1)
    expect((await billing.getAccount('u1'))!.balanceMicros).toBe(account.budgetMicros - 100_000)
  })

  it('G5：actualMicros 为 NaN 时按 0 结算不抛错', async () => {
    const { billing } = setup()
    const account = (await billing.getAccount('u1'))!
    await billing.reserveRun({ account, planId: 'p1', runRef: 'nan' })
    await billing.settleRun({ runRef: 'nan', actualMicros: Number.NaN, hadModelOutput: true })
    expect((await billing.getAccount('u1'))!.balanceMicros).toBe(account.budgetMicros)
  })

  it('G8：chargeExtra 追加一条负 settle', async () => {
    const { billing, ledger } = setup()
    const account = (await billing.getAccount('u1'))!
    await billing.reserveRun({ account, planId: 'p1', runRef: 'run1' })
    await billing.settleRun({ runRef: 'run1', actualMicros: 100_000, hadModelOutput: true })
    await billing.chargeExtra({ runRef: 'run1', micros: 5_000 })
    const settles = (await ledger.findByRunRef('run1')).filter((e) => e.kind === 'settle')
    expect(settles).toHaveLength(2)
    expect(settles[1]!.deltaMicros).toBe(-5_000)
    expect((await billing.getAccount('u1'))!.balanceMicros).toBe(account.budgetMicros - 105_000)
  })
})
