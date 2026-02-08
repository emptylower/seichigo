import type { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db/prisma'
import {
  classifyNormalizedLogs,
  normalizeLogRecord,
  sortClassifiedEvents,
  type ClassifiedLogEvent,
  type NormalizedLogRecord,
} from '@/lib/ops/logClassifier'
import { createOpsVercelClientFromEnv, type VercelClient, type VercelDeployment } from '@/lib/ops/vercelClient'

export type OpsTriggerMode = 'cron' | 'manual'
export type OpsReportStatus = 'ok' | 'partial' | 'failed'

export type RunOpsReportInput = {
  triggerMode: OpsTriggerMode
  windowStart: Date
  windowEnd: Date
}

export type RunOpsReportResult = {
  reportId: string
  source: 'vercel'
  dateKey: string
  triggerMode: OpsTriggerMode
  status: OpsReportStatus
  windowStart: string
  windowEnd: string
  totalDeployments: number
  totalLogs: number
  severeCount: number
  warningCount: number
  truncated: boolean
  createdAt: string
  markdownSummary: string
}

export class OpsUserInputError extends Error {
  readonly code = 'OPS_INPUT_ERROR'

  constructor(message: string) {
    super(message)
    this.name = 'OpsUserInputError'
  }
}

type OpsPrismaLike = {
  opsReport: {
    create: (args: Prisma.OpsReportCreateArgs) => Promise<{ id: string; createdAt: Date }>
    deleteMany: (args: Prisma.OpsReportDeleteManyArgs) => Promise<{ count: number }>
  }
  opsLogEvent: {
    createMany: (args: Prisma.OpsLogEventCreateManyArgs) => Promise<{ count: number }>
  }
}

type OpsRuntimeConfig = {
  maxDeploymentsPerRun: number
  maxLogLinesPerRun: number
  maxStoredEventsPerRun: number
  warn4xxThreshold: number
  retentionDays: number
}

export type OpsWorkflowDeps = {
  prisma: OpsPrismaLike
  createVercelClient: () => VercelClient
  now: () => Date
  env: NodeJS.ProcessEnv
}

function readIntEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minValue: number,
  maxValue: number
): number {
  const raw = Number(env[key] || '')
  if (!Number.isFinite(raw)) return fallback
  return Math.max(minValue, Math.min(maxValue, Math.floor(raw)))
}

function readRuntimeConfig(env: NodeJS.ProcessEnv): OpsRuntimeConfig {
  return {
    maxDeploymentsPerRun: readIntEnv(env, 'OPS_MAX_DEPLOYMENTS_PER_RUN', 8, 1, 100),
    maxLogLinesPerRun: readIntEnv(env, 'OPS_MAX_LOG_LINES_PER_RUN', 20_000, 10, 200_000),
    maxStoredEventsPerRun: readIntEnv(env, 'OPS_MAX_STORED_EVENTS_PER_RUN', 2_000, 1, 20_000),
    warn4xxThreshold: readIntEnv(env, 'OPS_WARN_4XX_THRESHOLD', 20, 1, 1_000),
    retentionDays: readIntEnv(env, 'OPS_RETENTION_DAYS', 90, 1, 3650),
  }
}

function defaultDeps(): OpsWorkflowDeps {
  return {
    prisma,
    createVercelClient: () => createOpsVercelClientFromEnv(process.env),
    now: () => new Date(),
    env: process.env,
  }
}

function toIso(value: Date): string {
  return value.toISOString()
}

function toUtcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function ensureValidWindow(input: RunOpsReportInput) {
  if (!(input.windowStart instanceof Date) || !Number.isFinite(input.windowStart.getTime())) {
    throw new OpsUserInputError('Invalid windowStart')
  }

  if (!(input.windowEnd instanceof Date) || !Number.isFinite(input.windowEnd.getTime())) {
    throw new OpsUserInputError('Invalid windowEnd')
  }

  if (input.windowStart.getTime() >= input.windowEnd.getTime()) {
    throw new OpsUserInputError('windowStart must be earlier than windowEnd')
  }
}

function buildFallbackFingerprint(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 16)
}

function toTimeMs(value: Date | null): number {
  if (!value) return 0
  const ms = value.getTime()
  return Number.isFinite(ms) ? ms : 0
}

function toStoredEvents(events: ClassifiedLogEvent[], maxCount: number): ClassifiedLogEvent[] {
  if (events.length <= maxCount) return events
  return sortClassifiedEvents(events).slice(0, maxCount)
}

type FingerprintSummaryItem = {
  fingerprint: string
  count: number
  sample: string
}

