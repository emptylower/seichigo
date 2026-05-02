import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  recordHostFailure,
  resolveHostState,
  resolveHostTimeoutMs,
  resetDegradedMapImageHostsForTest,
} from '@/components/map/utils/mapImageHostPolicy'

const BREAKER_FLAG = 'NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED'
const DEFAULT_TIMEOUT_MS = 7_500

describe('mapImageHostPolicy circuit breaker', () => {
  const originalBreakerFlag = process.env[BREAKER_FLAG]

  beforeEach(() => {
    resetDegradedMapImageHostsForTest()
    delete process.env[BREAKER_FLAG]
  })

  afterEach(() => {
    resetDegradedMapImageHostsForTest()
    if (originalBreakerFlag === undefined) {
      delete process.env[BREAKER_FLAG]
      return
    }
    process.env[BREAKER_FLAG] = originalBreakerFlag
  })

  it('starts healthy and preserves default timeout', () => {
    expect(resolveHostState('image.anitabi.cn', 'cover', 0)).toBe('healthy')
    expect(resolveHostTimeoutMs('image.anitabi.cn', 'cover', DEFAULT_TIMEOUT_MS, 0)).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('transitions to degraded after 2 failures within window, timeout 2000 when v2 enabled', () => {
    process.env[BREAKER_FLAG] = '1'

    recordHostFailure('image.anitabi.cn', 'cover', 0)
    expect(resolveHostState('image.anitabi.cn', 'cover', 0)).toBe('healthy')

    recordHostFailure('image.anitabi.cn', 'cover', 5_000)
    expect(resolveHostState('image.anitabi.cn', 'cover', 5_000)).toBe('degraded')
    expect(resolveHostTimeoutMs('image.anitabi.cn', 'cover', DEFAULT_TIMEOUT_MS, 5_000)).toBe(2_000)
  })

  it('transitions to blocked after 3 failures within 10s, timeout 0 when v2 enabled', () => {
    process.env[BREAKER_FLAG] = '1'

    recordHostFailure('image.anitabi.cn', 'cover', 0)
    recordHostFailure('image.anitabi.cn', 'cover', 3_000)
    recordHostFailure('image.anitabi.cn', 'cover', 9_999)

    expect(resolveHostState('image.anitabi.cn', 'cover', 9_999)).toBe('blocked')
    expect(resolveHostTimeoutMs('image.anitabi.cn', 'cover', DEFAULT_TIMEOUT_MS, 9_999)).toBe(0)
  })

  it('does not block when the 3rd failure is outside the 10s window, but remains degraded', () => {
    process.env[BREAKER_FLAG] = '1'

    recordHostFailure('image.anitabi.cn', 'cover', 0)
    recordHostFailure('image.anitabi.cn', 'cover', 5_000)
    recordHostFailure('image.anitabi.cn', 'cover', 10_001)

    expect(resolveHostState('image.anitabi.cn', 'cover', 10_001)).toBe('degraded')
    expect(resolveHostTimeoutMs('image.anitabi.cn', 'cover', DEFAULT_TIMEOUT_MS, 10_001)).toBe(2_000)
  })

  it('still degrades after two failures outside the 10s blocker window', () => {
    process.env[BREAKER_FLAG] = '1'

    recordHostFailure('image.anitabi.cn', 'cover', 0)
    expect(resolveHostState('image.anitabi.cn', 'cover', 10_999)).toBe('healthy')

    recordHostFailure('image.anitabi.cn', 'cover', 11_000)
    expect(resolveHostState('image.anitabi.cn', 'cover', 11_000)).toBe('degraded')
    expect(resolveHostTimeoutMs('image.anitabi.cn', 'cover', DEFAULT_TIMEOUT_MS, 11_000)).toBe(2_000)
  })

  it('exits blocked and expired state after 60s TTL', () => {
    process.env[BREAKER_FLAG] = '1'

    recordHostFailure('image.anitabi.cn', 'cover', 0)
    recordHostFailure('image.anitabi.cn', 'cover', 1_000)
    recordHostFailure('image.anitabi.cn', 'cover', 2_000)

    expect(resolveHostState('image.anitabi.cn', 'cover', 2_000)).toBe('blocked')
    expect(resolveHostState('image.anitabi.cn', 'cover', 62_001)).toBe('healthy')
    expect(resolveHostTimeoutMs('image.anitabi.cn', 'cover', DEFAULT_TIMEOUT_MS, 62_001)).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('scopes failures independently by scope and host', () => {
    process.env[BREAKER_FLAG] = '1'

    recordHostFailure('image.anitabi.cn', 'cover', 0)
    recordHostFailure('image.anitabi.cn', 'cover', 1_000)
    recordHostFailure('lain.bgm.tv', 'cover', 2_000)
    recordHostFailure('image.anitabi.cn', 'point-thumbnail', 2_000)

    expect(resolveHostState('image.anitabi.cn', 'cover', 2_000)).toBe('degraded')
    expect(resolveHostState('lain.bgm.tv', 'cover', 2_000)).toBe('healthy')
    expect(resolveHostState('image.anitabi.cn', 'point-thumbnail', 2_000)).toBe('healthy')
  })

  it('feature flag off: 3 failures does not block, and timeout remains default', () => {
    recordHostFailure('image.anitabi.cn', 'cover', 0)
    recordHostFailure('image.anitabi.cn', 'cover', 1_000)
    recordHostFailure('image.anitabi.cn', 'cover', 2_000)

    expect(resolveHostState('image.anitabi.cn', 'cover', 2_000)).toBe('degraded')
    expect(resolveHostTimeoutMs('image.anitabi.cn', 'cover', DEFAULT_TIMEOUT_MS, 2_000)).toBe(DEFAULT_TIMEOUT_MS)
  })
})
