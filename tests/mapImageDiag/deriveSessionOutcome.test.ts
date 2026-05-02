import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deriveSessionOutcome } from '@/lib/mapImageDiag/shared'

const OUTCOME_V2_FLAG = 'MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED'

describe('deriveSessionOutcome', () => {
  const originalOutcomeV2Flag = process.env[OUTCOME_V2_FLAG]

  beforeEach(() => {
    delete process.env[OUTCOME_V2_FLAG]
  })

  afterEach(() => {
    if (originalOutcomeV2Flag === undefined) {
      delete process.env[OUTCOME_V2_FLAG]
      return
    }
    process.env[OUTCOME_V2_FLAG] = originalOutcomeV2Flag
  })

  it('returns failed for multi-candidate terminal failures when the flag is enabled', () => {
    process.env[OUTCOME_V2_FLAG] = '1'

    expect(deriveSessionOutcome([
      { terminalState: 'failed', candidateCount: 2, outcome: 'timeout' },
    ])).toBe('failed')
  })

  it('returns no_data for single-candidate timeout failures when the flag is enabled', () => {
    process.env[OUTCOME_V2_FLAG] = '1'

    expect(deriveSessionOutcome([
      { terminalState: 'failed', candidateCount: 1, outcome: 'timeout' },
    ])).toBe('no_data')
  })

  it('returns failed for single-candidate non-timeout failures when the flag is enabled', () => {
    process.env[OUTCOME_V2_FLAG] = '1'

    expect(deriveSessionOutcome([
      { terminalState: 'failed', candidateCount: 1, outcome: 'network_error' },
    ])).toBe('failed')
  })

  it('returns failed for mixed single-candidate and multi-candidate timeout failures when the flag is enabled', () => {
    process.env[OUTCOME_V2_FLAG] = '1'

    expect(deriveSessionOutcome([
      { terminalState: 'failed', candidateCount: 1, outcome: 'timeout' },
      { terminalState: 'failed', candidateCount: 2, outcome: 'timeout' },
    ])).toBe('failed')
  })

  it('preserves failed for single-candidate timeout failures when the flag is disabled', () => {
    expect(deriveSessionOutcome([
      { terminalState: 'failed', candidateCount: 1, outcome: 'timeout' },
    ])).toBe('failed')
  })

  it('preserves fallback outcomes ahead of the timeout no_data classification', () => {
    process.env[OUTCOME_V2_FLAG] = '1'

    expect(deriveSessionOutcome([
      { terminalState: 'succeeded', displayOutcome: 'fallback' },
      { terminalState: 'failed', candidateCount: 1, outcome: 'timeout' },
    ])).toBe('fallback')
  })

  it('preserves the last terminal state when no fallback or failed override applies', () => {
    process.env[OUTCOME_V2_FLAG] = '1'

    expect(deriveSessionOutcome([
      { terminalState: 'failed', candidateCount: 1, outcome: 'timeout' },
      { terminalState: 'aborted' },
    ])).toBe('aborted')
    expect(deriveSessionOutcome([])).toBe('pending')
  })
})
