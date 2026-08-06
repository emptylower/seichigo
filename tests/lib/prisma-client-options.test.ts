import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const adapterOptions: Array<Record<string, unknown>> = []

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(options: Record<string, unknown>) {
      adapterOptions.push(options)
    }
  },
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

const testGlobal = globalThis as TestGlobal

async function createClient() {
  const { prisma } = await import('@/lib/db/prisma')
  void prisma.article
  return adapterOptions.at(-1)
}

describe('Prisma client runtime options', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('@/lib/db/prisma')
    adapterOptions.length = 0
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

  it('uses the bounded build-time Node pool with relaxed query timeouts', async () => {
    await expect(createClient()).resolves.toMatchObject({
      max: 5,
      connectionTimeoutMillis: 15_000,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    })
  })

  it('keeps the Cloudflare request pool and timeouts unchanged', async () => {
    testGlobal.__openNextAls = { getStore: () => ({ requestId: 'request-1' }) }

    await expect(createClient()).resolves.toMatchObject({
      max: 1,
      connectionTimeoutMillis: 8_000,
      query_timeout: 12_000,
      statement_timeout: 12_000,
    })
  })
})
