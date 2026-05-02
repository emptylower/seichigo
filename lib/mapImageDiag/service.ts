import type { MapImageDiagApiDeps } from './api'
import { buildEventKey, deriveSessionOutcome, ingestBatchSchema, isDegradedEvent, type IngestBatchInput } from './shared'

function isAdminSession(session: unknown): boolean {
  const user = (session as any)?.user
  return Boolean(user?.isAdmin)
}

function toPrismaJson(value: unknown): any {
  if (value === undefined || value === null) return undefined
  return value as any
}

function toEventRecord(
  input: IngestBatchInput,
  now: Date,
) {
  return input.events.map((event, index) => ({
    eventKey: buildEventKey({
      sessionId: input.session.session_id,
      chainId: event.chain_id,
      requestId: event.request_id,
      stage: event.stage,
      attemptIndex: event.attempt_index,
      candidateIndex: event.candidate_index,
      terminalState: event.terminal_state,
      displayOutcome: event.display_outcome,
      outcome: event.outcome,
    }),
    sessionRefId: '',
    chainId: event.chain_id,
    requestId: event.request_id,
    slotKey: event.slot_key ?? null,
    surface: event.surface ?? null,
    slotType: event.slot_type ?? null,
    owner: event.owner ?? null,
    stage: event.stage,
    outcome: event.outcome ?? null,
    terminalState: event.terminal_state ?? null,
    displayOutcome: event.display_outcome ?? null,
    durationMs: event.duration_ms ?? null,
    severity: isDegradedEvent({
      terminalState: event.terminal_state ?? null,
      displayOutcome: event.display_outcome ?? null,
      durationMs: event.duration_ms ?? null,
    }) ? 'degraded' : 'info',
    attemptIndex: event.attempt_index,
    candidateIndex: event.candidate_index,
    candidateCount: event.candidate_count,
    requestedCandidateUrl: event.requested_candidate_url ?? null,
    finalUrl: event.final_url ?? null,
    proxyJoinValue: `${event.chain_id}:${event.request_id}`,
    targetHostBucket: event.target_host_bucket ?? null,
    evidence: toPrismaJson(event.evidence),
    createdAt: event.occurred_at ? new Date(event.occurred_at) : new Date(now.getTime() + index),
  }))
}

async function refreshSessionSummary(
  deps: MapImageDiagApiDeps,
  sessionId: string,
  routeContext: string | null | undefined,
  sampled: boolean,
  escalationReason: string | null | undefined,
) {
  const events = await deps.prisma.mapImageDiagEvent.findMany({
    where: { sessionRefId: sessionId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      stage: true,
      terminalState: true,
      displayOutcome: true,
      durationMs: true,
      evidence: true,
      createdAt: true,
    },
  })

  const firstDegraded = events.find((event) => isDegradedEvent(event))
  const lastTerminal = [...events].reverse().find((event) => Boolean(event.terminalState))
  const proxyInvolved = events.some((event) => event.stage.startsWith('proxy_'))
  const firstViewSummary = events
    .filter((event) => event.stage === 'first_view_anchor')
    .reduce<Record<string, string>>((acc, event) => {
      const anchor = String((event.evidence as any)?.anchor || '').trim()
      if (!anchor || acc[anchor]) return acc
      acc[anchor] = event.createdAt.toISOString()
      return acc
    }, {})

  await deps.prisma.mapImageDiagSession.update({
    where: { id: sessionId },
    data: {
      sampled,
      escalationReason: escalationReason ?? null,
      routeContext: routeContext != null ? toPrismaJson(routeContext) : undefined,
      sessionOutcome: deriveSessionOutcome(events),
      firstViewSummary: toPrismaJson(firstViewSummary),
      firstDegradedStage: firstDegraded?.stage ?? null,
      firstDegradedAt: firstDegraded?.createdAt ?? null,
      lastTerminalState: lastTerminal?.terminalState ?? null,
      proxyInvolved,
      eventCount: events.length,
    },
  })
}

