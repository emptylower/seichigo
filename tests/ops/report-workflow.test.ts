import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runOpsReport } from '@/lib/ops/reportWorkflow'

function makeDeps(options?: {
  listDeployments?: Array<{ id: string; createdAt: Date | null; name: string | null; url: string | null; raw: Record<string, unknown> }>
  listDeploymentEvents?: Record<string, Array<Record<string, unknown>>>
  throwOnDeployment?: boolean
  env?: NodeJS.ProcessEnv
}) {
  const listDeployments = vi.fn(async () => {
    if (options?.throwOnDeployment) {
      throw new Error('deployment events unavailable')
    }

    return options?.listDeployments || []
  })

  const listDeploymentEvents = vi.fn(async (deploymentId: string) => {
    return options?.listDeploymentEvents?.[deploymentId] || []
  })

  const createReport = vi.fn(async () => ({
    id: 'report-1',
    createdAt: new Date('2026-02-08T00:00:00.000Z'),
  }))

  const createMany = vi.fn(async ({ data }: any) => ({ count: Array.isArray(data) ? data.length : 0 }))
  const deleteMany = vi.fn(async () => ({ count: 0 }))

  return {
    deps: {
      prisma: {
        opsReport: {
          create: createReport,
          deleteMany,
        },
        opsLogEvent: {
          createMany,
        },
      },
      createVercelClient: () => ({
        listDeployments,
        listDeploymentEvents,
      }),
      now: () => new Date('2026-02-09T00:00:00.000Z'),
      env: {
        OPS_MAX_DEPLOYMENTS_PER_RUN: '8',
        OPS_MAX_LOG_LINES_PER_RUN: '20000',
        OPS_MAX_STORED_EVENTS_PER_RUN: '2000',
        OPS_WARN_4XX_THRESHOLD: '2',
        OPS_RETENTION_DAYS: '90',
        ...(options?.env || {}),
      },
    },
    spies: {
      listDeployments,
      listDeploymentEvents,
      createReport,
      createMany,
      deleteMany,
    },
  }
}

describe('ops report workflow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('aggregates severe/warning counts and persists markdown summary', async () => {
    const { deps, spies } = makeDeps({
      listDeployments: [
        {
          id: 'dep-1',
          createdAt: new Date('2026-02-08T12:00:00.000Z'),
          name: 'seichigo',
          url: 'seichigo.vercel.app',
          raw: { id: 'dep-1' },
        },
      ],
      listDeploymentEvents: {
        'dep-1': [
          { statusCode: 500, message: 'Unhandled exception in handler', method: 'GET', path: '/api/a' },
          { statusCode: 404, message: 'Not Found', method: 'GET', path: '/api/a' },
          { statusCode: 404, message: 'Not Found', method: 'GET', path: '/api/a' },
        ],
      },
    })

    const result = await runOpsReport(
      {
        triggerMode: 'manual',
        windowStart: new Date('2026-02-08T00:00:00.000Z'),
        windowEnd: new Date('2026-02-09T00:00:00.000Z'),
      },
      deps as any
    )

    expect(result.status).toBe('ok')
    expect(result.totalDeployments).toBe(1)
    expect(result.totalLogs).toBe(3)
    expect(result.severeCount).toBe(1)
    expect(result.warningCount).toBe(2)
    expect(result.markdownSummary).toContain('Top Severe Fingerprints')
    expect(spies.createReport).toHaveBeenCalledTimes(1)
    expect(spies.createMany).toHaveBeenCalledTimes(1)
  })

  it('marks truncated when stored event limit is exceeded', async () => {
    const { deps } = makeDeps({
      env: {
        OPS_MAX_STORED_EVENTS_PER_RUN: '2',
        OPS_WARN_4XX_THRESHOLD: '1',
      },
      listDeployments: [
        {
          id: 'dep-1',
          createdAt: new Date('2026-02-08T12:00:00.000Z'),
          name: 'seichigo',
          url: 'seichigo.vercel.app',
          raw: { id: 'dep-1' },
        },
      ],
      listDeploymentEvents: {
        'dep-1': [
          { statusCode: 500, message: 'fatal one', method: 'GET', path: '/api/one' },
          { statusCode: 500, message: 'fatal two', method: 'GET', path: '/api/two' },
          { statusCode: 500, message: 'fatal three', method: 'GET', path: '/api/three' },
        ],
      },
    })

    const result = await runOpsReport(
      {
        triggerMode: 'manual',
        windowStart: new Date('2026-02-08T00:00:00.000Z'),
        windowEnd: new Date('2026-02-09T00:00:00.000Z'),
      },
      deps as any
    )

    expect(result.truncated).toBe(true)
    expect(result.severeCount).toBe(3)
  })
})
