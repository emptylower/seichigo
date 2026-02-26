import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHandlers } from '@/lib/directions/handlers/directions'
import type { DirectionsHandlerDeps } from '@/lib/directions/handlers/directions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides?: Partial<DirectionsHandlerDeps>): DirectionsHandlerDeps {
  return {
    getSession: vi.fn().mockResolvedValue({ user: { id: 'user-1', name: 'Test' } }),
    apiKey: 'test-api-key',
    ...overrides,
  }
}

function makeRequest(params: Record<string, string> = {}): Request {
  const url = new URL('http://localhost/api/me/routebooks/rb-1/directions')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return new Request(url.toString())
}

function googleOkResponse(legs: unknown[] = []) {
  return {
    ok: true,
    json: async () => ({
      status: 'OK',
      routes: [{ legs }],
    }),
  } as unknown as Response
}

function googleErrorResponse(status: string, errorMessage?: string) {
  return {
    ok: true,
    json: async () => ({
      status,
      error_message: errorMessage,
      routes: [],
    }),
  } as unknown as Response
}

function googleHttpError(httpStatus: number) {
  return {
    ok: false,
    status: httpStatus,
    json: async () => ({}),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('directions handler - auth', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when session is null', async () => {
    const deps = makeDeps({ getSession: vi.fn().mockResolvedValue(null) })
    const res = await createHandlers(deps).GET(makeRequest({ origin: 'A', destination: 'B' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 401 when session has no user id', async () => {
    const deps = makeDeps({ getSession: vi.fn().mockResolvedValue({ user: {} }) })
    const res = await createHandlers(deps).GET(makeRequest({ origin: 'A', destination: 'B' }))
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('directions handler - validation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 400 when origin is missing', async () => {
    const deps = makeDeps()
    const res = await createHandlers(deps).GET(makeRequest({ destination: 'B' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when destination is missing', async () => {
    const deps = makeDeps()
    const res = await createHandlers(deps).GET(makeRequest({ origin: 'A' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid mode', async () => {
    const deps = makeDeps()
    const res = await createHandlers(deps).GET(
      makeRequest({ origin: 'A', destination: 'B', mode: 'bicycle' }),
    )
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Successful fetch + response parsing
// ---------------------------------------------------------------------------

describe('directions handler - success', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches from Google API and returns parsed legs', async () => {
    const rawLeg = {
      start_address: 'Tokyo Station',
      end_address: 'Shibuya Station',
      duration: { text: '25 min', value: 1500 },
      distance: { text: '12 km', value: 12000 },
      steps: [
        {
          travel_mode: 'TRANSIT',
          html_instructions: 'Take <b>JR Yamanote</b>',
          duration: { text: '20 min', value: 1200 },
          distance: { text: '10 km', value: 10000 },
          transit_details: {
            line: { short_name: 'JR', name: 'Yamanote Line' },
            departure_stop: { name: 'Tokyo' },
            arrival_stop: { name: 'Shibuya' },
            num_stops: 5,
          },
        },
        {
          travel_mode: 'WALKING',
          html_instructions: 'Walk to exit',
          duration: { text: '5 min', value: 300 },
          distance: { text: '400 m', value: 400 },
        },
      ],
    }

    const fetchMock = vi.fn().mockResolvedValue(googleOkResponse([rawLeg]))
    vi.stubGlobal('fetch', fetchMock)

    const deps = makeDeps()
    const res = await createHandlers(deps).GET(
      makeRequest({ origin: 'Tokyo', destination: 'Shibuya', mode: 'transit' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.legs).toHaveLength(1)

    const leg = body.legs[0]
    expect(leg.startAddress).toBe('Tokyo Station')
    expect(leg.endAddress).toBe('Shibuya Station')
    expect(leg.durationSeconds).toBe(1500)
    expect(leg.distanceMeters).toBe(12000)
    expect(leg.steps).toHaveLength(2)

    // Transit step
    expect(leg.steps[0].travelMode).toBe('TRANSIT')
    expect(leg.steps[0].instruction).toBe('Take JR Yamanote') // HTML stripped
    expect(leg.steps[0].transitDetails).toMatchObject({
      lineName: 'JR',
      departureStop: 'Tokyo',
      arrivalStop: 'Shibuya',
      numStops: 5,
    })

    // Walking step
    expect(leg.steps[1].travelMode).toBe('WALKING')
    expect(leg.steps[1].transitDetails).toBeNull()
  })

  it('passes waypoints to Google API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(googleOkResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const deps = makeDeps()
    await createHandlers(deps).GET(
      makeRequest({ origin: 'A', destination: 'C', waypoints: 'B', mode: 'driving' }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('waypoints=B')
    expect(calledUrl).toContain('mode=driving')
    expect(calledUrl).toContain('key=test-api-key')
  })

  it('omits waypoints for transit requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(googleOkResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const deps = makeDeps()
    await createHandlers(deps).GET(
      makeRequest({ origin: 'A', destination: 'C', waypoints: 'B', mode: 'transit' }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('mode=transit')
    expect(calledUrl).not.toContain('waypoints=')
  })

  it('defaults mode to transit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(googleOkResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const deps = makeDeps()
    await createHandlers(deps).GET(makeRequest({ origin: 'A', destination: 'B' }))

    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('mode=transit')
  })
})

// ---------------------------------------------------------------------------
// Cache behavior
// ---------------------------------------------------------------------------

describe('directions handler - cache', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns cached result on second call with same params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(googleOkResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const params = { origin: 'cache-A', destination: 'cache-B', mode: 'transit' as const }

    // First call → fetches
    const res1 = await handlers.GET(makeRequest(params))
    expect(res1.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Second call → cached (no additional fetch)
    const res2 = await handlers.GET(makeRequest(params))
    expect(res2.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetches again when params differ', async () => {
    const fetchMock = vi.fn().mockResolvedValue(googleOkResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const deps = makeDeps()
    const handlers = createHandlers(deps)

    await handlers.GET(makeRequest({ origin: 'diff-A', destination: 'diff-B' }))
    await handlers.GET(makeRequest({ origin: 'diff-A', destination: 'diff-C' }))

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe('directions handler - rate limiting', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(googleOkResponse([])))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 429 after exceeding rate limit', async () => {
    // Use a unique user to avoid cache collisions with other tests
    const userId = `rate-limit-user-${Date.now()}`
    const deps = makeDeps({
      getSession: vi.fn().mockResolvedValue({ user: { id: userId, name: 'RL' } }),
    })
    const handlers = createHandlers(deps)

    // Each request needs unique params to avoid cache hits
    for (let i = 0; i < 10; i++) {
      const res = await handlers.GET(
        makeRequest({ origin: `rl-origin-${i}`, destination: `rl-dest-${i}` }),
      )
      expect(res.status).toBe(200)
    }

    // 11th request should be rate limited
    const res = await handlers.GET(
      makeRequest({ origin: 'rl-origin-overflow', destination: 'rl-dest-overflow' }),
    )
    expect(res.status).toBe(429)
  })
})

// ---------------------------------------------------------------------------
// Google API error handling
// ---------------------------------------------------------------------------

describe('directions handler - Google API errors', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 502 when Google API returns HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(googleHttpError(500)))

    const deps = makeDeps({
      getSession: vi.fn().mockResolvedValue({ user: { id: 'err-user-1' } }),
    })
    const res = await createHandlers(deps).GET(
      makeRequest({ origin: 'err-A', destination: 'err-B' }),
    )
    expect(res.status).toBe(502)
  })

  it('returns 400 with message for ZERO_RESULTS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(googleErrorResponse('ZERO_RESULTS')))

    const deps = makeDeps({
      getSession: vi.fn().mockResolvedValue({ user: { id: 'err-user-2' } }),
    })
    const res = await createHandlers(deps).GET(
      makeRequest({ origin: 'zero-A', destination: 'zero-B' }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('未找到路线')
  })

  it('returns 502 for REQUEST_DENIED with graceful message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(googleErrorResponse('REQUEST_DENIED', 'bad key')))

    const deps = makeDeps({
      getSession: vi.fn().mockResolvedValue({ user: { id: 'err-user-3' } }),
    })
    const res = await createHandlers(deps).GET(
      makeRequest({ origin: 'deny-A', destination: 'deny-B' }),
    )
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toContain('API 配置异常')
  })

  it('returns 400 when no routes in response', async () => {
    const noRouteResponse = {
      ok: true,
      json: async () => ({ status: 'OK', routes: [] }),
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(noRouteResponse))

    const deps = makeDeps({
      getSession: vi.fn().mockResolvedValue({ user: { id: 'err-user-4' } }),
    })
    const res = await createHandlers(deps).GET(
      makeRequest({ origin: 'noroute-A', destination: 'noroute-B' }),
    )
    expect(res.status).toBe(400)
  })
})