export async function ingestMapImageDiagBatch(
  deps: MapImageDiagApiDeps,
  rawInput: unknown,
  options?: {
    refreshSessionSummary?: boolean
  },
): Promise<{ sessionId: string; inserted: number }> {
  const input = ingestBatchSchema.parse(rawInput)
  const now = deps.now()

  const session = await deps.prisma.mapImageDiagSession.upsert({
    where: { sessionKey: input.session.session_id },
    create: {
      sessionKey: input.session.session_id,
      surface: input.events[0]?.surface || 'map',
      sampled: input.session.sampled,
      escalationReason: input.session.escalation_reason ?? null,
      routeContext: toPrismaJson(input.session.route_context),
    },
    update: {
      surface: input.events.find((event) => Boolean(event.surface))?.surface ?? undefined,
      sampled: input.session.sampled ? true : undefined,
      escalationReason: input.session.escalation_reason ?? undefined,
      routeContext: input.session.route_context != null ? toPrismaJson(input.session.route_context) : undefined,
    },
    select: {
      id: true,
      sampled: true,
      escalationReason: true,
    },
  })

  const events = toEventRecord(input, now).map((event) => ({
    ...event,
    sessionRefId: session.id,
  }))

  const inserted = await deps.prisma.mapImageDiagEvent.createMany({
    data: events,
    skipDuplicates: true,
  })

  if (options?.refreshSessionSummary ?? true) {
    await refreshSessionSummary(
      deps,
      session.id,
      input.session.route_context ?? null,
      session.sampled,
      session.escalationReason ?? null,
    )
  }

  return {
    sessionId: session.id,
    inserted: inserted.count,
  }
}

