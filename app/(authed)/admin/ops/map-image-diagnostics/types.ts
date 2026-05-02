export type MapImageDiagListItem = {
  id: string
  createdAt: string
  surface: string
  sampled: boolean
  escalationReason: string | null
  sessionOutcome: string
  firstDegradedStage: string | null
  eventCount: number
}

export type MapImageDiagSessionDetail = MapImageDiagListItem & {
  routeContext: unknown
  summary: unknown
  lastTerminalState: string | null
  proxyInvolved: boolean
}

export type MapImageDiagEvent = {
  id: string
  createdAt: string
  chainId: string
  requestId: string
  slotKey: string
  owner: string
  slotType: string
  stage: string
  attemptIndex: number
  candidateIndex: number
  candidateCount: number
  requestedCandidateUrl: string | null
  finalUrl: string | null
  terminalState: string | null
  displayOutcome: string | null
  durationMs: number | null
  outcome: string | null
  targetHostBucket: string | null
  evidence: unknown
}

export type MapImageDiagListResponse =
  | {
      ok: true
      items: MapImageDiagListItem[]
      nextCursor: string | null
      warning?: string
    }
  | {
      error: string
    }

export type MapImageDiagDetailResponse =
  | {
      ok: true
      session: MapImageDiagSessionDetail
      events: MapImageDiagEvent[]
    }
  | {
      error: string
    }

export type MapImageDiagOverviewResponse =
  | {
      ok: true
      range: {
        preset: '1h' | '6h' | '24h' | '7d' | 'custom'
        start: string
        end: string
      }
      warning?: string
      totals: {
        sessions: number
        degradedSessions: number
        failureSessions: number
        fallbackSessions: number
        proxySessions: number
        sampledSessions: number
        avgDurationMs: number | null
        p95DurationMs: number | null
      }
      durationBuckets: Array<{
        label: string
        count: number
      }>
      outcomes: Array<{
        label: string
        count: number
      }>
      stageStats: Array<{
        stage: string
        count: number
        degradedCount: number
        avgDurationMs: number | null
        p95DurationMs: number | null
      }>
      timeline: Array<{
        label: string
        total: number
        degraded: number
      }>
      recentSessions: MapImageDiagListItem[]
    }
  | {
      error: string
    }

export type MapImageDiagConfigResponse =
  | {
      ok: true
      config: {
        fullCaptureEnabled: boolean
        updatedAt: string | null
      }
      warning?: string
    }
  | {
      error: string
    }
