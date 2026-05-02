import { z } from 'zod'

export const escalationReasonSchema = z.enum(['failed', 'fallback', 'slow']).nullable().optional()
export const terminalStateSchema = z.enum(['succeeded', 'failed', 'aborted', 'superseded']).optional()
export const displayOutcomeSchema = z.enum(['visible', 'fallback']).optional()

export const ingestEventSchema = z.object({
  session_id: z.string().min(1),
  chain_id: z.string().min(1),
  request_id: z.string().min(1),
  occurred_at: z.string().datetime().optional(),
  slot_key: z.string().min(1).optional(),
  surface: z.enum(['map', 'nearby']).optional(),
  slot_type: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  stage: z.string().min(1),
  sampled: z.boolean(),
  escalation_reason: escalationReasonSchema,
  attempt_index: z.number().int().min(0),
  candidate_index: z.number().int().min(0),
  candidate_count: z.number().int().min(0),
  requested_candidate_url: z.string().min(1).optional(),
  final_url: z.string().min(1).optional(),
  duration_ms: z.number().int().min(0).optional(),
  terminal_state: terminalStateSchema,
  display_outcome: displayOutcomeSchema,
  outcome: z.string().min(1).optional(),
  target_host_bucket: z.string().min(1).optional(),
  evidence: z.record(z.string(), z.unknown()),
})

export const ingestBatchSchema = z.object({
  session: z.object({
    session_id: z.string().min(1),
    sampled: z.boolean(),
    escalation_reason: escalationReasonSchema,
    route_context: z.string().nullable().optional(),
  }),
  events: z.array(ingestEventSchema).min(1).max(40),
})

export type IngestBatchInput = z.infer<typeof ingestBatchSchema>
export type IngestEventInput = z.infer<typeof ingestEventSchema>

export function isDegradedEvent(event: {
  terminalState?: string | null
  displayOutcome?: string | null
  durationMs?: number | null
}): boolean {
  return event.terminalState === 'failed'
    || event.displayOutcome === 'fallback'
    || (event.durationMs ?? 0) >= 1200
}

function isOutcomeV2Enabled(): boolean {
  return process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED === '1'
}

export function deriveSessionOutcome(events: Array<{
  terminalState?: string | null
  displayOutcome?: string | null
  candidateCount?: number | null
  outcome?: string | null
}>): string {
  const failedEvents = events.filter((event) => event.terminalState === 'failed')
  if (!isOutcomeV2Enabled()) {
    if (failedEvents.length > 0) return 'failed'
  } else if (failedEvents.length > 0) {
    const hasOnlySingleCandidateTimeoutFailures = failedEvents.every((event) => (
      event.candidateCount === 1 && event.outcome === 'timeout'
    ))
    if (!hasOnlySingleCandidateTimeoutFailures) return 'failed'
  }

  if (events.some((event) => event.displayOutcome === 'fallback')) return 'fallback'

  const terminal = [...events].reverse().find((event) => Boolean(event.terminalState))
  if (!terminal?.terminalState) return 'pending'
  if (
    isOutcomeV2Enabled()
    && terminal.terminalState === 'failed'
    && failedEvents.length > 0
    && failedEvents.every((event) => event.candidateCount === 1 && event.outcome === 'timeout')
  ) {
    return 'no_data'
  }
  return terminal.terminalState
}

export function buildEventKey(input: {
  sessionId: string
  chainId: string
  requestId: string
  stage: string
  attemptIndex: number
  candidateIndex: number
  terminalState?: string
  displayOutcome?: string
  outcome?: string
}): string {
  return [
    input.sessionId,
    input.chainId,
    input.requestId,
    input.stage,
    String(input.attemptIndex),
    String(input.candidateIndex),
    input.terminalState || '',
    input.displayOutcome || '',
    input.outcome || '',
  ].join('::')
}
