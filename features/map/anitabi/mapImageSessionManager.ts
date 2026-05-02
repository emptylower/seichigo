import { appendMapImageDiagnosticParams } from '@/lib/anitabi/imageProxy'

export type MapImageDiagSurface = 'map' | 'nearby'
export type MapImageDiagOwner = 'warmup' | 'viewport-loader' | 'dom-image'
export type MapImageDiagSlotType =
  | 'cover-avatar'
  | 'point-thumbnail'
  | 'point-preview'
  | 'dom-image'
export type MapImageDiagTerminalState = 'succeeded' | 'failed' | 'aborted' | 'superseded'
export type MapImageDiagDisplayOutcome = 'visible' | 'fallback'
export type MapImageDiagEscalationReason = 'failed' | 'fallback' | 'slow'

export type MapImageDiagRequestHandle = {
  sessionId: string
  chainId: string
  requestId: string
  requestUrl: string
  slotKey: string
  surface: MapImageDiagSurface
  slotType: MapImageDiagSlotType
  owner: MapImageDiagOwner
  attemptIndex: number
  candidateIndex: number
  candidateCount: number
}

export type MapImageDiagBufferedEvent = {
  session_id: string
  chain_id: string
  request_id: string
  occurred_at?: string
  slot_key?: string
  surface: MapImageDiagSurface
  slot_type?: MapImageDiagSlotType
  owner?: MapImageDiagOwner
  stage: string
  sampled: boolean
  escalation_reason: MapImageDiagEscalationReason | null
  attempt_index: number
  candidate_index: number
  candidate_count: number
  requested_candidate_url?: string
  final_url?: string
  duration_ms?: number
  terminal_state?: MapImageDiagTerminalState
  display_outcome?: MapImageDiagDisplayOutcome
  outcome?: string
  target_host_bucket?: string
  evidence: Record<string, unknown>
}

type ActiveRequestRecord = MapImageDiagRequestHandle & {
  chainKey: string
  stageStart: string
  stageTerminal: string
  startedAtMs: number
}

type ActiveChainRecord = {
  chainId: string
  attemptIndex: number
  activeRequestId: string | null
  closed: boolean
}

type FlushPayload = {
  session: {
    session_id: string
    sampled: boolean
    escalation_reason: MapImageDiagEscalationReason | null
    route_context: string | null
  }
  events: MapImageDiagBufferedEvent[]
}

type MapImageSessionManagerOptions = {
  getSessionSeed?: () => string | null
  getRouteContext?: () => string | null
  getForceCapture?: () => boolean
  now?: () => number
  random?: () => number
  endpoint?: string
  transport?: (payload: FlushPayload, reason: 'batch' | 'teardown') => Promise<void> | void
}

const CLEAN_SESSION_SAMPLE_RATE = 0.1
const EVENT_BATCH_MAX = 40
const MAX_DWELL_MS = 2000
const SLOW_REQUEST_MS = 1200
const DEFAULT_ENDPOINT = '/api/map-image-diagnostics'

let fallbackIdCounter = 0
const DIAG_FORCE_STORAGE_KEY = 'seichigo_map_image_diag_force'

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`
  }
  fallbackIdCounter += 1
  return `${prefix}:${Date.now()}:${fallbackIdCounter}`
}

function toChainKey(
  surface: MapImageDiagSurface,
  owner: MapImageDiagOwner,
  slotKey: string,
): string {
  return `${surface}:${owner}:${slotKey}`
}

function getStagePair(owner: MapImageDiagOwner): { start: string; terminal: string } {
  if (owner === 'warmup') {
    return { start: 'warmup_request_start', terminal: 'warmup_request_terminal' }
  }
  if (owner === 'viewport-loader') {
    return { start: 'viewport_loader_request_start', terminal: 'viewport_loader_request_terminal' }
  }
  return { start: 'dom_request_start', terminal: 'dom_request_terminal' }
}

function toTargetHostBucket(rawUrl: string | null | undefined): string | undefined {
  const value = String(rawUrl || '').trim()
  if (!value) return undefined
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    return new URL(value, baseOrigin).hostname.trim().toLowerCase() || undefined
  } catch {
    return undefined
  }
}

function buildEvidence(extra?: Record<string, unknown>): Record<string, unknown> {
  return extra ? { source: 'client', ...extra } : { source: 'client' }
}

export function readMapImageDiagForceOverride(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const localValue = window.localStorage.getItem(DIAG_FORCE_STORAGE_KEY)
    if (localValue === '1' || localValue === 'true') return true
  } catch {
    // ignore storage failures
  }
  const cookieMatch = document.cookie.match(/(?:^|;\s*)seichigo_map_image_diag_force=([^;]+)/)
  const cookieValue = cookieMatch?.[1]?.trim().toLowerCase()
  return cookieValue === '1' || cookieValue === 'true'
}

export function persistMapImageDiagForceOverride(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DIAG_FORCE_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore storage failures
  }
  document.cookie = `seichigo_map_image_diag_force=${enabled ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
}

