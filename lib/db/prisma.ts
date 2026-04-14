import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client/wasm'

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  // Cloudflare Workers cannot run Prisma's Rust query engine. Use the JS engine with
  // the pg driver adapter so the same singleton works in both Node and Workers.
  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 8_000,
    query_timeout: 12_000,
    statement_timeout: 12_000,
    idleTimeoutMillis: 30_000,
  })

  return new PrismaClient({ adapter })
}

export const prisma = global.prisma || createPrismaClient()
if (process.env.NODE_ENV !== 'production') global.prisma = prisma
