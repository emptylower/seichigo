export type ReportListItem = {
  id: string
  source: string
  dateKey: string
  triggerMode: string
  status: string
  totalDeployments: number
  totalLogs: number
  severeCount: number
  warningCount: number
  truncated: boolean
  windowStart: string
  windowEnd: string
  createdAt: string
}

export type ReportDetail = ReportListItem & {
  markdownSummary: string
  rawSummary: unknown
}

export type OpsLogEvent = {
  id: string
  severity: 'severe' | 'warning' | string
  fingerprint: string
  timestamp: string | null
  deploymentId: string | null
  requestId: string | null
  path: string | null
  method: string | null
  statusCode: number | null
  message: string
  raw: unknown
  createdAt: string
}

export type ReportsResponse =
  | {
      ok: true
      items: ReportListItem[]
      nextCursor: string | null
    }
  | {
      error: string
    }

export type RunResponse =
  | {
      ok: true
      report: {
        reportId: string
      }
    }
  | {
      error: string
    }

export type DetailResponse =
  | {
      ok: true
      report: ReportDetail
      events: OpsLogEvent[]
    }
  | {
      error: string
    }

export type AnitabiProgress = {
  activeDatasetVersion: string
  sourceBangumiTotal: number
  importedBangumi: number
  importedMapEnabled: number
  pendingBangumi: number | null
  importedPoints: number
  expectedPointsInImportedBangumi: number
  pointTotal: number | null
  pointTotalMode: 'exact' | 'estimated' | 'unknown'
  pendingPoints: number | null
  worksCompletionRate: number | null
  pointsCompletionRate: number | null
  importedPointCoverageRate: number | null
  latestRun: {
    id: string
    mode: string
    status: string
    changedCount: number
    startedAt: string
    endedAt: string | null
    errorSummary: string | null
  } | null
  updatedAt: string
}

export type AnitabiProgressResponse =
  | {
      ok: true
      progress: AnitabiProgress
    }
  | {
      error: string
    }

export type AnitabiSyncResponse =
  | {
      runId: string
      mode: 'full' | 'delta' | 'dryRun'
      status: 'ok' | 'failed'
      datasetVersion: string | null
      scanned: number
      changed: number
      message?: string
    }
  | {
      error: string
    }

export type AnitabiDiffItem = {
  id: number
  title: string
  sourceModifiedMs: string | null
  localModifiedMs: string | null
  expectedPoints: number | null
  importedPoints: number | null
  missingPoints: number | null
}

export type AnitabiDiff = {
  activeDatasetVersion: string
  sourceTotal: number
  localTotal: number
  needsSync: boolean
  recommendedMode: 'delta' | 'full'
  works: {
    sourceOnlyCount: number
    localOnlyCount: number
    modifiedCount: number
    pointGapCount: number
    syncCandidateCount: number
  }
  points: {
    expectedInLocalWorks: number
    importedInLocalWorks: number
    missingInLocalWorks: number
  }
  status: {
    mapEnabledWorks: number
    mapDisabledWorks: number
    mappedWorks: number
    unmappedWorks: number
    hiddenAnimeLinkedWorks: number
  }
  examples: {
    sourceOnly: AnitabiDiffItem[]
    localOnly: AnitabiDiffItem[]
    modified: AnitabiDiffItem[]
    pointGap: AnitabiDiffItem[]
  }
  checkedAt: string
}

export type AnitabiDiffResponse =
  | {
      ok: true
      diff: AnitabiDiff
    }
  | {
      error: string
    }

export type AdminOpsInitialData = {
  items: ReportListItem[]
  nextCursor: string | null
  selectedId: string | null
  detailReport: ReportDetail | null
  detailEvents: OpsLogEvent[]
}
