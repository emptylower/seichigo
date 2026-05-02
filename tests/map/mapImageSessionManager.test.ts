import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapImageSessionManager } from '@/features/map/anitabi/mapImageSessionManager'

describe('MapImageSessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps retries in one chain while rotating request ids', () => {
    const manager = new MapImageSessionManager({
      random: () => 0,
      now: () => Date.now(),
      getSessionSeed: () => 'seed-session',
      transport: vi.fn(),
    })

    const first = manager.startRequest({
      surface: 'map',
      slotKey: 'thumb-p1',
      slotType: 'point-thumbnail',
      owner: 'viewport-loader',
      requestedCandidateUrl: 'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fexample.com%2Fp1.jpg',
      candidateIndex: 0,
      candidateCount: 2,
      reuseChain: false,
    })
    manager.finishRequest(first, {
      terminalState: 'failed',
      chainTerminal: false,
      finalUrl: first.requestUrl,
      outcome: 'network_error',
    })

    const retried = manager.startRequest({
      surface: 'map',
      slotKey: 'thumb-p1',
      slotType: 'point-thumbnail',
      owner: 'viewport-loader',
      requestedCandidateUrl: 'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fexample.com%2Fp1.jpg',
      candidateIndex: 1,
      candidateCount: 2,
      reuseChain: true,
    })

    expect(retried.sessionId).toBe('seed-session')
    expect(retried.chainId).toBe(first.chainId)
    expect(retried.requestId).not.toBe(first.requestId)
    expect(retried.attemptIndex).toBe(1)
  })

  it('forces an immediate flush when a request fails', async () => {
    const transport = vi.fn(async () => undefined)
    const manager = new MapImageSessionManager({
      random: () => 0.99,
      getSessionSeed: () => 'seed-session',
      transport,
    })

    const handle = manager.startRequest({
      surface: 'map',
      slotKey: 'dom-p1',
      slotType: 'dom-image',
      owner: 'dom-image',
      requestedCandidateUrl: 'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fexample.com%2Fp1.jpg',
      candidateIndex: 0,
      candidateCount: 1,
      reuseChain: false,
    })

    expect(handle.requestUrl).not.toContain('__mi_request=')

    manager.finishRequest(handle, {
      terminalState: 'failed',
      chainTerminal: true,
      finalUrl: handle.requestUrl,
      outcome: 'network_error',
    })

    await Promise.resolve()

    expect(transport).toHaveBeenCalledTimes(1)
    const firstTransportCall = transport.mock.calls.at(0) as any[] | undefined
    const payload = firstTransportCall?.[0] as any
    expect(payload.session.escalation_reason).toBe('failed')
    expect(payload.events).toHaveLength(2)
    expect(payload.events.map((event: any) => event.stage)).toEqual([
      'dom_request_start',
      'dom_request_terminal',
    ])
    expect(typeof payload.events[0].occurred_at).toBe('string')
  })

  it('flushes sampled sessions after the dwell timeout', async () => {
    const transport = vi.fn(async () => undefined)
    const manager = new MapImageSessionManager({
      random: () => 0,
      getSessionSeed: () => 'seed-session',
      transport,
    })

    manager.recordAnchor('map', 'map_shell_ready')

    expect(transport).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(2000)
    await Promise.resolve()
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('forces capture when explicit diagnostic mode is enabled', () => {
    const manager = new MapImageSessionManager({
      random: () => 0.99,
      getSessionSeed: () => 'seed-session',
      getForceCapture: () => true,
      transport: vi.fn(),
    })

    const handle = manager.startRequest({
      surface: 'map',
      slotKey: 'dom-p1',
      slotType: 'dom-image',
      owner: 'dom-image',
      requestedCandidateUrl: 'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fexample.com%2Fp1.jpg',
      candidateIndex: 0,
      candidateCount: 1,
      reuseChain: false,
    })

    expect(handle.requestUrl).toContain('__mi_request=')
    expect(manager.readSessionState()).toMatchObject({
      sessionId: 'seed-session',
      sampled: true,
    })
  })

  it('does not decorate proxy params for unsampled clean sessions', () => {
    const manager = new MapImageSessionManager({
      random: () => 0.99,
      getSessionSeed: () => 'seed-session',
      transport: vi.fn(),
    })

    const handle = manager.startRequest({
      surface: 'map',
      slotKey: 'dom-p1',
      slotType: 'dom-image',
      owner: 'dom-image',
      requestedCandidateUrl: 'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fexample.com%2Fp1.jpg',
      candidateIndex: 0,
      candidateCount: 1,
      reuseChain: false,
    })

    expect(handle.requestUrl).not.toContain('__mi_request=')
    expect(manager.readSessionState()).toMatchObject({
      sessionId: 'seed-session',
      sampled: false,
      escalationReason: null,
    })
  })

  it('decorates retry requests after failure escalates an unsampled session', () => {
    const manager = new MapImageSessionManager({
      random: () => 0.99,
      getSessionSeed: () => 'seed-session',
      transport: vi.fn(),
    })

    const first = manager.startRequest({
      surface: 'map',
      slotKey: 'dom-p1',
      slotType: 'dom-image',
      owner: 'dom-image',
      requestedCandidateUrl: 'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fexample.com%2Fp1.jpg',
      candidateIndex: 0,
      candidateCount: 2,
      reuseChain: false,
    })

    manager.finishRequest(first, {
      terminalState: 'failed',
      chainTerminal: false,
      finalUrl: first.requestUrl,
      outcome: 'network_error',
    })

    const retried = manager.startRequest({
      surface: 'map',
      slotKey: 'dom-p1',
      slotType: 'dom-image',
      owner: 'dom-image',
      requestedCandidateUrl: 'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fexample.com%2Fp1.jpg',
      candidateIndex: 1,
      candidateCount: 2,
      reuseChain: true,
    })

    expect(retried.requestUrl).toContain('__mi_request=')
    expect(retried.requestUrl).toContain('__mi_escalation=failed')
    expect(retried.requestUrl).toContain('__mi_surface=map')
    expect(retried.requestUrl).toContain('__mi_slot_key=dom-p1')
    expect(manager.readSessionState()).toMatchObject({
      escalationReason: 'failed',
    })
  })

  it('keeps buffered events when HTTP ingest responds non-ok', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 503 })) as typeof fetch
    try {
      const manager = new MapImageSessionManager({
        random: () => 0,
        getSessionSeed: () => 'seed-session',
      })

      manager.recordAnchor('map', 'map_shell_ready')
      await vi.advanceTimersByTimeAsync(2000)
      await Promise.resolve()

      expect(manager.readBufferedEvents()).toHaveLength(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('closes in-flight sampled requests as aborted on destroy', async () => {
    const transport = vi.fn(async () => undefined)
    const manager = new MapImageSessionManager({
      random: () => 0,
      getSessionSeed: () => 'seed-session',
      transport,
    })

    manager.startRequest({
      surface: 'map',
      slotKey: 'thumb-p1',
      slotType: 'point-thumbnail',
      owner: 'viewport-loader',
      requestedCandidateUrl: 'https://image.anitabi.cn/points/p1.jpg?plan=h160',
      candidateIndex: 0,
      candidateCount: 1,
      reuseChain: false,
    })

    manager.destroy()
    await Promise.resolve()

    expect(transport).toHaveBeenCalled()
    const lastCall = transport.mock.calls[transport.mock.calls.length - 1] as any[] | undefined
    const payload = lastCall?.[0] as any
    expect(payload.events.map((event: any) => event.stage)).toEqual([
      'viewport_loader_request_start',
      'viewport_loader_request_terminal',
    ])
    expect(payload.events[1]).toMatchObject({
      terminal_state: 'aborted',
    })
  })

  it('teardown handler closes in-flight sampled requests before flushing', async () => {
    const transport = vi.fn(async () => undefined)
    const manager = new MapImageSessionManager({
      random: () => 0,
      getSessionSeed: () => 'seed-session',
      transport,
    })

    manager.startRequest({
      surface: 'map',
      slotKey: 'thumb-p2',
      slotType: 'point-thumbnail',
      owner: 'viewport-loader',
      requestedCandidateUrl: 'https://image.anitabi.cn/points/p2.jpg?plan=h160',
      candidateIndex: 0,
      candidateCount: 1,
      reuseChain: false,
    })

    ;(manager as any).beforeUnloadHandler()
    await Promise.resolve()

    const lastCall = transport.mock.calls[transport.mock.calls.length - 1] as any[] | undefined
    const payload = lastCall?.[0] as any
    expect(payload.events.map((event: any) => event.stage)).toEqual([
      'viewport_loader_request_start',
      'viewport_loader_request_terminal',
    ])
    expect(payload.events[1]).toMatchObject({
      terminal_state: 'aborted',
    })
  })

  it('keeps buffered events when sendBeacon rejects the teardown batch', async () => {
    const originalFetch = globalThis.fetch
    const originalNavigator = globalThis.navigator
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        sendBeacon: vi.fn(() => false),
      },
      configurable: true,
    })
    try {
      const manager = new MapImageSessionManager({
        random: () => 0,
        getSessionSeed: () => 'seed-session',
      })

      manager.recordAnchor('map', 'map_shell_ready')
      ;(manager as any).beforeUnloadHandler()
      await Promise.resolve()
      await Promise.resolve()

      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      expect(manager.readBufferedEvents()).toHaveLength(0)
    } finally {
      globalThis.fetch = originalFetch
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      })
    }
  })

  it('queues a teardown flush when teardown happens during an active flush', async () => {
    const releaseTransportRef: { current: (() => void) | null } = { current: null }
    const firstTransport = new Promise<void>((resolve) => {
      releaseTransportRef.current = resolve
    })
    const transport = vi.fn(async (_payload, reason) => {
      if (reason === 'batch') {
        await firstTransport
      }
    })
    const manager = new MapImageSessionManager({
      random: () => 0,
      getSessionSeed: () => 'seed-session',
      transport,
    })

    manager.recordAnchor('map', 'map_shell_ready')
    await vi.advanceTimersByTimeAsync(2000)
    await Promise.resolve()
    expect(transport).toHaveBeenCalledTimes(1)

    const handle = manager.startRequest({
      surface: 'map',
      slotKey: 'thumb-p3',
      slotType: 'point-thumbnail',
      owner: 'viewport-loader',
      requestedCandidateUrl: 'https://image.anitabi.cn/points/p3.jpg?plan=h160',
      candidateIndex: 0,
      candidateCount: 1,
      reuseChain: false,
    })

    ;(manager as any).beforeUnloadHandler()
    if (releaseTransportRef.current) {
      releaseTransportRef.current()
    }
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve()
    }

    expect(transport.mock.calls.length).toBeGreaterThanOrEqual(2)
    const followupCalls = transport.mock.calls.slice(1)
    expect(followupCalls.some((call) => call[1] === 'teardown')).toBe(true)
    const followupPayload = followupCalls.find((call) => {
      const payload = call[0] as any
      return payload.events.some((event: any) => event.terminal_state === 'aborted')
    })?.[0] as any
    expect(followupPayload).toBeTruthy()
    expect(followupPayload.events.some((event: any) => event.request_id === handle.requestId)).toBe(true)
  })

  it('does not close active requests on BFCache pagehide events', async () => {
    const transport = vi.fn(async () => undefined)
    const manager = new MapImageSessionManager({
      random: () => 0,
      getSessionSeed: () => 'seed-session',
      transport,
    })

    const handle = manager.startRequest({
      surface: 'map',
      slotKey: 'thumb-p4',
      slotType: 'point-thumbnail',
      owner: 'viewport-loader',
      requestedCandidateUrl: 'https://image.anitabi.cn/points/p4.jpg?plan=h160',
      candidateIndex: 0,
      candidateCount: 1,
      reuseChain: false,
    })

    ;(manager as any).pageHideHandler({ persisted: true })
    await Promise.resolve()

    expect(transport).not.toHaveBeenCalled()
    expect(manager.finishRequest(handle, {
      terminalState: 'succeeded',
      chainTerminal: true,
      finalUrl: handle.requestUrl,
    })).toBe(true)
  })
})