export async function getMapImageDiagControl(
  deps: MapImageDiagApiDeps,
): Promise<{ fullCaptureEnabled: boolean; updatedAt: string | null }> {
  const row = await deps.prisma.mapImageDiagControl.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
    select: {
      fullCaptureEnabled: true,
      updatedAt: true,
    },
  })

  return {
    fullCaptureEnabled: row.fullCaptureEnabled,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function setMapImageDiagControl(
  deps: MapImageDiagApiDeps,
  input: { fullCaptureEnabled: boolean },
): Promise<{ fullCaptureEnabled: boolean; updatedAt: string }> {
  const row = await deps.prisma.mapImageDiagControl.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      fullCaptureEnabled: input.fullCaptureEnabled,
    },
    update: {
      fullCaptureEnabled: input.fullCaptureEnabled,
    },
    select: {
      fullCaptureEnabled: true,
      updatedAt: true,
    },
  })

  return {
    fullCaptureEnabled: row.fullCaptureEnabled,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listMapImageDiagSessions(
  deps: MapImageDiagApiDeps,
  input: { limit: number; cursor: Date | null; start: Date | null; end: Date | null },
) {
  const rows = await deps.prisma.mapImageDiagSession.findMany({
    where: {
      ...(input.cursor ? { createdAt: { lt: input.cursor } } : {}),
      ...(input.start || input.end
        ? {
            createdAt: {
              ...(input.start ? { gte: input.start } : {}),
              ...(input.end ? { lte: input.end } : {}),
              ...(input.cursor ? { lt: input.cursor } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    select: {
      id: true,
      createdAt: true,
      surface: true,
      sampled: true,
      escalationReason: true,
      sessionOutcome: true,
      firstDegradedStage: true,
      eventCount: true,
    },
  })

  const visibleRows = rows.filter((row) => {
    return row.sampled || row.escalationReason != null || (row.sessionOutcome && row.sessionOutcome !== 'pending')
  })
  const hasMore = visibleRows.length > input.limit
  const items = hasMore ? visibleRows.slice(0, input.limit) : visibleRows
  return {
    items: items.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      surface: row.surface,
      sampled: row.sampled,
      escalationReason: row.escalationReason,
      sessionOutcome: row.sessionOutcome || 'pending',
      firstDegradedStage: row.firstDegradedStage,
      eventCount: row.eventCount,
    })),
    nextCursor: hasMore ? items[items.length - 1]?.createdAt.toISOString() ?? null : null,
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)))
  return sorted[index] ?? null
}

function formatBucketLabel(date: Date, bucketMinutes: number): string {
  if (bucketMinutes >= 1440) {
    return date.toISOString().slice(0, 10)
  }
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export async function summarizeMapImageDiagRange(
  deps: MapImageDiagApiDeps,
  input: { start: Date; end: Date },
) {
  const sessions = await deps.prisma.mapImageDiagSession.findMany({
    where: {
      createdAt: {
        gte: input.start,
        lte: input.end,
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      createdAt: true,
      surface: true,
      sampled: true,
      escalationReason: true,
      sessionOutcome: true,
      firstDegradedStage: true,
      eventCount: true,
      proxyInvolved: true,
    },
  })

  const events = await deps.prisma.mapImageDiagEvent.findMany({
    where: {
      createdAt: {
        gte: input.start,
        lte: input.end,
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      createdAt: true,
      stage: true,
      terminalState: true,
      displayOutcome: true,
      durationMs: true,
    },
  })

  const durationValues = events
    .map((event) => event.durationMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  const durationBuckets = [
    { label: '<300ms', count: 0 },
    { label: '300-800ms', count: 0 },
    { label: '800-1200ms', count: 0 },
    { label: '>=1200ms', count: 0 },
  ]
  for (const value of durationValues) {
    if (value < 300) durationBuckets[0]!.count += 1
    else if (value < 800) durationBuckets[1]!.count += 1
    else if (value < 1200) durationBuckets[2]!.count += 1
    else durationBuckets[3]!.count += 1
  }

  const stageMap = new Map<string, { stage: string; count: number; degradedCount: number; durations: number[] }>()
  for (const event of events) {
    const current = stageMap.get(event.stage) || {
      stage: event.stage,
      count: 0,
      degradedCount: 0,
      durations: [],
    }
    current.count += 1
    if (event.terminalState === 'failed' || event.displayOutcome === 'fallback' || (event.durationMs ?? 0) >= 1200) {
      current.degradedCount += 1
    }
    if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)) {
      current.durations.push(event.durationMs)
    }
    stageMap.set(event.stage, current)
  }

  const stageStats = [...stageMap.values()]
    .map((item) => ({
      stage: item.stage,
      count: item.count,
      degradedCount: item.degradedCount,
      avgDurationMs: average(item.durations),
      p95DurationMs: percentile(item.durations, 0.95),
    }))
    .sort((a, b) => b.degradedCount - a.degradedCount || b.count - a.count)
    .slice(0, 8)

  const outcomeMap = new Map<string, number>()
  for (const session of sessions) {
    const key = session.sessionOutcome || 'pending'
    outcomeMap.set(key, (outcomeMap.get(key) || 0) + 1)
  }
  const outcomes = [...outcomeMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)

  const rangeMs = Math.max(1, input.end.getTime() - input.start.getTime())
  const bucketMinutes = rangeMs <= 6 * 60 * 60 * 1000
    ? 30
    : rangeMs <= 24 * 60 * 60 * 1000
      ? 60
      : rangeMs <= 3 * 24 * 60 * 60 * 1000
        ? 360
        : 1440
  const bucketMs = bucketMinutes * 60 * 1000
  const bucketCount = Math.max(1, Math.min(24, Math.ceil(rangeMs / bucketMs)))
  const timeline = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = new Date(input.start.getTime() + index * bucketMs)
    return {
      label: formatBucketLabel(bucketStart, bucketMinutes),
      total: 0,
      degraded: 0,
    }
  })

  for (const session of sessions) {
    const offset = session.createdAt.getTime() - input.start.getTime()
    const index = Math.max(0, Math.min(bucketCount - 1, Math.floor(offset / bucketMs)))
    const bucket = timeline[index]
    if (!bucket) continue
    bucket.total += 1
    if (session.firstDegradedStage || (session.sessionOutcome && session.sessionOutcome !== 'succeeded' && session.sessionOutcome !== 'pending')) {
      bucket.degraded += 1
    }
  }

  return {
    totals: {
      sessions: sessions.length,
      degradedSessions: sessions.filter((session) => session.firstDegradedStage || (session.sessionOutcome && session.sessionOutcome !== 'succeeded' && session.sessionOutcome !== 'pending')).length,
      failureSessions: sessions.filter((session) => session.sessionOutcome === 'failed').length,
      fallbackSessions: sessions.filter((session) => session.sessionOutcome === 'fallback').length,
      proxySessions: sessions.filter((session) => session.proxyInvolved).length,
      sampledSessions: sessions.filter((session) => session.sampled).length,
      avgDurationMs: average(durationValues),
      p95DurationMs: percentile(durationValues, 0.95),
    },
    durationBuckets,
    outcomes,
    stageStats,
    timeline,
    recentSessions: sessions.slice(0, 10).map((session) => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      surface: session.surface,
      sampled: session.sampled,
      escalationReason: session.escalationReason,
      sessionOutcome: session.sessionOutcome || 'pending',
      firstDegradedStage: session.firstDegradedStage,
      eventCount: session.eventCount,
    })),
  }
}

