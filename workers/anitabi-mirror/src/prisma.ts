import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client/wasm'

const MIRROR_POOL_MAX = 1
const CONNECTION_TIMEOUT_MS = 8_000
const QUERY_TIMEOUT_MS = 12_000
const STATEMENT_TIMEOUT_MS = 12_000
const IDLE_TIMEOUT_MS = 30_000

export function createMirrorPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    max: MIRROR_POOL_MAX,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  })

  return new PrismaClient({ adapter })
}
