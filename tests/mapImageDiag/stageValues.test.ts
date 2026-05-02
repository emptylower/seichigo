import { describe, expect, it } from 'vitest'
import { ingestEventSchema, mapImageDiagStageSchema, mapImageDiagStageValues } from '@/lib/mapImageDiag/shared'

describe('mapImageDiag stage values', () => {
  it('includes image_cache_state in the canonical typed stage list', () => {
    expect(mapImageDiagStageValues).toContain('image_cache_state')
  })

  it('accepts image_cache_state in the canonical stage schema', () => {
    expect(mapImageDiagStageSchema.parse('image_cache_state')).toBe('image_cache_state')
  })

  it('keeps ingest event stage validation flexible for canonical and non-canonical stages', () => {
    const baseEvent = {
      session_id: 'session-1',
      chain_id: 'chain-1',
      request_id: 'request-1',
      sampled: true,
      escalation_reason: null,
      attempt_index: 0,
      candidate_index: 0,
      candidate_count: 1,
      evidence: {},
    }

    expect(() => ingestEventSchema.parse({
      ...baseEvent,
      stage: 'image_cache_state',
    })).not.toThrow()

    expect(() => ingestEventSchema.parse({
      ...baseEvent,
      stage: 'future_custom_stage',
    })).not.toThrow()
  })
})
