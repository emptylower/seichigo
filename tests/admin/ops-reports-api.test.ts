import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOpsApiDeps: vi.fn(),
  getSession: vi.fn(),
  runReport: vi.fn(),
  prisma: {
    opsReport: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/ops/api', () => ({
  getOpsApiDeps: () => mocks.getOpsApiDeps(),
}))

describe('admin ops reports api', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    mocks.getOpsApiDeps.mockResolvedValue({
      prisma: mocks.prisma,
      getSession: () => mocks.getSession(),
      runReport: (...args: unknown[]) => mocks.runReport(...args),
      now: () => new Date('2026-02-09T00:00:00.000Z'),
      getCronSecret: () => '',
    })
  })

  it('lists reports for admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.opsReport.findMany.mockResolvedValue([
      {
        id: 'r1',
        source: 'vercel',
        dateKey: '2026-02-08',
        triggerMode: 'cron',
        status: 'ok',
        totalDeployments: 1,
        totalLogs: 5,
        severeCount: 0,
        warningCount: 0,
        truncated: false,
        windowStart: new Date('2026-02-08T00:00:00.000Z'),
        windowEnd: new Date('2026-02-09T00:00:00.000Z'),
        createdAt: new Date('2026-02-09T00:00:10.000Z'),
      },
    ])

    const handlers = await import('app/api/admin/ops/reports/route')
    const res = await handlers.GET(new Request('http://localhost/api/admin/ops/reports?limit=10'))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.items).toHaveLength(1)
    expect(json.items[0].id).toBe('r1')
  })

  it('runs manual report for admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.runReport.mockResolvedValue({
      reportId: 'r2',
      source: 'vercel',
      dateKey: '2026-02-09',
      triggerMode: 'manual',
      status: 'ok',
      windowStart: '2026-02-08T00:00:00.000Z',
      windowEnd: '2026-02-09T00:00:00.000Z',
      totalDeployments: 1,
      totalLogs: 5,
      severeCount: 0,
      warningCount: 0,
      truncated: false,
      createdAt: '2026-02-09T00:00:00.000Z',
      markdownSummary: '# report',
    })

    const handlers = await import('app/api/admin/ops/reports/route')
    const res = await handlers.POST(
      new Request('http://localhost/api/admin/ops/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.report.reportId).toBe('r2')
    expect(mocks.runReport).toHaveBeenCalledTimes(1)
    expect(mocks.runReport.mock.calls[0][0].triggerMode).toBe('manual')
  })

  it('returns unauthorized for non-admin list', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const handlers = await import('app/api/admin/ops/reports/route')
    const res = await handlers.GET(new Request('http://localhost/api/admin/ops/reports'))

    expect(res.status).toBe(401)
  })

  it('returns report detail with events', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.opsReport.findUnique.mockResolvedValue({
      id: 'r1',
      source: 'vercel',
      dateKey: '2026-02-08',
      triggerMode: 'cron',
      status: 'ok',
      totalDeployments: 1,
      totalLogs: 5,
      severeCount: 1,
      warningCount: 0,
      truncated: false,
      windowStart: new Date('2026-02-08T00:00:00.000Z'),
      windowEnd: new Date('2026-02-09T00:00:00.000Z'),
      createdAt: new Date('2026-02-09T00:00:00.000Z'),
      markdownSummary: '# report',
      rawSummary: {},
      events: [
        {
          id: 'e1',
          severity: 'severe',
          fingerprint: 'abc',
          timestamp: new Date('2026-02-08T12:00:00.000Z'),
          deploymentId: 'dep-1',
          requestId: null,
          path: '/api/a',
          method: 'GET',
          statusCode: 500,
          message: 'boom',
          raw: {},
          createdAt: new Date('2026-02-08T12:00:01.000Z'),
        },
      ],
    })

    const handlers = await import('app/api/admin/ops/reports/[id]/route')
    const res = await handlers.GET(new Request('http://localhost/api/admin/ops/reports/r1'), {
      params: Promise.resolve({ id: 'r1' }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.events).toHaveLength(1)
    expect(json.report.id).toBe('r1')
  })
})
