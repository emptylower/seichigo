import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translateTextBatch } from '@/lib/translation/gemini'

function geminiTextResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }),
    text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
  } as any
}

describe('translateTextBatch', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('parses embedded JSON object even when response contains extra wrappers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      geminiTextResponse('Here is your result:\n{"0":"Tokyo","1":"Osaka"}\nDone.')
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await translateTextBatch(['东京', '大阪'], 'en')

    expect(result.get('东京')).toBe('Tokyo')
    expect(result.get('大阪')).toBe('Osaka')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to single translation when batch JSON is malformed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiTextResponse('{"0":"Tokyo","1":"Osaka'))
      .mockResolvedValueOnce(geminiTextResponse('Tokyo'))
      .mockResolvedValueOnce(geminiTextResponse('Osaka'))

    vi.stubGlobal('fetch', fetchMock)

    const result = await translateTextBatch(['东京', '大阪'], 'en')

    expect(result.get('东京')).toBe('Tokyo')
    expect(result.get('大阪')).toBe('Osaka')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('can fail fast on malformed batch JSON when fallback is disabled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiTextResponse('{"0":"Tokyo","1":"Osaka'))

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      translateTextBatch(['东京', '大阪'], 'en', {
        fallbackMode: 'error',
        callOptions: { maxRetries: 0 },
      })
    ).rejects.toThrow('Batch translation returned malformed JSON')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a readable timeout error with the configured request budget', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      translateTextBatch(['东京'], 'en', {
        fallbackMode: 'error',
        callOptions: {
          maxRetries: 0,
          requestTimeoutMs: 12_345,
        },
      })
    ).rejects.toThrow('Gemini request timed out after 12345ms')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
