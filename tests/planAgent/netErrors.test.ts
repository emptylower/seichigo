import { describe, it, expect } from 'vitest'
import { isTransientNetworkError, agentErrorMessage, AGENT_NETWORK_ERROR_MESSAGE } from '@/lib/planAgent/netErrors'

describe('isTransientNetworkError', () => {
  it('matches the exact workerd "Network connection lost." platform error (production incident message)', () => {
    expect(isTransientNetworkError(new TypeError('Network connection lost.'))).toBe(true)
  })

  it('matches openai SDK APIConnectionError default message and common socket/pg network errors', () => {
    expect(isTransientNetworkError(new Error('Connection error.'))).toBe(true)
    expect(isTransientNetworkError(new Error('fetch failed'))).toBe(true)
    expect(isTransientNetworkError(new Error('read ECONNRESET'))).toBe(true)
    expect(isTransientNetworkError(new Error('connect ETIMEDOUT 1.2.3.4:5432'))).toBe(true)
    expect(isTransientNetworkError(new Error('Connection terminated unexpectedly'))).toBe(true)
    expect(isTransientNetworkError(new Error('socket hang up'))).toBe(true)
  })

  it('walks the cause chain: SDK wraps the workerd error inside APIConnectionError', () => {
    const wrapped = new Error('Connection error.')
    ;(wrapped as Error & { cause?: unknown }).cause = new TypeError('Network connection lost.')
    expect(isTransientNetworkError(wrapped)).toBe(true)
  })

  it('does not match domain/API errors that must surface as-is', () => {
    expect(isTransientNetworkError(new Error('模型未返回消息'))).toBe(false)
    expect(isTransientNetworkError(new Error('Incorrect API key provided'))).toBe(false)
    expect(isTransientNetworkError(new Error('rate limited'))).toBe(false)
    expect(isTransientNetworkError('string throwable')).toBe(false)
    expect(isTransientNetworkError(null)).toBe(false)
  })
})

describe('agentErrorMessage', () => {
  it('maps transient network errors to the friendly Chinese message', () => {
    expect(agentErrorMessage(new TypeError('Network connection lost.'))).toBe(AGENT_NETWORK_ERROR_MESSAGE)
    expect(agentErrorMessage(new TypeError('Network connection lost.'))).toContain('不会丢失')
  })

  it('maps transient network errors to localized messages', () => {
    expect(agentErrorMessage(new TypeError('Network connection lost.'), 'en')).toBe(
      'The network connection dropped and this reply was cut off. Everything saved so far is safe — just send another message to continue.',
    )
    const ja = agentErrorMessage(new Error('Network connection lost.'), 'ja')
    expect(ja).toContain('ネットワーク接続')
    expect(ja).toContain('失われません')
  })

  it('keeps the raw message for ordinary errors and stringifies non-Error throwables', () => {
    expect(agentErrorMessage(new Error('rate limited'))).toBe('rate limited')
    expect(agentErrorMessage(new Error('rate limited'), 'ja')).toBe('rate limited')
    expect(agentErrorMessage('boom')).toBe('boom')
  })
})
