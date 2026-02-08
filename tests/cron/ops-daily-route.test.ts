import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOpsApiDeps: vi.fn(),
  runReport: vi.fn(),
  getCronSecret: vi.fn(),
  prisma: {
    opsReport: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/ops/api', () => ({
  getOpsApiDeps: () => mocks.getOpsApiDeps(),
}))

describe('cron ops daily route', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    mocks.getCronSecret.mockReturnValue('ops-secret')
    mocks.getOpsApiDeps.mockResolvedValue({
      prisma: mocks.prisma,
      getSession: async () => null,
      runReport: (...args: unknown[]) => mocks.runReport(...args),
      now: () => new Date('2026-02-09T00:00:00.000Z'),
      getCronSecret: () => mocks.getCronSecret(),
    })
  })

  it('rejects request when cron secret does not match', async () => {
    const handlers = await import('app/api/cron/ops/daily/route')

    const res = await handlers.GET(
      new Request('http://localhost/api/cron/ops/daily', {
        method: 'GET',
      })
    )

    expect(res.status).toBe(401)
  })

  it('skips when report for same utc day already exists', async () => {
    mocks.prisma.opsReport.findFirst.mockResolvedValue({
      id: 'r-existing',
      status: 'ok',
      createdAt: new Date('2026-02-09T00:00:10.000Z'),
    })

    const handlers = await import('app/api/cron/ops/daily/route')
    const res = await handlers.GET(
      new Request('http://localhost/api/cron/ops/daily', {
        method: 'GET',
        headers: { Authorization: 'Bearer ops-secret' },
      })
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.skipped).toBe(true)
    expect(mocks.runReport).not.toHaveBeenCalled()
  })

  it('runs daily report and allows zero severe reports', async () => {
    mocks.prisma.opsReport.findFirst.mockResolvedValue(null)
    mocks.runReport.mockResolvedValue({
      reportId: 'r-new',
      source: 'vercel',
      dateKey: '2026-02-08',
      triggerMode: 'cron',
      status: 'ok',
      windowStart: '2026-02-08T00:00:00.000Z',
      windowEnd: '2026-02-09T00:00:00.000Z',
      totalDeployments: 1,
      totalLogs: 120,
      severeCount: 0,
      warningCount: 0,
      truncated: false,
      createdAt: '2026-02-09T00:00:00.000Z',
      markdownSummary: '# report',
    })

    const handlers = await import('app/api/cron/ops/daily/route')
    const res = await handlers.GET(
      new Request('http://localhost/api/cron/ops/daily', {
        method: 'GET',
        headers: { Authorization: 'Bearer ops-secret' },
      })
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.skipped).toBe(false)
    expect(json.report.severeCount).toBe(0)
    expect(mocks.runReport).toHaveBeenCalledTimes(1)
    expect(mocks.runReport.mock.calls[0][0]).toMatchObject({ triggerMode: 'cron' })
  })
})
