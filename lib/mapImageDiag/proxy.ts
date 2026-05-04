import type { PrismaClient } from '@prisma/client'
import { readMapImageDiagnosticParams } from '@/lib/anitabi/imageProxy'
import { ingestMapImageDiagBatch } from '@/lib/mapImageDiag/service'
import type { MapImageDiagStage } from '@/lib/mapImageDiag/shared'

type RuntimeRequestContextLike = {
  waitUntil?: (promise: Promise<unknown>) => void
}

function getRuntimeWaitUntil(): ((promise: Promise<unknown>) => void) | null {
  const als = (globalThis as typeof globalThis & {
    __openNextAls?: { getStore?: () => RuntimeRequestContextLike | undefined }
  }).__openNextAls
  if (!als || typeof als.getStore !== 'function') return null
  const waitUntil = als.getStore?.()?.waitUntil
  return typeof waitUntil === 'function' ? waitUntil : null
}

export async function emitMapImageProxyEvent(
  prisma: PrismaClient,
  requestUrl: URL,
  input: {
    stage: MapImageDiagStage
    outcome?: string
    terminalState?: 'succeeded' | 'failed' | 'aborted'
    durationMs?: number
    targetHostBucket?: string
    evidence?: Record<string, unknown>
  },
): Promise<void> {
  const diag = readMapImageDiagnosticParams(requestUrl)
  if (!diag) return

  try {
    await ingestMapImageDiagBatch(
      {
        prisma,
        getSession: async () => null,
        now: () => new Date(),
      },
      {
        session: {
          session_id: diag.sessionId,
          sampled: Boolean(diag.sampled),
          escalation_reason: diag.escalationReason ?? null,
          route_context: null,
        },
        events: [
          {
            session_id: diag.sessionId,
            chain_id: diag.chainId,
            request_id: diag.requestId,
            occurred_at: new Date().toISOString(),
            slot_key: diag.slotKey,
            surface: diag.surface,
            slot_type: diag.slotType,
            owner: diag.owner,
            stage: input.stage,
            sampled: Boolean(diag.sampled),
            escalation_reason: diag.escalationReason ?? null,
            attempt_index: 0,
            candidate_index: 0,
            candidate_count: 0,
            duration_ms: input.durationMs,
            terminal_state: input.terminalState,
            outcome: input.outcome,
            target_host_bucket: input.targetHostBucket,
            evidence: {
              source: 'proxy',
              ...(input.evidence || {}),
            },
          },
        ],
      },
      { refreshSessionSummary: false },
    )
  } catch (error) {
    console.error('[map-image-diagnostics/proxy] emit failed', error)
  }
}

export function dispatchMapImageProxyEvent(
  prisma: PrismaClient,
  requestUrl: URL,
  input: Parameters<typeof emitMapImageProxyEvent>[2],
): void {
  const task = emitMapImageProxyEvent(prisma, requestUrl, input)
  const waitUntil = getRuntimeWaitUntil()
  if (waitUntil) {
    waitUntil(task)
    return
  }
  void task
}
