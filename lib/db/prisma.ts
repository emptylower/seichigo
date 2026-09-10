import { PrismaPg } from '@prisma/adapter-pg'
// The runtime package selects Prisma's Node loader during Next.js
// prerendering and its explicit WASM loader when OpenNext bundles with the
// `workerd` condition. Keep this conditional entry: the Node loader crashes in
// Workers, while Node cannot consume the Worker loader's module shape.
import { PrismaClient } from '@seichigo/prisma-client-runtime'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'

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

type ConnectionStringSource = 'hyperdrive-pooled' | 'hyperdrive-direct' | 'env-fallback'

/**
 * Pick the Postgres connection string for a new client.
 *
 * Hyperdrive binding (when reachable in the current context) per
 * `HYPERDRIVE_ENDPOINT` (`pooled` default / `direct` / `off`), else
 * `process.env.DATABASE_URL`. The env fallback is a hard requirement, not
 * an escape hatch: Next prerendering and local `next start` run in Node
 * with no Worker bindings, so a missing binding must stay silent.
 */
function resolveConnectionString(): { source: ConnectionStringSource; connectionString: string } {
  const endpoint = process.env.HYPERDRIVE_ENDPOINT

  if (endpoint === 'direct') {
    const direct = getCfBindings()?.env?.HYPERDRIVE_DIRECT?.connectionString
    if (direct) return { source: 'hyperdrive-direct', connectionString: direct }
  }
  if (endpoint !== 'off') {
    const pooled = getCfBindings()?.env?.HYPERDRIVE?.connectionString
    if (pooled) return { source: 'hyperdrive-pooled', connectionString: pooled }
  }

  return { source: 'env-fallback', connectionString: process.env.DATABASE_URL ?? '' }
}

// One log line per source per process — request-scoped clients are created
// constantly, and the log is the only way to confirm post-deploy that the
// binding actually took effect instead of silently running on the fallback.
const loggedConnectionStringSources = new Set<ConnectionStringSource>()

function createPrismaClient(options?: PrismaClientOptions) {
  const { source, connectionString } = resolveConnectionString()

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  if (!loggedConnectionStringSources.has(source)) {
    loggedConnectionStringSources.add(source)
    console.log(`[db] connection string source: ${source}`)
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

// P0-A 探针（2026-09-10 前奏提速）：确认每次查询实际落在哪条 client 路径。
// 每个模块实例（= isolate）每条路径只打一次——request-scoped client 每个
// 请求都在创建，逐次打会淹掉 wrangler tail。
let loggedRequestScopedProbe = false
let loggedGlobalPoolProbe = false

function resolvePrismaClient(): { client: PrismaClient; entry: RequestScopedClientEntry | null } {
  const entry = getRequestScopedClientEntry()
  if (entry) {
    if (!loggedRequestScopedProbe) {
      loggedRequestScopedProbe = true
      console.log('[db/scope] request-scoped max=1')
    }
    return { client: entry.client, entry }
  }
  if (!loggedGlobalPoolProbe) {
    loggedGlobalPoolProbe = true
    console.log('[db/scope] global-pool max=5')
  }
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
