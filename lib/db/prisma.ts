import { PrismaPg } from '@prisma/adapter-pg'
// The runtime package selects Prisma's Node loader during Next.js
// prerendering and its explicit WASM loader when OpenNext bundles with the
// `workerd` condition. Keep this conditional entry: the Node loader crashes in
// Workers, while Node cannot consume the Worker loader's module shape.
import { PrismaClient } from '@seichigo/prisma-client-runtime'

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
  // eslint-disable-next-line no-var
  var prismaByRequestId: Map<string, { client: PrismaClient; createdAt: number }> | undefined
}

type OpenNextRequestContextLike = {
  requestId?: string
  waitUntil?: (promise: Promise<unknown>) => void
}

const DEFAULT_POOL_MAX = 5
const CLOUDFLARE_POOL_MAX = 1
const DEFAULT_CONNECTION_TIMEOUT_MS = 15_000
const DEFAULT_QUERY_TIMEOUT_MS = 30_000
const CLOUDFLARE_CONNECTION_TIMEOUT_MS = 8_000
const CLOUDFLARE_QUERY_TIMEOUT_MS = 12_000
const REQUEST_CLIENT_TTL_MS = 30_000

type PrismaClientOptions = {
  max?: number
  connectionTimeoutMillis?: number
  queryTimeoutMillis?: number
}

function createPrismaClient(options?: PrismaClientOptions) {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  // Cloudflare Workers cannot run Prisma's Rust query engine. Use the JS engine with
  // the pg driver adapter so the same client code works in both Node and Workers.
  const adapter = new PrismaPg({
    connectionString,
    max: options?.max ?? DEFAULT_POOL_MAX,
    connectionTimeoutMillis: options?.connectionTimeoutMillis ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    query_timeout: options?.queryTimeoutMillis ?? DEFAULT_QUERY_TIMEOUT_MS,
    statement_timeout: options?.queryTimeoutMillis ?? DEFAULT_QUERY_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
  })

  return new PrismaClient({ adapter })
}

function getOpenNextRequestContext(): OpenNextRequestContextLike | null {
  const als = (globalThis as typeof globalThis & {
    __openNextAls?: { getStore?: () => OpenNextRequestContextLike | undefined }
  }).__openNextAls

  if (!als || typeof als.getStore !== 'function') return null
  return als.getStore?.() ?? null
}

function getGlobalPrismaClient(): PrismaClient {
  if (!global.prisma) {
    global.prisma = createPrismaClient()
  }

  return global.prisma
}

function pruneExpiredRequestClients(activeRequestId?: string) {
  const byRequestId = global.prismaByRequestId
  if (!byRequestId?.size) return

  const now = Date.now()
  for (const [requestId, entry] of byRequestId) {
    if (requestId === activeRequestId) continue
    if (now - entry.createdAt < REQUEST_CLIENT_TTL_MS) continue

    byRequestId.delete(requestId)
    void entry.client.$disconnect().catch(() => undefined)
  }
}

function getRequestScopedPrismaClient(): PrismaClient | null {
  const context = getOpenNextRequestContext()
  const requestId = typeof context?.requestId === 'string' ? context.requestId.trim() : ''
  if (!requestId) return null

  pruneExpiredRequestClients(requestId)

  const byRequestId = global.prismaByRequestId || new Map<string, { client: PrismaClient; createdAt: number }>()
  global.prismaByRequestId = byRequestId

  const existing = byRequestId.get(requestId)
  if (existing) return existing.client

  // Cloudflare Workers cancel cross-request socket reuse. Keep Prisma scoped to
  // the active request and keep the pool size at 1 to avoid connection fan-out.
  const created = createPrismaClient({
    max: CLOUDFLARE_POOL_MAX,
    connectionTimeoutMillis: CLOUDFLARE_CONNECTION_TIMEOUT_MS,
    queryTimeoutMillis: CLOUDFLARE_QUERY_TIMEOUT_MS,
  })
  byRequestId.set(requestId, { client: created, createdAt: Date.now() })

  return created
}

function getPrismaClient(): PrismaClient {
  return getRequestScopedPrismaClient() || getGlobalPrismaClient()
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrismaClient() as unknown as Record<PropertyKey, unknown>
    const value = Reflect.get(client, prop, receiver)
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
})