export function resolveMapImageDiagSurface(tab: string | null | undefined): MapImageDiagSurface {
  return tab === 'nearby' ? 'nearby' : 'map'
}

export class MapImageSessionManager {
  private readonly getSessionSeed?: () => string | null
  private readonly getRouteContext?: () => string | null
  private readonly getForceCapture?: () => boolean
  private readonly now: () => number
  private readonly random: () => number
  private readonly endpoint: string
  private readonly transport?: (payload: FlushPayload, reason: 'batch' | 'teardown') => Promise<void> | void
  private readonly chains = new Map<string, ActiveChainRecord>()
  private readonly requests = new Map<string, ActiveRequestRecord>()
  private readonly beforeUnloadHandler = () => {
    this.closeActiveRequestsForTeardown()
    void this.flush('teardown')
  }
  private readonly pageHideHandler = (event: PageTransitionEvent) => {
    if (event.persisted) return
    this.closeActiveRequestsForTeardown()
    void this.flush('teardown')
  }

  private sessionId: string | null = null
  private sampled = false
  private escalationReason: MapImageDiagEscalationReason | null = null
  private bufferedEvents: MapImageDiagBufferedEvent[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushing = false
  private pendingTeardownFlush = false

  constructor(options: MapImageSessionManagerOptions = {}) {
    this.getSessionSeed = options.getSessionSeed
    this.getRouteContext = options.getRouteContext
    this.getForceCapture = options.getForceCapture
    this.now = options.now ?? (() => Date.now())
    this.random = options.random ?? (() => Math.random())
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT
    this.transport = options.transport

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.pageHideHandler)
      window.addEventListener('beforeunload', this.beforeUnloadHandler)
    }
  }

  startRequest(input: {
    surface: MapImageDiagSurface
    slotKey: string
    slotType: MapImageDiagSlotType
    owner: MapImageDiagOwner
    requestedCandidateUrl: string
    candidateIndex: number
    candidateCount: number
    reuseChain: boolean
    evidence?: Record<string, unknown>
  }): MapImageDiagRequestHandle {
    const sessionId = this.ensureSession()
    const chainKey = toChainKey(input.surface, input.owner, input.slotKey)
    const stage = getStagePair(input.owner)
    const existingChain = this.chains.get(chainKey)

    let chain: ActiveChainRecord
    if (!existingChain || existingChain.closed || !input.reuseChain) {
      if (existingChain?.activeRequestId) {
        this.finishRequestById(existingChain.activeRequestId, {
          terminalState: 'superseded',
          chainTerminal: true,
          finalUrl: undefined,
          evidence: buildEvidence({ reason: 'replaced_by_new_chain' }),
        })
      }
      chain = {
        chainId: createId('mi-chain'),
        attemptIndex: 0,
        activeRequestId: null,
        closed: false,
      }
      this.chains.set(chainKey, chain)
    } else {
      if (existingChain.activeRequestId) {
        this.finishRequestById(existingChain.activeRequestId, {
          terminalState: 'superseded',
          chainTerminal: true,
          finalUrl: undefined,
          evidence: buildEvidence({ reason: 'replaced_while_active' }),
        })
        chain = {
          chainId: createId('mi-chain'),
          attemptIndex: 0,
          activeRequestId: null,
          closed: false,
        }
      } else {
        chain = {
          ...existingChain,
          attemptIndex: existingChain.attemptIndex + 1,
          closed: false,
        }
      }
      this.chains.set(chainKey, chain)
    }

    const requestId = createId('mi-request')
    const requestUrl = this.shouldDecorateProxyRequests()
        ? appendMapImageDiagnosticParams(input.requestedCandidateUrl, {
          sessionId,
          chainId: chain.chainId,
          requestId,
          sampled: this.sampled,
          escalationReason: this.escalationReason,
          surface: input.surface,
          slotKey: input.slotKey,
          slotType: input.slotType,
          owner: input.owner,
        })
      : input.requestedCandidateUrl

    const handle: MapImageDiagRequestHandle = {
      sessionId,
      chainId: chain.chainId,
      requestId,
      requestUrl,
      slotKey: input.slotKey,
      surface: input.surface,
      slotType: input.slotType,
      owner: input.owner,
      attemptIndex: chain.attemptIndex,
      candidateIndex: input.candidateIndex,
      candidateCount: input.candidateCount,
    }
    chain.activeRequestId = requestId
    this.chains.set(chainKey, chain)
    this.requests.set(requestId, {
      ...handle,
      chainKey,
      stageStart: stage.start,
      stageTerminal: stage.terminal,
      startedAtMs: this.now(),
    })

    this.enqueueEvent({
      session_id: handle.sessionId,
      chain_id: handle.chainId,
      request_id: handle.requestId,
      occurred_at: new Date(this.now()).toISOString(),
      slot_key: handle.slotKey,
      surface: handle.surface,
      slot_type: handle.slotType,
      owner: handle.owner,
      stage: stage.start,
      sampled: this.sampled,
      escalation_reason: this.escalationReason,
      attempt_index: handle.attemptIndex,
      candidate_index: handle.candidateIndex,
      candidate_count: handle.candidateCount,
      requested_candidate_url: handle.requestUrl,
      target_host_bucket: toTargetHostBucket(handle.requestUrl),
      evidence: buildEvidence(input.evidence),
    })

    return handle
  }

  recordAnchor(surface: MapImageDiagSurface, anchor: 'map_shell_ready' | 'bootstrap_ready'): void {
    const sessionId = this.ensureSession()
    this.enqueueEvent({
      session_id: sessionId,
      chain_id: `anchor:${anchor}`,
      request_id: `anchor:${anchor}`,
      occurred_at: new Date(this.now()).toISOString(),
      surface,
      stage: 'first_view_anchor',
      sampled: this.sampled,
      escalation_reason: this.escalationReason,
      attempt_index: 0,
      candidate_index: 0,
      candidate_count: 0,
      evidence: buildEvidence({ anchor }),
    })
  }

  finishRequest(
    handle: MapImageDiagRequestHandle | null | undefined,
    input: {
      terminalState: MapImageDiagTerminalState
      chainTerminal: boolean
      displayOutcome?: MapImageDiagDisplayOutcome
      finalUrl?: string
      durationMs?: number
      outcome?: string
      evidence?: Record<string, unknown>
    },
  ): boolean {
    if (!handle) return false
    return this.finishRequestById(handle.requestId, input)
  }

  async flush(reason: 'batch' | 'teardown' = 'batch'): Promise<void> {
    if (!this.isFlushEligible() || this.bufferedEvents.length === 0) {
      return
    }
    if (this.flushing) {
      if (reason === 'teardown') {
        this.pendingTeardownFlush = true
      }
      return
    }

    this.clearFlushTimer()
    this.flushing = true
    try {
      while (this.bufferedEvents.length > 0 && this.isFlushEligible()) {
        const batch = this.bufferedEvents.slice(0, EVENT_BATCH_MAX)
        const payload: FlushPayload = {
          session: {
            session_id: this.sessionId!,
            sampled: this.sampled,
            escalation_reason: this.escalationReason,
            route_context: this.getRouteContext?.() ?? null,
          },
          events: batch,
        }

        try {
          await this.sendPayload(payload, reason)
          this.bufferedEvents.splice(0, batch.length)
          if (this.pendingTeardownFlush && reason !== 'teardown') {
            break
          }
        } catch {
          return
        }
      }
    } finally {
      this.flushing = false
      if (this.pendingTeardownFlush && this.bufferedEvents.length > 0 && this.isFlushEligible()) {
        this.pendingTeardownFlush = false
        void this.flush('teardown')
        return
      }
      this.pendingTeardownFlush = false
      if (this.bufferedEvents.length > 0 && this.isFlushEligible()) {
        this.scheduleFlush()
      }
    }
  }

  destroy(): void {
    this.closeActiveRequestsForTeardown()
    if (this.bufferedEvents.length > 0 && this.isFlushEligible()) {
      void this.flush('teardown')
    }
    this.clearFlushTimer()
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.pageHideHandler)
      window.removeEventListener('beforeunload', this.beforeUnloadHandler)
    }
  }

  readBufferedEvents(): MapImageDiagBufferedEvent[] {
    return [...this.bufferedEvents]
  }

  readSessionState(): {
    sessionId: string | null
    sampled: boolean
    escalationReason: MapImageDiagEscalationReason | null
  } {
    return {
      sessionId: this.sessionId,
      sampled: this.sampled,
      escalationReason: this.escalationReason,
    }
  }

  private ensureSession(): string {
    if (this.sessionId) return this.sessionId

    const seeded = String(this.getSessionSeed?.() || '').trim()
    this.sessionId = seeded || createId('mi-session')
    this.sampled = Boolean(this.getForceCapture?.()) || this.random() < CLEAN_SESSION_SAMPLE_RATE
    return this.sessionId
  }

  private finishRequestById(
    requestId: string,
    input: {
      terminalState: MapImageDiagTerminalState
      chainTerminal: boolean
      displayOutcome?: MapImageDiagDisplayOutcome
      finalUrl?: string
      durationMs?: number
      outcome?: string
      evidence?: Record<string, unknown>
    },
  ): boolean {
    const record = this.requests.get(requestId)
    if (!record) return false

    this.maybeEscalate(input.terminalState, input.displayOutcome, input.durationMs ?? (this.now() - record.startedAtMs))

    this.enqueueEvent({
      session_id: record.sessionId,
      chain_id: record.chainId,
      request_id: record.requestId,
      occurred_at: new Date(this.now()).toISOString(),
      slot_key: record.slotKey,
      surface: record.surface,
      slot_type: record.slotType,
      owner: record.owner,
      stage: record.stageTerminal,
      sampled: this.sampled,
      escalation_reason: this.escalationReason,
      attempt_index: record.attemptIndex,
      candidate_index: record.candidateIndex,
      candidate_count: record.candidateCount,
      requested_candidate_url: record.requestUrl,
      final_url: input.finalUrl || record.requestUrl,
      duration_ms: input.durationMs ?? Math.max(0, this.now() - record.startedAtMs),
      terminal_state: input.terminalState,
      display_outcome: input.displayOutcome,
      outcome: input.outcome,
      target_host_bucket: toTargetHostBucket(input.finalUrl || record.requestUrl),
      evidence: buildEvidence(input.evidence),
    })

    this.requests.delete(requestId)
    const chain = this.chains.get(record.chainKey)
    if (chain?.activeRequestId === requestId) {
      chain.activeRequestId = null
      chain.closed = input.chainTerminal
      this.chains.set(record.chainKey, chain)
    }
    return true
  }

  private maybeEscalate(
    terminalState: MapImageDiagTerminalState,
    displayOutcome: MapImageDiagDisplayOutcome | undefined,
    durationMs: number,
  ): void {
    if (this.escalationReason) return
    if (displayOutcome === 'fallback') {
      this.escalationReason = 'fallback'
      return
    }
    if (terminalState === 'failed') {
      this.escalationReason = 'failed'
      return
    }
    if (durationMs >= SLOW_REQUEST_MS) {
      this.escalationReason = 'slow'
    }
  }

  private enqueueEvent(event: MapImageDiagBufferedEvent): void {
    this.bufferedEvents.push(event)
    if (!this.isFlushEligible()) return

    const immediate =
      event.display_outcome === 'fallback'
      || event.terminal_state === 'failed'
      || (event.duration_ms ?? 0) >= SLOW_REQUEST_MS
      || this.bufferedEvents.length >= EVENT_BATCH_MAX

    if (immediate) {
      void this.flush('batch')
      return
    }
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushTimer != null || typeof globalThis.setTimeout !== 'function') return
    this.flushTimer = globalThis.setTimeout(() => {
      this.flushTimer = null
      void this.flush('batch')
    }, MAX_DWELL_MS)
  }

  private clearFlushTimer(): void {
    if (this.flushTimer == null || typeof globalThis.clearTimeout !== 'function') return
    globalThis.clearTimeout(this.flushTimer)
    this.flushTimer = null
  }

  private isFlushEligible(): boolean {
    return this.sessionId != null && (this.sampled || this.escalationReason != null)
  }

  private closeActiveRequestsForTeardown(): void {
    if (this.requests.size === 0) return
    for (const requestId of [...this.requests.keys()]) {
      this.finishRequestById(requestId, {
        terminalState: 'aborted',
        chainTerminal: true,
        finalUrl: undefined,
        evidence: buildEvidence({ reason: 'manager_destroyed' }),
      })
    }
  }

  private shouldDecorateProxyRequests(): boolean {
    return this.isFlushEligible()
  }

  private async sendPayload(payload: FlushPayload, reason: 'batch' | 'teardown'): Promise<void> {
    if (this.transport) {
      await this.transport(payload, reason)
      return
    }

    const body = JSON.stringify(payload)
    if (
      reason === 'teardown'
      && typeof navigator !== 'undefined'
      && typeof navigator.sendBeacon === 'function'
    ) {
      const blob = new Blob([body], { type: 'application/json' })
      const accepted = navigator.sendBeacon(this.endpoint, blob)
      if (accepted) {
        return
      }
    }

    if (typeof fetch !== 'function') return

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body,
      keepalive: reason === 'teardown',
    })
    if (!response.ok) {
      throw new Error(`map-image-diag-ingest failed (${response.status})`)
    }
  }
}
