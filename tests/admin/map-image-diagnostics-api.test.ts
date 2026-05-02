import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMapImageDiagApiDeps: vi.fn(),
  getSession: vi.fn(),
  prisma: {
    mapImageDiagSession: {
      upsert: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    mapImageDiagControl: {
      upsert: vi.fn(),
    },
    mapImageDiagEvent: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/mapImageDiag/api', () => ({
  getMapImageDiagApiDeps: () => mocks.getMapImageDiagApiDeps(),
}))

describe('map image diagnostics api', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getMapImageDiagApiDeps.mockResolvedValue({
      prisma: mocks.prisma,
      getSession: () => mocks.getSession(),
      now: () => new Date('2026-04-18T00:00:00.000Z'),
    })
  })

  it('accepts public ingest payloads', async () => {
    mocks.prisma.mapImageDiagSession.upsert.mockResolvedValue({ id: 'session-1' })
    mocks.prisma.mapImageDiagEvent.createMany.mockResolvedValue({ count: 2 })
    mocks.prisma.mapImageDiagEvent.findMany.mockResolvedValue([
      {
        stage: 'dom_request_terminal',
        terminalState: 'failed',
        displayOutcome: null,
        durationMs: 200,
        evidence: {},
        createdAt: new Date('2026-04-18T00:00:00.000Z'),
      },
    ])
    mocks.prisma.mapImageDiagSession.update.mockResolvedValue({ id: 'session-1' })

    const handlers = await import('app/api/map-image-diagnostics/route')
    const res = await handlers.POST(new Request('http://localhost/api/map-image-diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          session_id: 'mi-session-1',
          sampled: false,
          escalation_reason: 'failed',
          route_context: '/map?b=1',
        },
        events: [
          {
            session_id: 'mi-session-1',
            chain_id: 'chain-1',
            request_id: 'request-1',
            occurred_at: '2026-04-18T00:00:00.000Z',
            slot_key: 'dom-p1',
            surface: 'map',
            slot_type: 'dom-image',
            owner: 'dom-image',
            stage: 'dom_request_start',
            sampled: false,
            escalation_reason: null,
            attempt_index: 0,
            candidate_index: 0,
            candidate_count: 1,
            requested_candidate_url: 'https://example.com/p1.jpg',
            evidence: { source: 'client' },
          },
          {
            session_id: 'mi-session-1',
            chain_id: 'chain-1',
            request_id: 'request-1',
            occurred_at: '2026-04-18T00:00:00.200Z',
            slot_key: 'dom-p1',
            surface: 'map',
            slot_type: 'dom-image',
            owner: 'dom-image',
            stage: 'dom_request_terminal',
            sampled: false,
            escalation_reason: 'failed',
            attempt_index: 0,
            candidate_index: 0,
            candidate_count: 1,
            final_url: 'https://example.com/p1.jpg',
            terminal_state: 'failed',
            outcome: 'network_error',
            duration_ms: 200,
            evidence: { source: 'client' },
          },
        ],
      }),
    }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      sessionId: 'session-1',
      inserted: 2,
    })
    expect(mocks.prisma.mapImageDiagEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            createdAt: new Date('2026-04-18T00:00:00.000Z'),
          }),
          expect.objectContaining({
            createdAt: new Date('2026-04-18T00:00:00.200Z'),
          }),
        ]),
      }),
    )
  })

  it('does not downgrade sampled sessions when later proxy events arrive with sampled=false', async () => {
    mocks.prisma.mapImageDiagSession.upsert
      .mockResolvedValueOnce({ id: 'session-1', sampled: true, escalationReason: 'failed' })
      .mockResolvedValueOnce({ id: 'session-1', sampled: true, escalationReason: 'failed' })
    mocks.prisma.mapImageDiagEvent.createMany.mockResolvedValue({ count: 1 })
    mocks.prisma.mapImageDiagEvent.findMany.mockResolvedValue([])
    mocks.prisma.mapImageDiagSession.update.mockResolvedValue({ id: 'session-1' })

    const handlers = await import('app/api/map-image-diagnostics/route')

    await handlers.POST(new Request('http://localhost/api/map-image-diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          session_id: 'mi-session-1',
          sampled: true,
          escalation_reason: 'failed',
          route_context: '/map?b=1',
        },
        events: [
          {
            session_id: 'mi-session-1',
            chain_id: 'chain-1',
            request_id: 'request-1',
            occurred_at: '2026-04-18T00:00:00.000Z',
            slot_key: 'dom-p1',
            surface: 'map',
            slot_type: 'dom-image',
            owner: 'dom-image',
            stage: 'dom_request_terminal',
            sampled: true,
            escalation_reason: 'failed',
            attempt_index: 0,
            candidate_index: 0,
            candidate_count: 1,
            final_url: 'https://example.com/p1.jpg',
            terminal_state: 'failed',
            outcome: 'network_error',
            duration_ms: 200,
            evidence: { source: 'client' },
          },
        ],
      }),
    }))

    await handlers.POST(new Request('http://localhost/api/map-image-diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          session_id: 'mi-session-1',
          sampled: false,
          escalation_reason: null,
          route_context: null,
        },
        events: [
          {
            session_id: 'mi-session-1',
            chain_id: 'chain-1',
            request_id: 'request-2',
            occurred_at: '2026-04-18T00:00:00.100Z',
            stage: 'proxy_fetch_terminal',
            sampled: false,
            escalation_reason: null,
            attempt_index: 0,
            candidate_index: 0,
            candidate_count: 0,
            outcome: 'timeout',
            duration_ms: 6000,
            evidence: { source: 'proxy' },
          },
        ],
      }),
    }))

    expect(mocks.prisma.mapImageDiagSession.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        update: expect.objectContaining({
          sampled: undefined,
          escalationReason: undefined,
          routeContext: undefined,
        }),
      }),
    )
    expect(mocks.prisma.mapImageDiagSession.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sampled: true,
          escalationReason: 'failed',
        }),
      }),
    )
  })

  it('keeps sampled/escalation metadata when proxy-only events arrive first', async () => {
    mocks.prisma.mapImageDiagSession.upsert.mockResolvedValue({ id: 'session-2', sampled: true, escalationReason: 'slow' })
    mocks.prisma.mapImageDiagEvent.createMany.mockResolvedValue({ count: 1 })
    mocks.prisma.mapImageDiagEvent.findMany.mockResolvedValue([])
    mocks.prisma.mapImageDiagSession.update.mockResolvedValue({ id: 'session-2' })

    const handlers = await import('app/api/map-image-diagnostics/route')
    const res = await handlers.POST(new Request('http://localhost/api/map-image-diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          session_id: 'mi-session-2',
          sampled: true,
          escalation_reason: 'slow',
          route_context: null,
        },
        events: [
          {
            session_id: 'mi-session-2',
            chain_id: 'chain-2',
            request_id: 'request-2',
            occurred_at: '2026-04-18T00:00:00.100Z',
            stage: 'proxy_fetch_terminal',
            sampled: true,
            escalation_reason: 'slow',
            attempt_index: 0,
            candidate_index: 0,
            candidate_count: 0,
            outcome: 'timeout',
            duration_ms: 6000,
            evidence: { source: 'proxy' },
          },
        ],
      }),
    }))

    expect(res.status).toBe(200)
    expect(mocks.prisma.mapImageDiagSession.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          sampled: true,
          escalationReason: 'slow',
        }),
      }),
    )
  })

  it('keeps proxy-only surface and terminal closure fields when proxy events arrive first', async () => {
    mocks.prisma.mapImageDiagSession.upsert.mockResolvedValue({ id: 'session-3', sampled: true, escalationReason: 'slow' })
    mocks.prisma.mapImageDiagEvent.createMany.mockResolvedValue({ count: 1 })
    mocks.prisma.mapImageDiagEvent.findMany.mockResolvedValue([
      {
        stage: 'proxy_stream_terminal',
        terminalState: 'failed',
        displayOutcome: null,
        durationMs: 6000,
        evidence: {},
        createdAt: new Date('2026-04-18T00:00:00.100Z'),
      },
    ])
    mocks.prisma.mapImageDiagSession.update.mockResolvedValue({ id: 'session-3' })

    const handlers = await import('app/api/map-image-diagnostics/route')
    const res = await handlers.POST(new Request('http://localhost/api/map-image-diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          session_id: 'mi-session-3',
          sampled: true,
          escalation_reason: 'slow',
          route_context: null,
        },
        events: [
          {
            session_id: 'mi-session-3',
            chain_id: 'chain-3',
            request_id: 'request-3',
            occurred_at: '2026-04-18T00:00:00.100Z',
            surface: 'nearby',
            slot_key: 'dom-p9',
            slot_type: 'dom-image',
            owner: 'dom-image',
            stage: 'proxy_stream_terminal',
            sampled: true,
            escalation_reason: 'slow',
            attempt_index: 0,
            candidate_index: 0,
            candidate_count: 0,
            terminal_state: 'failed',
            outcome: 'timeout',
            duration_ms: 6000,
            evidence: { source: 'proxy' },
          },
        ],
      }),
    }))

    expect(res.status).toBe(200)
    expect(mocks.prisma.mapImageDiagEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            surface: 'nearby',
            slotKey: 'dom-p9',
            slotType: 'dom-image',
            owner: 'dom-image',
            terminalState: 'failed',
          }),
        ]),
      }),
    )
    expect(mocks.prisma.mapImageDiagSession.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionOutcome: 'failed',
          lastTerminalState: 'failed',
        }),
      }),
    )
  })

  it('lists admin sessions on the dedicated route', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.mapImageDiagSession.findMany.mockResolvedValue([
      {
        id: 'session-1',
        createdAt: new Date('2026-04-18T00:00:00.000Z'),
        surface: 'map',
        sampled: true,
        escalationReason: 'failed',
        sessionOutcome: 'failed',
        firstDegradedStage: 'dom_request_terminal',
        eventCount: 3,
      },
    ])

    const handlers = await import('app/api/admin/ops/map-image-diagnostics/route')
    const res = await handlers.GET(new Request('http://localhost/api/admin/ops/map-image-diagnostics?limit=10'))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.items[0]).toMatchObject({
      id: 'session-1',
      surface: 'map',
      sessionOutcome: 'failed',
    })
  })

  it('returns session detail with ordered events', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.mapImageDiagSession.findUnique.mockResolvedValue({
      id: 'session-1',
      createdAt: new Date('2026-04-18T00:00:00.000Z'),
      surface: 'nearby',
      sampled: true,
      escalationReason: 'fallback',
      sessionOutcome: 'fallback',
      firstDegradedStage: 'dom_request_terminal',
      eventCount: 2,
      routeContext: '/map?tab=nearby',
      firstViewSummary: { map_shell_ready: '2026-04-18T00:00:00.000Z' },
      lastTerminalState: 'succeeded',
      proxyInvolved: true,
    })
    mocks.prisma.mapImageDiagEvent.findMany.mockResolvedValue([
      {
        id: 'event-1',
        createdAt: new Date('2026-04-18T00:00:01.000Z'),
        chainId: 'chain-1',
        requestId: 'request-1',
        slotKey: 'dom-p1',
        owner: 'dom-image',
        slotType: 'dom-image',
        stage: 'dom_request_terminal',
        attemptIndex: 0,
        candidateIndex: 0,
        candidateCount: 1,
        requestedCandidateUrl: 'https://example.com/p1.jpg',
        finalUrl: 'https://example.com/p1.jpg',
        terminalState: 'succeeded',
        displayOutcome: 'fallback',
        durationMs: 320,
        outcome: null,
        targetHostBucket: 'example.com',
        evidence: { source: 'client' },
      },
    ])

    const handlers = await import('app/api/admin/ops/map-image-diagnostics/[sessionId]/route')
    const res = await handlers.GET(
      new Request('http://localhost/api/admin/ops/map-image-diagnostics/session-1'),
      { params: Promise.resolve({ sessionId: 'session-1' }) },
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.session.id).toBe('session-1')
    expect(json.session.lastTerminalState).toBe('succeeded')
    expect(json.session.proxyInvolved).toBe(true)
    expect(json.events[0]).toMatchObject({
      id: 'event-1',
      requestId: 'request-1',
      displayOutcome: 'fallback',
    })
  })

  it('returns overview summary for a selected time range', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.mapImageDiagSession.findMany.mockResolvedValue([
      {
        id: 'session-1',
        createdAt: new Date('2026-04-18T00:30:00.000Z'),
        surface: 'map',
        sampled: true,
        escalationReason: 'failed',
        sessionOutcome: 'failed',
        firstDegradedStage: 'proxy_fetch_terminal',
        eventCount: 4,
        proxyInvolved: true,
      },
      {
        id: 'session-2',
        createdAt: new Date('2026-04-18T00:45:00.000Z'),
        surface: 'nearby',
        sampled: true,
        escalationReason: null,
        sessionOutcome: 'succeeded',
        firstDegradedStage: null,
        eventCount: 3,
        proxyInvolved: false,
      },
    ])
    mocks.prisma.mapImageDiagEvent.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-04-18T00:30:00.000Z'),
        stage: 'proxy_fetch_terminal',
        terminalState: 'failed',
        displayOutcome: null,
        durationMs: 1550,
        evidence: {},
      },
      {
        createdAt: new Date('2026-04-18T00:45:00.000Z'),
        stage: 'dom_request_terminal',
        terminalState: 'succeeded',
        displayOutcome: 'visible',
        durationMs: 280,
        evidence: {},
      },
    ])

    const handlers = await import('app/api/admin/ops/map-image-diagnostics/overview/route')
    const res = await handlers.GET(new Request('http://localhost/api/admin/ops/map-image-diagnostics/overview?preset=1h'))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.totals).toMatchObject({
      sessions: 2,
      degradedSessions: 1,
      failureSessions: 1,
      proxySessions: 1,
    })
    expect(json.durationBuckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '>=1200ms', count: 1 }),
      ]),
    )
    expect(json.stageStats[0]).toMatchObject({
      stage: 'proxy_fetch_terminal',
      degradedCount: 1,
    })
    expect(json.recentSessions).toHaveLength(2)
  })

  it('reads and updates full capture config for admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.mapImageDiagControl.upsert
      .mockResolvedValueOnce({
        fullCaptureEnabled: false,
        updatedAt: new Date('2026-04-18T01:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        fullCaptureEnabled: true,
        updatedAt: new Date('2026-04-18T01:05:00.000Z'),
      })

    const handlers = await import('app/api/admin/ops/map-image-diagnostics/config/route')
    const getRes = await handlers.GET()
    expect(getRes.status).toBe(200)
    await expect(getRes.json()).resolves.toMatchObject({
      ok: true,
      config: {
        fullCaptureEnabled: false,
      },
    })

    const putRes = await handlers.PUT(new Request('http://localhost/api/admin/ops/map-image-diagnostics/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullCaptureEnabled: true }),
    }))
    expect(putRes.status).toBe(200)
    await expect(putRes.json()).resolves.toMatchObject({
      ok: true,
      config: {
        fullCaptureEnabled: true,
      },
    })
  })

  it('deletes a selected session and purges a range for admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.mapImageDiagSession.delete.mockResolvedValue({ id: 'session-1' })
    mocks.prisma.mapImageDiagSession.deleteMany.mockResolvedValue({ count: 3 })

    const detailHandlers = await import('app/api/admin/ops/map-image-diagnostics/[sessionId]/route')
    const deleteRes = await detailHandlers.DELETE(
      new Request('http://localhost/api/admin/ops/map-image-diagnostics/session-1', { method: 'DELETE' }),
      { params: Promise.resolve({ sessionId: 'session-1' }) },
    )
    expect(deleteRes.status).toBe(200)
    await expect(deleteRes.json()).resolves.toEqual({ ok: true })

    const purgeHandlers = await import('app/api/admin/ops/map-image-diagnostics/purge/route')
    const purgeRes = await purgeHandlers.POST(new Request('http://localhost/api/admin/ops/map-image-diagnostics/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: '2026-04-18T00:00:00.000Z',
        end: '2026-04-18T02:00:00.000Z',
      }),
    }))
    expect(purgeRes.status).toBe(200)
    await expect(purgeRes.json()).resolves.toEqual({ ok: true, deletedCount: 3 })
  })
})
