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
  var prismaByRequestId: Map<string, RequestScopedClientEntry> | undefined
}

type OpenNextRequestContextLike = {
  requestId?: string
  waitUntil?: (promise: Promise<unknown>) => void
}

/**
 * Request-scoped client bookkeeping.
 *
 * `lastUsedAt` drives pruning: idle age, not creation age — a client serving a
 * 100s plan-agent conversation must not be judged "expired" merely for having
 * been created more than TTL ago.
 *
 * `activeTransactions` counts in-flight `$transaction()` calls. Prisma's
 * engine cancels all open transactions when a client disconnects, so a
 * concurrent request's prune disconnecting a client mid-transaction surfaces as
 * "Transaction not found ... or was obtained before disconnecting" errors in
 * the middle of a conversation. Clients with an open transaction are never
 * pruned, even past the TTL.
 */
type RequestScopedClientEntry = {
  client: PrismaClient
  createdAt: number
  lastUsedAt: number
  activeTransactions: number
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
    if (now - entry.lastUsedAt < REQUEST_CLIENT_TTL_MS) continue
    if (entry.activeTransactions > 0) continue

    byRequestId.delete(requestId)
    void entry.client.$disconnect().catch(() => undefined)
  }
}

function getRequestScopedClientEntry(): RequestScopedClientEntry | null {
  const context = getOpenNextRequestContext()
  const requestId = typeof context?.requestId === 'string' ? context.requestId.trim() : ''
  if (!requestId) return null

  pruneExpiredRequestClients(requestId)

  const byRequestId = global.prismaByRequestId || new Map<string, RequestScopedClientEntry>()
  global.prismaByRequestId = byRequestId

  const existing = byRequestId.get(requestId)
  if (existing) {
    existing.lastUsedAt = Date.now()
    return existing
  }

  // Cloudflare Workers cancel cross-request socket reuse. Keep Prisma scoped to
  // the active request and keep the pool size at 1 to avoid connection fan-out.
  const created = createPrismaClient({
    max: CLOUDFLARE_POOL_MAX,
    connectionTimeoutMillis: CLOUDFLARE_CONNECTION_TIMEOUT_MS,
    queryTimeoutMillis: CLOUDFLARE_QUERY_TIMEOUT_MS,
  })
  const entry: RequestScopedClientEntry = {
    client: created,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    activeTransactions: 0,
  }
  byRequestId.set(requestId, entry)

  return entry
}

function resolvePrismaClient(): { client: PrismaClient; entry: RequestScopedClientEntry | null } {
  const entry = getRequestScopedClientEntry()
  if (entry) return { client: entry.client, entry }
  return { client: getGlobalPrismaClient(), entry: null }
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const { client, entry } = resolvePrismaClient()
    const value = Reflect.get(client, prop, receiver)
    if (typeof value === 'function') {
      if (prop === '$transaction' && entry) {
        const bound = value.bind(client) as (...args: unknown[]) => Promise<unknown>
        return (...args: unknown[]) => {
          entry.activeTransactions++
          return bound(...args).finally(() => {
            entry.activeTransactions--
          })
        }
      }
      return value.bind(client)
    }
    return value
  },
})
