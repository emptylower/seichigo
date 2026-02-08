import type { Session } from 'next-auth'
import { prisma } from '@/lib/db/prisma'
import { runOpsReport, type RunOpsReportInput, type RunOpsReportResult } from '@/lib/ops/reportWorkflow'

export type OpsApiDeps = {
  prisma: typeof prisma
  getSession: () => Promise<Session | null>
  runReport: (input: RunOpsReportInput) => Promise<RunOpsReportResult>
  now: () => Date
  getCronSecret: () => string
}

let cached: OpsApiDeps | null = null

export async function getOpsApiDeps(): Promise<OpsApiDeps> {
  if (cached) return cached

  const { getServerAuthSession } = await import('@/lib/auth/session')

  cached = {
    prisma,
    getSession: getServerAuthSession,
    runReport: (input) => runOpsReport(input),
    now: () => new Date(),
    getCronSecret: () => String(process.env.OPS_CRON_SECRET || process.env.CRON_SECRET || '').trim(),
  }

  return cached
}
