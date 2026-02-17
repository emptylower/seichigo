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
})