export async function getMapImageDiagSessionDetail(
  deps: MapImageDiagApiDeps,
  sessionId: string,
) {
  const session = await deps.prisma.mapImageDiagSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      createdAt: true,
      surface: true,
      sampled: true,
      escalationReason: true,
      sessionOutcome: true,
      firstDegradedStage: true,
      eventCount: true,
      routeContext: true,
      firstViewSummary: true,
      lastTerminalState: true,
      proxyInvolved: true,
    },
  })

  if (!session) return null

  const events = await deps.prisma.mapImageDiagEvent.findMany({
    where: { sessionRefId: sessionId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      createdAt: true,
      chainId: true,
      requestId: true,
      slotKey: true,
      owner: true,
      slotType: true,
      stage: true,
      attemptIndex: true,
      candidateIndex: true,
      candidateCount: true,
      requestedCandidateUrl: true,
      finalUrl: true,
      terminalState: true,
      displayOutcome: true,
      durationMs: true,
      outcome: true,
      targetHostBucket: true,
      evidence: true,
    },
  })

  return {
    session: {
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      surface: session.surface,
      sampled: session.sampled,
      escalationReason: session.escalationReason,
      sessionOutcome: session.sessionOutcome || 'pending',
      firstDegradedStage: session.firstDegradedStage,
      eventCount: session.eventCount,
      routeContext: session.routeContext,
      summary: session.firstViewSummary,
      lastTerminalState: session.lastTerminalState,
      proxyInvolved: session.proxyInvolved,
    },
    events: events.map((event) => ({
      id: event.id,
      createdAt: event.createdAt.toISOString(),
      chainId: event.chainId,
      requestId: event.requestId,
      slotKey: event.slotKey || '',
      owner: event.owner || '',
      slotType: event.slotType || '',
      stage: event.stage,
      attemptIndex: event.attemptIndex ?? 0,
      candidateIndex: event.candidateIndex ?? 0,
      candidateCount: event.candidateCount ?? 0,
      requestedCandidateUrl: event.requestedCandidateUrl,
      finalUrl: event.finalUrl,
      terminalState: event.terminalState,
      displayOutcome: event.displayOutcome,
      durationMs: event.durationMs,
      outcome: event.outcome,
      targetHostBucket: event.targetHostBucket,
      evidence: event.evidence,
    })),
  }
}

export async function deleteMapImageDiagSession(
  deps: MapImageDiagApiDeps,
  sessionId: string,
): Promise<boolean> {
  try {
    await deps.prisma.mapImageDiagSession.delete({
      where: { id: sessionId },
    })
    return true
  } catch (error) {
    const code = (error as any)?.code
    if (code === 'P2025') {
      return false
    }
    throw error
  }
}

export async function purgeMapImageDiagSessions(
  deps: MapImageDiagApiDeps,
  input: { start: Date | null; end: Date | null },
): Promise<{ count: number }> {
  const where =
    input.start || input.end
      ? {
          createdAt: {
            ...(input.start ? { gte: input.start } : {}),
            ...(input.end ? { lte: input.end } : {}),
          },
        }
      : {}

  const result = await deps.prisma.mapImageDiagSession.deleteMany({
    where,
  })

  return { count: result.count }
}

export async function ensureAdminMapImageDiagSession(
  deps: MapImageDiagApiDeps,
): Promise<void> {
  const session = await deps.getSession()
  if (!isAdminSession(session)) {
    throw new Error('Unauthorized')
  }
}
