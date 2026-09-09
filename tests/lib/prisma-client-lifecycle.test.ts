import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {},
}))

vi.mock('@seichigo/prisma-client-runtime', () => ({
  PrismaClient: class {
    readonly article = {}
  },
}))

type TestGlobal = typeof globalThis & {
  prisma?: unknown
  prismaByRequestId?: Map<string, unknown>
  __openNextAls?: { getStore: () => { requestId: string } | undefined }
}

type SeededEntry = {
  client: FakeRequestClient
  createdAt: number
  lastUsedAt: number
  activeTransactions: number
}

class FakeRequestClient {
  readonly article = {}
  disconnectCalls = 0
  async $disconnect() {
    this.disconnectCalls++
  }
  $transaction(arg: (tx: unknown) => unknown) {
    return Promise.resolve(arg({}))
  }
}

const testGlobal = globalThis as TestGlobal
let currentRequestId: string | undefined

function useRequestContext(requestId: string | undefined) {
  currentRequestId = requestId
  testGlobal.__openNextAls = requestId
    ? { getStore: () => (currentRequestId ? { requestId: currentRequestId } : undefined) }
    : undefined
}

function seedRequestClient(requestId: string, ageMs: number): FakeRequestClient {
  const client = new FakeRequestClient()
  const stale = Date.now() - ageMs
  // lib/db/prisma 的 declare global 把 prismaByRequestId 定型为
  // Map<string, RequestScopedClientEntry>；测试替身结构兼容但名义类型不同，
  // 用双重断言保持运行时行为不变。
  testGlobal.prismaByRequestId = new Map<string, SeededEntry>([
    [requestId, { client, createdAt: stale, lastUsedAt: stale, activeTransactions: 0 }],
  ]) as unknown as typeof testGlobal.prismaByRequestId
  return client
}

function seededEntry(requestId: string): SeededEntry {
  const entry = testGlobal.prismaByRequestId?.get(requestId)
  if (!entry) throw new Error(`no seeded entry for ${requestId}`)
  return entry as unknown as SeededEntry
}

async function loadPrismaProxy() {
  const { prisma } = await import('@/lib/db/prisma')
  return prisma as unknown as Record<string, unknown> & {
    $transaction: (arg: (tx: unknown) => unknown) => Promise<unknown>
  }
}

describe('Request-scoped Prisma client lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('@/lib/db/prisma')
    process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/test'
    delete testGlobal.prisma
    delete testGlobal.prismaByRequestId
    delete testGlobal.__openNextAls
  })

  afterEach(() => {
    delete testGlobal.prisma
    delete testGlobal.prismaByRequestId
    delete testGlobal.__openNextAls
  })

  it('prunes idle expired request clients', async () => {
    const prisma = await loadPrismaProxy()
    const stale = seedRequestClient('req-old', 60_000)

    useRequestContext('req-old')
    useRequestContext('req-new')
    void prisma.article

    expect(stale.disconnectCalls).toBe(1)
  })

  it('does not disconnect a client while one of its $transaction calls is still open', async () => {
    const prisma = await loadPrismaProxy()
    const stale = seedRequestClient('req-old', 60_000)

    useRequestContext('req-old')
    // tsconfig lib 停在 ES2022（无 Promise.withResolvers 类型），手写等价 gate。
    let gatedResolve!: (value: string) => void
    const gatedPromise = new Promise<string>((resolve) => {
      gatedResolve = resolve
    })
    const gated = { promise: gatedPromise, resolve: gatedResolve }
    const open = prisma.$transaction(async () => gated.promise)
    // Long-running conversation turn: the transaction outlives the TTL.
    seededEntry('req-old').lastUsedAt = Date.now() - 60_000

    useRequestContext('req-new')
    void prisma.article
    expect(stale.disconnectCalls).toBe(0)

    gated.resolve('ok')
    await expect(open).resolves.toBe('ok')

    useRequestContext('req-new')
    void prisma.article
    expect(stale.disconnectCalls).toBe(1)
  })

  it('releases the transaction pin when the transaction rejects', async () => {
    const prisma = await loadPrismaProxy()
    const stale = seedRequestClient('req-old', 60_000)

    useRequestContext('req-old')
    const open = prisma.$transaction(async () => {
      throw new Error('boom')
    })
    await expect(open).rejects.toThrow('boom')
    seededEntry('req-old').lastUsedAt = Date.now() - 60_000

    useRequestContext('req-new')
    void prisma.article
    expect(stale.disconnectCalls).toBe(1)
  })

  it('keeps a recently used client alive regardless of its creation age', async () => {
    const prisma = await loadPrismaProxy()
    // Created a minute ago, but still being used by its long-running request.
    const old = seedRequestClient('req-old', 60_000)

    useRequestContext('req-old')
    void prisma.article // refreshes usage timestamp

    useRequestContext('req-new')
    void prisma.article
    expect(old.disconnectCalls).toBe(0)
  })

  it('never prunes the active request own client', async () => {
    const prisma = await loadPrismaProxy()
    const mine = seedRequestClient('req-me', 60_000)

    useRequestContext('req-me')
    void prisma.article
    void prisma.article

    expect(mine.disconnectCalls).toBe(0)
  })
})
