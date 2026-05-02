export function createCompleteModeTrackedMetricCallbacks(
  mapImageDiagManagerRef: { current: { startRequest?: Function; finishRequest?: Function } | null },
  getSurface: () => 'map' | 'nearby',
  slotType: 'point-thumbnail' | 'cover-avatar',
) {
  return {
    onTrackedRequestStart: ({
      slotKey,
      requestedCandidateUrl,
      candidateIndex,
      candidateCount,
      reuseChain,
      queueWaitMs,
    }: {
      slotKey: string
      requestedCandidateUrl: string
      candidateIndex: number
      candidateCount: number
      reuseChain: boolean
      queueWaitMs?: number
    }) => mapImageDiagManagerRef.current?.startRequest?.({
      surface: getSurface(),
      slotKey,
      slotType,
      owner: 'viewport-loader',
      requestedCandidateUrl,
      candidateIndex,
      candidateCount,
      reuseChain,
      evidence: {
        mode: 'complete',
        queue_wait_ms: queueWaitMs ?? 0,
      },
    }) ?? null,
    onTrackedRequestTerminal: ({
      handle,
      terminalState,
      finalUrl,
      chainTerminal,
      outcome,
    }: {
      handle: { requestUrl: string; requestId: string } | null
      terminalState: 'succeeded' | 'failed' | 'aborted'
      finalUrl: string
      chainTerminal: boolean
      outcome?: string
    }) => {
      mapImageDiagManagerRef.current?.finishRequest?.(handle, {
        terminalState,
        chainTerminal,
        finalUrl,
        outcome,
        evidence: {
          mode: 'complete',
        },
      })
    },
  }
}
