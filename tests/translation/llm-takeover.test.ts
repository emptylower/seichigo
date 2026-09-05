import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { resolveLlmForScope } = vi.hoisted(() => ({ resolveLlmForScope: vi.fn() }))

vi.mock('@/lib/llm/registry', () => ({
  resolveLlmForScope: (...args: unknown[]) => resolveLlmForScope(...(args as [])),
}))

import { callGemini, translateTextBatch } from '@/lib/translation/gemini'
import { createLlmClient } from '@/lib/llm/client'
import { LlmHttpError } from '@/lib/llm/http'
import { isRetryableProviderErrorMessage } from '@/lib/translation/retryableProviderError'

function openaiTextResponse(text: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
  })
}

function takeoverProvider(fetchImpl: ReturnType<typeof vi.fn>) {
  return {
    client: createLlmClient({
      protocol: 'openai' as const,
      endpointUrl: 'https://relay.example.com/v1/chat/completions',
      apiKey: 'sk-relay-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
    model: 'gpt-relay-mini',
    maxOutputTokens: 8192,
    providerId: 'llm-9',
    providerName: '中转',
    protocol: 'openai' as const,
  }
}

beforeEach(() => {
  resolveLlmForScope.mockReset()
  resolveLlmForScope.mockResolvedValue(null)
  process.env.GEMINI_API_KEY = 'test-key'
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('translation llm takeover', () => {
  it('routes callGemini through the takeover provider instead of generativelanguage.googleapis.com', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openaiTextResponse('{"0":"Tokyo"}'))
    resolveLlmForScope.mockResolvedValue({
      client: createLlmClient({
        protocol: 'openai',
        endpointUrl: 'https://relay.example.com/v1/chat/completions',
        apiKey: 'sk-relay-key',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
      model: 'gpt-relay-mini',
      maxOutputTokens: 8192,
      providerId: 'llm-9',
      providerName: '中转',
      protocol: 'openai',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callGemini('translate this', 0, { maxRetries: 0 })

    expect(result).toBe('{"0":"Tokyo"}')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://relay.example.com/v1/chat/completions')
    expect(url).not.toContain('generativelanguage.googleapis.com')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-relay-key')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('gpt-relay-mini')
    expect(body.max_tokens).toBe(8192)
    expect(body.temperature).toBe(0.1)
  })

  it('requests json output (response_format) when responseMimeType is application/json', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openaiTextResponse('{"0":"Tokyo","1":"Osaka"}'))
    resolveLlmForScope.mockResolvedValue({
      client: createLlmClient({
        protocol: 'openai',
        endpointUrl: 'https://relay.example.com/v1/chat/completions',
        apiKey: 'sk-relay-key',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
      model: 'gpt-relay-mini',
      maxOutputTokens: 8192,
      providerId: 'llm-9',
      providerName: '中转',
      protocol: 'openai',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await translateTextBatch(['东京', '大阪'], 'en', {
      fallbackMode: 'error',
      callOptions: { maxRetries: 0 },
    })

    expect(result.get('东京')).toBe('Tokyo')
    expect(result.get('大阪')).toBe('Osaka')
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(String((fetchMock.mock.calls[0] as [string, RequestInit])[0])).not.toContain(
      'generativelanguage.googleapis.com',
    )
  })

  it('falls back to native Gemini when no provider takes over', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'native ok' }] } }],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await callGemini('translate', 0, { maxRetries: 0 })

    expect(result).toBe('native ok')
    expect(String((fetchMock.mock.calls[0] as [string, RequestInit])[0])).toContain(
      'generativelanguage.googleapis.com',
    )
  })

  it('maps LlmHttpError 429/5xx messages onto the retryable provider patterns', () => {
    expect(isRetryableProviderErrorMessage('LLM API error (429): quota')).toBe(true)
    expect(isRetryableProviderErrorMessage('LLM API error (503): upstream down')).toBe(true)
    expect(isRetryableProviderErrorMessage('LLM request timed out after 20000ms')).toBe(true)
    expect(isRetryableProviderErrorMessage('LLM API error (401): bad key')).toBe(false)
  })

  it('throws LlmHttpError 429 from the takeover provider immediately (no local retry)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('quota exceeded', { status: 429 }))
    resolveLlmForScope.mockResolvedValue(takeoverProvider(fetchMock))

    const err: unknown = await callGemini('translate this', 0, {
      maxRetries: 5,
      initialBackoffMs: 1,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmHttpError)
    expect((err as LlmHttpError).status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws native "Gemini API error (429)" immediately (keeps the legacy short-circuit intent)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callGemini('translate', 0, { maxRetries: 5, initialBackoffMs: 1 }),
    ).rejects.toThrow('Gemini API error (429)')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails fast on permanent 4xx: the json downgrade runs once inside the client and is not multiplied by outer retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }))
    resolveLlmForScope.mockResolvedValue(takeoverProvider(fetchMock))

    const err: unknown = await callGemini('translate this', 0, {
      responseMimeType: 'application/json',
      maxRetries: 5,
      initialBackoffMs: 1,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmHttpError)
    expect((err as LlmHttpError).status).toBe(400)
    // 第一次带 response_format 的 400 + 客户端内一次降级重发，仅此两次
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const bodies = fetchMock.mock.calls.map(
      (call) => JSON.parse(String((call as [string, RequestInit])[1].body)) as Record<string, unknown>,
    )
    expect(bodies[0].response_format).toEqual({ type: 'json_object' })
    expect(bodies[1].response_format).toBeUndefined()
  })

  it('still retries transient 5xx failures with backoff (upstream overload is not permanent)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream down', { status: 503 }))
      .mockResolvedValueOnce(openaiTextResponse('{"0":"Tokyo"}'))
    resolveLlmForScope.mockResolvedValue(takeoverProvider(fetchMock))

    const result = await callGemini('translate this', 0, {
      maxRetries: 2,
      initialBackoffMs: 1,
    })

    expect(result).toBe('{"0":"Tokyo"}')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
