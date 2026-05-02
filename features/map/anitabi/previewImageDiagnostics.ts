type PreviewImageState = {
  diagnosticSurface?: 'map' | 'nearby'
  diagnosticSlotKey?: string | null
}

type PreviewStartInput = {
  slotKey: string
  surface: 'map' | 'nearby'
  requestedCandidateUrl: string
  candidateIndex: number
  candidateCount: number
  reuseChain: boolean
  queueWaitMs?: number
}

type PreviewTerminalInput = {
  handle: { requestUrl: string; requestId: string } | null
  terminalState: 'succeeded' | 'failed' | 'aborted' | 'superseded'
  displayOutcome?: 'visible' | 'fallback'
  finalUrl: string
  chainTerminal: boolean
  outcome?: string
}

export function startPreviewImageDiagnostic(
  manager: {
    startRequest?: (input: {
      surface: 'map' | 'nearby'
      slotKey: string
      slotType: 'point-preview'
      owner: 'dom-image'
      requestedCandidateUrl: string
      candidateIndex: number
      candidateCount: number
      reuseChain: boolean
      evidence: Record<string, unknown>
    }) => { requestUrl: string; requestId: string } | null
  } | null | undefined,
  imagePreview: PreviewImageState | null,
  input: PreviewStartInput,
) {
  const startRequest = manager?.startRequest
  if (!startRequest || !imagePreview?.diagnosticSlotKey || !imagePreview.diagnosticSurface) {
    return null
  }

  return startRequest({
    surface: input.surface,
    slotKey: input.slotKey,
    slotType: 'point-preview',
    owner: 'dom-image',
    requestedCandidateUrl: input.requestedCandidateUrl,
    candidateIndex: input.candidateIndex,
    candidateCount: input.candidateCount,
    reuseChain: input.reuseChain,
    evidence: {
      view: 'preview-modal',
      queue_wait_ms: input.queueWaitMs ?? 0,
    },
  })
}

export function finishPreviewImageDiagnostic(
  manager: {
    finishRequest?: (
      handle: { requestUrl: string; requestId: string } | null,
      input: {
        terminalState: 'succeeded' | 'failed' | 'aborted' | 'superseded'
        displayOutcome?: 'visible' | 'fallback'
        finalUrl: string
        chainTerminal: boolean
        outcome?: string
        evidence: Record<string, unknown>
      },
    ) => void
  } | null | undefined,
  input: PreviewTerminalInput,
) {
  manager?.finishRequest?.(input.handle, {
    terminalState: input.terminalState,
    displayOutcome: input.displayOutcome,
    finalUrl: input.finalUrl,
    chainTerminal: input.chainTerminal,
    outcome: input.outcome,
    evidence: {
      view: 'preview-modal',
    },
  })
}
