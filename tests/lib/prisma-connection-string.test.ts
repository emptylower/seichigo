import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'

const { prismaPgConstructs } = vi.hoisted(() => ({
  prismaPgConstructs: [] as Array<{ connectionString?: string }>,
}))

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(options: { connectionString?: string }) {
      prismaPgConstructs.push(options)
    }
  },
}))

vi.mock('@seichigo/prisma-client-runtime', () => ({
  PrismaClient: class {
    readonly article = {}
  },
}))

// Same symbol slot getCfBindings() reads (lib/anitabi/cf/bindings.ts).
const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

type CloudflareContextSlot = typeof globalThis & {
  [CLOUDFLARE_CONTEXT_SYMBOL]?: { env?: Record<string, unknown> }
}

type TestGlobal = typeof globalThis & {
  prisma?: unknown
  prismaByRequestId?: Map<string, unknown>
  __openNextAls?: unknown
}

const testGlobal = globalThis as TestGlobal
const POOLED_URL = 'postgresql://hyperdrive-pooled:5432/db'
const DIRECT_URL = 'postgresql://hyperdrive-direct:5432/db'
const ENV_URL = 'postgresql://env-fallback:5432/db'

function setCfBindingsEnv(env?: Record<string, unknown>) {
  const slot = globalThis as CloudflareContextSlot
  if (env) {
    slot[CLOUDFLARE_CONTEXT_SYMBOL] = { env }
  } else {
    delete slot[CLOUDFLARE_CONTEXT_SYMBOL]
  }
}

/**
 * Return the proxy wrapped: `await`-ing a bare proxy probes `.then` on it
 * (promise thenability), which fires the module's get trap inside this helper
 * itself — too early for tests that assert on guarded property access.
 */
async function loadPrismaModule() {
  const mod = await import('@/lib/db/prisma')
  return { prisma: mod.prisma as unknown as Record<string, unknown> }
}

/** Touch the proxy so it resolves a (global) client and builds a PrismaPg. */
async function createClientViaProxy() {
  const { prisma } = await loadPrismaModule()
  void prisma.article
}

describe('Prisma connection string selection (Hyperdrive)', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  const originalHyperdriveEndpoint = process.env.HYPERDRIVE_ENDPOINT
  let logSpy: MockInstance

  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('@/lib/db/prisma')
    prismaPgConstructs.length = 0
    process.env.DATABASE_URL = ENV_URL
    delete process.env.HYPERDRIVE_ENDPOINT
    delete testGlobal.prisma
    delete testGlobal.prismaByRequestId
    delete testGlobal.__openNextAls
    setCfBindingsEnv(undefined)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl
    if (originalHyperdriveEndpoint === undefined) {
      delete process.env.HYPERDRIVE_ENDPOINT
    } else {
      process.env.HYPERDRIVE_ENDPOINT = originalHyperdriveEndpoint
    }
    delete testGlobal.prisma
    delete testGlobal.prismaByRequestId
    delete testGlobal.__openNextAls
    setCfBindingsEnv(undefined)
    logSpy.mockRestore()
  })

  it('HYPERDRIVE_ENDPOINT=pooled uses the HYPERDRIVE binding', async () => {
    process.env.HYPERDRIVE_ENDPOINT = 'pooled'
    setCfBindingsEnv({
      HYPERDRIVE: { connectionString: POOLED_URL },
      HYPERDRIVE_DIRECT: { connectionString: DIRECT_URL },
    })

    await createClientViaProxy()

    expect(prismaPgConstructs).toHaveLength(1)
    expect(prismaPgConstructs[0]?.connectionString).toBe(POOLED_URL)
  })

  it('HYPERDRIVE_ENDPOINT unset defaults to the pooled binding', async () => {
    setCfBindingsEnv({ HYPERDRIVE: { connectionString: POOLED_URL } })

    await createClientViaProxy()

    expect(prismaPgConstructs[0]?.connectionString).toBe(POOLED_URL)
  })

  it('HYPERDRIVE_ENDPOINT=direct uses the HYPERDRIVE_DIRECT binding', async () => {
    process.env.HYPERDRIVE_ENDPOINT = 'direct'
    setCfBindingsEnv({
      HYPERDRIVE: { connectionString: POOLED_URL },
      HYPERDRIVE_DIRECT: { connectionString: DIRECT_URL },
    })

    await createClientViaProxy()

    expect(prismaPgConstructs[0]?.connectionString).toBe(DIRECT_URL)
  })

  it('HYPERDRIVE_ENDPOINT=off ignores bindings and uses DATABASE_URL', async () => {
    process.env.HYPERDRIVE_ENDPOINT = 'off'
    setCfBindingsEnv({ HYPERDRIVE: { connectionString: POOLED_URL } })

    await createClientViaProxy()

    expect(prismaPgConstructs[0]?.connectionString).toBe(ENV_URL)
  })

  it('falls back to DATABASE_URL when no binding exists (build / next start)', async () => {
    // No cloudflare context at all — the exact shape of Next prerendering
    // and local `next start`, which must keep working without bindings.
    await createClientViaProxy()

    expect(prismaPgConstructs).toHaveLength(1)
    expect(prismaPgConstructs[0]?.connectionString).toBe(ENV_URL)
  })

  it('falls back to DATABASE_URL when the selected binding is missing', async () => {
    process.env.HYPERDRIVE_ENDPOINT = 'pooled'
    // Only the direct binding exists; the pooled selector silently falls back.
    setCfBindingsEnv({ HYPERDRIVE_DIRECT: { connectionString: DIRECT_URL } })

    await createClientViaProxy()

    expect(prismaPgConstructs[0]?.connectionString).toBe(ENV_URL)
  })

  it('throws the original error when neither binding nor DATABASE_URL exists', async () => {
    delete process.env.DATABASE_URL

    const { prisma } = await loadPrismaModule()

    expect(() => void prisma.article).toThrow('DATABASE_URL is not set')
  })

  it('logs the active source once per process, not once per client', async () => {
    setCfBindingsEnv({ HYPERDRIVE: { connectionString: POOLED_URL } })

    await createClientViaProxy()
    // A second client in the same process (global slot dropped) must not log again.
    delete testGlobal.prisma
    await createClientViaProxy()

    expect(prismaPgConstructs).toHaveLength(2)
    const sourceLogs = logSpy.mock.calls.filter((call) => String(call[0]).includes('[db]'))
    expect(sourceLogs).toHaveLength(1)
    expect(String(sourceLogs[0]?.[0])).toContain('hyperdrive-pooled')
  })
})
