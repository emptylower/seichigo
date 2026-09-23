import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { createGoogleLegResolver, googleLegCacheRawKey, readCachedGoogleLegPayload } from '@/lib/routeBook/legResolverGoogle'

// 缓存替换为可控内存实现（routeLegCacheKey 保持真实 sha256）
const cachePayloads = new Map<string, Prisma.JsonValue>()
vi.mock('@/lib/routeBook/legCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/routeBook/legCache')>()
  return {
    ...actual,
    getCachedRoutePayload: vi.fn(async (key: string): Promise<Prisma.JsonValue | null> =>
      cachePayloads.has(key) ? (cachePayloads.get(key) as Prisma.JsonValue) : null,
    ),
    setCachedLeg: vi.fn(async (key: string, payload: Prisma.InputJsonValue) => {
      cachePayloads.set(key, payload as Prisma.JsonValue)
    }),
  }
})

/** Google 编码 polyline 的逆过程（测试造 fixture 用） */
function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let out = ''
  do {
    let chunk = v & 0x1f
    v >>>= 5
    if (v > 0) chunk |= 0x20
    out += String.fromCharCode(chunk + 63)
  } while (v > 0)
  return out
}

function encodePolyline(points: Array<[number, number]>): string {
  let prevLat = 0
  let prevLng = 0
  let out = ''
  for (const [lat, lng] of points) {
    const la = Math.round(lat * 1e5)
    const ln = Math.round(lng * 1e5)
    out += encodeValue(la - prevLat) + encodeValue(ln - prevLng)
    prevLat = la
    prevLng = ln
  }
  return out
}

const TOKYO_A = { lat: 35.68123, lng: 139.76712 }
const TOKYO_B = { lat: 35.70123, lng: 139.77712 }
const OUTSIDE = { lat: 37.7749, lng: -122.4194 } // 旧金山

function googleOkBody(opts?: { polyline?: string; legs?: Array<{ durationSeconds: number; distanceMeters: number }> }): string {
  const legs = opts?.legs ?? [{ durationSeconds: 734, distanceMeters: 1287 }]
  return JSON.stringify({
    status: 'OK',
    routes: [
      {
        legs: legs.map((leg) => ({
          duration: { text: '12 mins', value: leg.durationSeconds },
          distance: { text: '1.3 km', value: leg.distanceMeters },
          steps: [],
        })),
        ...(opts?.polyline !== undefined ? { overview_polyline: { points: opts.polyline } } : {}),
      },
    ],
  })
}

function makeFetch(bodies: Array<{ status: number; body: string }>) {
  const impl = vi.fn(async (_input: RequestInfo | URL) => {
    const next = bodies.shift() ?? { status: 200, body: googleOkBody() }
    return new Response(next.body, { status: next.status })
  })
  return impl
}

