/**
 * Local sync harness. Runs the real runAnitabiSync() against:
 *   - a throwaway local Postgres (seichigo_synclab)
 *   - the official-API-only mock upstream
 * so the pipeline can be exercised without touching production or the real upstream.
 *
 * Usage:
 *   DATABASE_URL=postgresql://localhost:5432/seichigo_synclab \
 *   ANITABI_API_BASE_URL=http://127.0.0.1:4555 \
 *   ANITABI_SITE_BASE_URL=http://127.0.0.1:4555 \
 *   npx tsx scripts/anitabi-sync-lab.mts [mode]
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@seichigo/prisma-client-runtime'
import { runAnitabiSync } from '../lib/anitabi/sync/workflow'
import type { AnitabiApiDeps } from '../lib/anitabi/api'
import type { AnitabiSyncMode } from '../lib/anitabi/types'

const mode = (process.argv[2] || 'delta') as AnitabiSyncMode
const dbUrl = process.env.DATABASE_URL || ''

if (!/localhost|127\.0\.0\.1/.test(dbUrl)) {
  console.error(`REFUSING TO RUN: DATABASE_URL is not local.\n  got: ${dbUrl.replace(/:[^:@]*@/, ':***@')}`)
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl, max: 5 }) })

const deps = {
  prisma,
  getSession: async () => null,
  now: () => new Date(),
  getCronSecret: () => '',
  getApiBase: () => String(process.env.ANITABI_API_BASE_URL).replace(/\/+$/, ''),
  getSiteBase: () => String(process.env.ANITABI_SITE_BASE_URL).replace(/\/+$/, ''),
} as unknown as AnitabiApiDeps

console.log(`\n=== running runAnitabiSync(mode=${mode}) ===`)
console.log(`  db       ${dbUrl}`)
console.log(`  apiBase  ${deps.getApiBase()}`)
console.log(`  siteBase ${deps.getSiteBase()}\n`)

const t0 = Date.now()
const maxRows = Number.parseInt(String(process.env.ANITABI_SYNC_MAX_ROWS_PER_RUN || ''), 10)
try {
  const report = await runAnitabiSync(deps, {
    mode,
    maxRowsPerRun: Number.isFinite(maxRows) ? maxRows : 3,
  })
  console.log(`\n=== report (${Date.now() - t0}ms) ===`)
  console.log(JSON.stringify(report, null, 2))
} catch (e: any) {
  console.log(`\n=== THREW after ${Date.now() - t0}ms ===`)
  console.log(`  ${e?.constructor?.name}: ${e?.message}`)
} finally {
  await prisma.$disconnect()
}