function summarizeFingerprints(events: ClassifiedLogEvent[], severity: 'severe' | 'warning'): FingerprintSummaryItem[] {
  const map = new Map<string, { count: number; sample: string }>()

  for (const event of events) {
    if (event.severity !== severity) continue
    const curr = map.get(event.fingerprint)
    if (!curr) {
      map.set(event.fingerprint, { count: 1, sample: event.message.slice(0, 160) })
    } else {
      curr.count += 1
      map.set(event.fingerprint, curr)
    }
  }

  return [...map.entries()]
    .map(([fingerprint, data]) => ({ fingerprint, count: data.count, sample: data.sample }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

function buildMarkdownSummary(args: {
  dateKey: string
  triggerMode: OpsTriggerMode
  status: OpsReportStatus
  windowStart: Date
  windowEnd: Date
  totalDeployments: number
  totalLogs: number
  severeCount: number
  warningCount: number
  truncated: boolean
  severeTop: FingerprintSummaryItem[]
  warningTop: FingerprintSummaryItem[]
  fetchErrors: string[]
  parseErrors: string[]
}): string {
  const lines: string[] = []
  lines.push('# SeichiGo Daily Ops Report')
  lines.push('')
  lines.push(`- Date Key (UTC): \`${args.dateKey}\``)
  lines.push(`- Trigger: \`${args.triggerMode}\``)
  lines.push(`- Status: \`${args.status}\``)
  lines.push(`- Window: \`${toIso(args.windowStart)}\` -> \`${toIso(args.windowEnd)}\``)
  lines.push(`- Deployments Scanned: \`${args.totalDeployments}\``)
  lines.push(`- Logs Scanned: \`${args.totalLogs}\``)
  lines.push(`- Severe: \`${args.severeCount}\``)
  lines.push(`- Warning: \`${args.warningCount}\``)
  lines.push(`- Truncated: \`${args.truncated ? 'yes' : 'no'}\``)
  lines.push('')

  lines.push('## Top Severe Fingerprints')
  if (!args.severeTop.length) {
    lines.push('- none')
  } else {
    for (const row of args.severeTop) {
      lines.push(`- \`${row.fingerprint}\` x${row.count} — ${row.sample}`)
    }
  }
  lines.push('')

  lines.push('## Top Warning Fingerprints')
  if (!args.warningTop.length) {
    lines.push('- none')
  } else {
    for (const row of args.warningTop) {
      lines.push(`- \`${row.fingerprint}\` x${row.count} — ${row.sample}`)
    }
  }

  if (args.fetchErrors.length || args.parseErrors.length) {
    lines.push('')
    lines.push('## Notes')
    for (const err of args.fetchErrors) {
      lines.push(`- fetch_error: ${err}`)
    }
    for (const err of args.parseErrors) {
      lines.push(`- parse_error: ${err}`)
    }
  }

  return lines.join('\n')
}

function inferStatus(args: {
  totalLogs: number
  totalDeployments: number
  fetchErrors: string[]
  parseErrors: string[]
}): OpsReportStatus {
  const hasErrors = args.fetchErrors.length > 0 || args.parseErrors.length > 0
  if (!hasErrors) return 'ok'

  const hasData = args.totalLogs > 0 || args.totalDeployments > 0
  return hasData ? 'partial' : 'failed'
}

async function fetchLogsForWindow(args: {
  client: VercelClient
  deployments: VercelDeployment[]
  windowStart: Date
  windowEnd: Date
  maxLogs: number
}): Promise<{
  totalLogs: number
  truncated: boolean
  rows: Array<{ deploymentId: string; raw: Record<string, unknown> }>
  fetchErrors: string[]
}> {
  const rows: Array<{ deploymentId: string; raw: Record<string, unknown> }> = []
  const fetchErrors: string[] = []
  let totalLogs = 0
  let truncated = false

  for (const deployment of args.deployments) {
    const remaining = args.maxLogs - totalLogs
    if (remaining <= 0) {
      truncated = true
      break
    }

    try {
      const events = await args.client.listDeploymentEvents(deployment.id, {
        limit: remaining,
        windowStart: args.windowStart,
        windowEnd: args.windowEnd,
      })

      totalLogs += events.length
      for (const event of events) {
        rows.push({ deploymentId: deployment.id, raw: event })
      }

      if (events.length >= remaining) {
        truncated = true
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fetchErrors.push(`deployment=${deployment.id}: ${msg}`)
    }
  }

  return { totalLogs, truncated, rows, fetchErrors }
}

function normalizeRows(
  rows: Array<{ deploymentId: string; raw: Record<string, unknown> }>
): { normalized: NormalizedLogRecord[]; parseErrors: string[]; parseWarnings: ClassifiedLogEvent[] } {
  const normalized: NormalizedLogRecord[] = []
  const parseErrors: string[] = []
  const parseWarnings: ClassifiedLogEvent[] = []

  for (const row of rows) {
    try {
      normalized.push(normalizeLogRecord(row.raw, row.deploymentId))
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      parseErrors.push(`deployment=${row.deploymentId}: ${msg}`)
      parseWarnings.push({
        deploymentId: row.deploymentId,
        timestamp: null,
        requestId: null,
        path: null,
        method: null,
        statusCode: null,
        message: `log_parse_failure: ${msg}`,
        raw: row.raw,
        severity: 'warning',
        reason: 'parse_error',
        fingerprint: buildFallbackFingerprint(`parse:${msg}`),
      })
    }
  }

  return { normalized, parseErrors, parseWarnings }
}

export function computePreviousUtcDayWindow(now: Date = new Date()): {
  windowStart: Date
  windowEnd: Date
  dateKey: string
} {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 1)
  return {
    windowStart: start,
    windowEnd: end,
    dateKey: toUtcDateKey(start),
  }
}

export async function runOpsReport(
  input: RunOpsReportInput,
  depsArg?: Partial<OpsWorkflowDeps>
): Promise<RunOpsReportResult> {
  ensureValidWindow(input)

  const base = defaultDeps()
  const deps: OpsWorkflowDeps = {
    prisma: depsArg?.prisma || base.prisma,
    createVercelClient: depsArg?.createVercelClient || base.createVercelClient,
    now: depsArg?.now || base.now,
    env: depsArg?.env || base.env,
  }

  const config = readRuntimeConfig(deps.env)
  const client = deps.createVercelClient()
  const source: 'vercel' = 'vercel'
  const dateKey = toUtcDateKey(input.windowStart)

  let deployments: VercelDeployment[] = []
  const fetchErrors: string[] = []

  try {
    deployments = await client.listDeployments({
      limit: config.maxDeploymentsPerRun,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
    })
  } catch (error) {
    fetchErrors.push(error instanceof Error ? error.message : String(error))
  }

  const logFetch = await fetchLogsForWindow({
    client,
    deployments,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    maxLogs: config.maxLogLinesPerRun,
  })

  fetchErrors.push(...logFetch.fetchErrors)

  const normalized = normalizeRows(logFetch.rows)
  const classified = classifyNormalizedLogs(normalized.normalized, {
    warn4xxThreshold: config.warn4xxThreshold,
  })

  const allEvents = sortClassifiedEvents([...classified, ...normalized.parseWarnings])

  const severeCount = allEvents.filter((item) => item.severity === 'severe').length
  const warningCount = allEvents.filter((item) => item.severity === 'warning').length

  let truncated = logFetch.truncated
  if (allEvents.length > config.maxStoredEventsPerRun) {
    truncated = true
  }

  const storedEvents = toStoredEvents(allEvents, config.maxStoredEventsPerRun)
  const severeTop = summarizeFingerprints(allEvents, 'severe')
  const warningTop = summarizeFingerprints(allEvents, 'warning')
  const status = inferStatus({
    totalLogs: logFetch.totalLogs,
    totalDeployments: deployments.length,
    fetchErrors,
    parseErrors: normalized.parseErrors,
  })

  const markdownSummary = buildMarkdownSummary({
    dateKey,
    triggerMode: input.triggerMode,
    status,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    totalDeployments: deployments.length,
    totalLogs: logFetch.totalLogs,
    severeCount,
    warningCount,
    truncated,
    severeTop,
    warningTop,
    fetchErrors,
    parseErrors: normalized.parseErrors,
  })

  const rawSummary = {
    source,
    triggerMode: input.triggerMode,
    status,
    dateKey,
    windowStart: toIso(input.windowStart),
    windowEnd: toIso(input.windowEnd),
    config,
    totals: {
      totalDeployments: deployments.length,
      totalLogs: logFetch.totalLogs,
      severeCount,
      warningCount,
      truncated,
      storedEvents: storedEvents.length,
    },
    deploymentIds: deployments.map((item) => item.id),
    fetchErrors,
    parseErrors: normalized.parseErrors,
    topFingerprints: {
      severe: severeTop,
      warning: warningTop,
    },
  } satisfies Record<string, unknown>

  const report = await deps.prisma.opsReport.create({
    data: {
      source,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      dateKey,
      triggerMode: input.triggerMode,
      status,
      totalDeployments: deployments.length,
      totalLogs: logFetch.totalLogs,
      severeCount,
      warningCount,
      truncated,
      markdownSummary,
      rawSummary: rawSummary as Prisma.InputJsonValue,
    },
  })

  if (storedEvents.length > 0) {
    await deps.prisma.opsLogEvent.createMany({
      data: storedEvents.map((event) => ({
        reportId: report.id,
        severity: event.severity,
        fingerprint: event.fingerprint,
        timestamp: event.timestamp,
        deploymentId: event.deploymentId || null,
        requestId: event.requestId,
        path: event.path,
        method: event.method,
        statusCode: event.statusCode,
        message: event.message,
        raw: event.raw as Prisma.InputJsonValue,
      })),
    })
  }

  if (config.retentionDays > 0) {
    const cutoff = new Date(deps.now())
    cutoff.setUTCDate(cutoff.getUTCDate() - config.retentionDays)
    await deps.prisma.opsReport.deleteMany({ where: { createdAt: { lt: cutoff } } })
  }

  return {
    reportId: report.id,
    source,
    dateKey,
    triggerMode: input.triggerMode,
    status,
    windowStart: toIso(input.windowStart),
    windowEnd: toIso(input.windowEnd),
    totalDeployments: deployments.length,
    totalLogs: logFetch.totalLogs,
    severeCount,
    warningCount,
    truncated,
    createdAt: toIso(report.createdAt),
    markdownSummary,
  }
}