beforeEach(() => {
  cachePayloads.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('googleLegCacheRawKey / readCachedGoogleLegPayload', () => {
  it('raw key 形如 leg|mode|lat5,lng5|lat5,lng5（坐标 5 位定点）', () => {
    expect(googleLegCacheRawKey('walking', TOKYO_A, TOKYO_B)).toBe(
      'leg|walking|35.68123,139.76712|35.70123,139.77712'
    )
  })

  it('合法 payload 通过；source 非 google / 字段非法 / polyline 点形状错 → null', () => {
    const valid = { durationSec: 600, distanceM: 1000, polyline: [[35.68, 139.76], [35.7, 139.77]], source: 'google' }
    expect(readCachedGoogleLegPayload(valid)).toEqual(valid)
    expect(readCachedGoogleLegPayload({ ...valid, source: 'heuristic' })).toBeNull()
    expect(readCachedGoogleLegPayload({ ...valid, durationSec: 0 })).toBeNull()
    expect(readCachedGoogleLegPayload({ ...valid, distanceM: -1 })).toBeNull()
    expect(readCachedGoogleLegPayload({ ...valid, polyline: [[35.68]] })).toBeNull()
    expect(readCachedGoogleLegPayload({ ...valid, polyline: [['a', 'b']] })).toBeNull()
    expect(readCachedGoogleLegPayload({ ...valid, polyline: 'x' })).toBeNull()
    expect(readCachedGoogleLegPayload({ ...valid, polyline: null })).toEqual({ ...valid, polyline: null })
    expect(readCachedGoogleLegPayload(null)).toBeNull()
    expect(readCachedGoogleLegPayload('x')).toBeNull()
  })
})

describe('createGoogleLegResolver', () => {
  it('transit 一律返回 null，不调上游（日本境内 Google 无公交数据）', async () => {
    const fetchImpl = makeFetch([{ status: 200, body: googleOkBody() }])
    const resolver = createGoogleLegResolver({ apiKey: 'g-key', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(resolver(TOKYO_A, TOKYO_B, 'transit')).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('任一端在日本列岛 bbox 外返回 null，不调上游', async () => {
    const fetchImpl = makeFetch([{ status: 200, body: googleOkBody() }])
    const resolver = createGoogleLegResolver({ apiKey: 'g-key', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(resolver(OUTSIDE, TOKYO_B, 'walking')).resolves.toBeNull()
    await expect(resolver(TOKYO_A, OUTSIDE, 'driving')).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('没有 apiKey 返回 null，不调上游', async () => {
    const fetchImpl = makeFetch([{ status: 200, body: googleOkBody() }])
    const resolver = createGoogleLegResolver({ apiKey: '', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(resolver(TOKYO_A, TOKYO_B, 'walking')).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('上游 500 / status 非 OK / fetch 抛错 / 无 legs 都返回 null', async () => {
    for (const body of [
      makeFetch([{ status: 500, body: 'boom' }]),
      makeFetch([{ status: 200, body: JSON.stringify({ status: 'ZERO_RESULTS' }) }]),
    ]) {
      const resolver = createGoogleLegResolver({ apiKey: 'g-key', fetchImpl: body as unknown as typeof fetch })
      await expect(resolver(TOKYO_A, TOKYO_B, 'walking')).resolves.toBeNull()
    }

    const throwing = vi.fn(async () => {
      throw new Error('network down')
    })
    const throwResolver = createGoogleLegResolver({ apiKey: 'g-key', fetchImpl: throwing as unknown as typeof fetch })
    await expect(throwResolver(TOKYO_A, TOKYO_B, 'walking')).resolves.toBeNull()

    const noLegs = makeFetch([{ status: 200, body: JSON.stringify({ status: 'OK', routes: [{ legs: [] }] }) }])
    const noLegsResolver = createGoogleLegResolver({ apiKey: 'g-key', fetchImpl: noLegs as unknown as typeof fetch })
    await expect(noLegsResolver(TOKYO_A, TOKYO_B, 'walking')).resolves.toBeNull()
  })

  it('成功：请求参数正确，返回总时长/距离与解码 polyline，并写缓存', async () => {
    const polyline = encodePolyline([
      [35.68123, 139.76712],
      [35.69123, 139.77212],
      [35.70123, 139.77712],
    ])
    const fetchImpl = makeFetch([{ status: 200, body: googleOkBody({ polyline, legs: [{ durationSeconds: 400, distanceMeters: 800 }, { durationSeconds: 334, distanceMeters: 487 }] }) }])
    const resolver = createGoogleLegResolver({ apiKey: 'g-key', fetchImpl: fetchImpl as unknown as typeof fetch })

    const resolved = await resolver(TOKYO_A, TOKYO_B, 'walking')
    expect(resolved).toEqual({
      durationSec: 734,
      distanceM: 1287,
      polyline: [
        [35.68123, 139.76712],
        [35.69123, 139.77212],
        [35.70123, 139.77712],
      ],
      source: 'google',
    })

    const url = new URL(String(fetchImpl.mock.calls[0]![0]))
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/directions/json')
    expect(url.searchParams.get('origin')).toBe('35.68123,139.76712')
    expect(url.searchParams.get('destination')).toBe('35.70123,139.77712')
    expect(url.searchParams.get('mode')).toBe('walking')
    expect(url.searchParams.get('key')).toBe('g-key')

    // 缓存写入
    const { routeLegCacheKey } = await import('@/lib/routeBook/legCache')
    const expectedKey = routeLegCacheKey(googleLegCacheRawKey('walking', TOKYO_A, TOKYO_B))
    expect(cachePayloads.get(expectedKey)).toEqual(resolved)
  })

  it('无 overview_polyline 时 polyline 为 null', async () => {
    const fetchImpl = makeFetch([{ status: 200, body: googleOkBody() }])
    const resolver = createGoogleLegResolver({ apiKey: 'g-key', fetchImpl: fetchImpl as unknown as typeof fetch })
    const resolved = await resolver(TOKYO_A, TOKYO_B, 'driving')
    expect(resolved).toMatchObject({ durationSec: 734, distanceM: 1287, polyline: null, source: 'google' })
  })

  it('缓存命中直接返回，不再调上游', async () => {
    const { routeLegCacheKey } = await import('@/lib/routeBook/legCache')
    const key = routeLegCacheKey(googleLegCacheRawKey('walking', TOKYO_A, TOKYO_B))
    cachePayloads.set(key, { durationSec: 500, distanceM: 900, polyline: null, source: 'google' })

    const fetchImpl = makeFetch([{ status: 200, body: googleOkBody() }])
    const resolver = createGoogleLegResolver({ apiKey: 'g-key', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(resolver(TOKYO_A, TOKYO_B, 'walking')).resolves.toEqual({
      durationSec: 500,
      distanceM: 900,
      polyline: null,
      source: 'google',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('缓存里的脏数据（source 非 google）按未命中处理，重新调上游', async () => {
    const { routeLegCacheKey } = await import('@/lib/routeBook/legCache')
    const key = routeLegCacheKey(googleLegCacheRawKey('walking', TOKYO_A, TOKYO_B))
    cachePayloads.set(key, { durationSec: 1, distanceM: 1, source: 'heuristic' })

    const fetchImpl = makeFetch([{ status: 200, body: googleOkBody() }])
    const resolver = createGoogleLegResolver({ apiKey: 'g-key', fetchImpl: fetchImpl as unknown as typeof fetch })
    const resolved = await resolver(TOKYO_A, TOKYO_B, 'walking')
    expect(resolved).toMatchObject({ source: 'google' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
