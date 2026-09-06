import { describe, expect, it } from 'vitest'
import {
  addUsage,
  attachLlmUsage,
  EMPTY_USAGE,
  llmUsageOf,
  parseAnthropicUsage,
  parseOpenAiUsage,
} from '@/lib/llm/usage'

describe('parseOpenAiUsage', () => {
  it('reads DeepSeek cache hit/miss and reasoning tokens', () => {
    expect(
      parseOpenAiUsage({
        prompt_tokens: 1200,
        completion_tokens: 300,
        prompt_cache_hit_tokens: 1000,
        prompt_cache_miss_tokens: 200,
        completion_tokens_details: { reasoning_tokens: 120 },
      }),
    ).toEqual({ inputMiss: 200, inputCacheHit: 1000, output: 300, reasoning: 120 })
  })

  it('falls back to OpenAI prompt_tokens_details.cached_tokens', () => {
    expect(
      parseOpenAiUsage({ prompt_tokens: 500, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 100 } }),
    ).toEqual({ inputMiss: 400, inputCacheHit: 100, output: 50, reasoning: 0 })
  })

  it('returns null for missing or malformed usage', () => {
    expect(parseOpenAiUsage(undefined)).toBeNull()
    expect(parseOpenAiUsage({ prompt_tokens: 'x' })).toBeNull()
  })

  it('treats negative token counts as malformed (null)', () => {
    expect(parseOpenAiUsage({ prompt_tokens: -10, completion_tokens: 5 })).toBeNull()
    expect(parseOpenAiUsage({ prompt_tokens: 10, completion_tokens: -5 })).toBeNull()
    expect(parseOpenAiUsage({ prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: -3 })?.inputCacheHit).toBe(0)
  })
})

describe('parseAnthropicUsage', () => {
  it('sums input + cache_creation as miss, cache_read as hit', () => {
    expect(
      parseAnthropicUsage(
        { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 800 },
        { output_tokens: 70 },
      ),
    ).toEqual({ inputMiss: 150, inputCacheHit: 800, output: 70, reasoning: 0 })
  })

  it('returns null when neither event carried usage', () => {
    expect(parseAnthropicUsage(undefined, undefined)).toBeNull()
  })
})

describe('attachLlmUsage / llmUsageOf', () => {
  it('attaches a non-enumerable property and reads it back', () => {
    const message = { role: 'assistant', content: 'hi' }
    attachLlmUsage(message, { inputMiss: 1, inputCacheHit: 2, output: 3, reasoning: 0 })
    expect(llmUsageOf(message)).toEqual({ inputMiss: 1, inputCacheHit: 2, output: 3, reasoning: 0 })
    expect(JSON.stringify(message)).toBe('{"role":"assistant","content":"hi"}')
    expect(llmUsageOf(null)).toBeNull()
    expect(llmUsageOf({})).toBeNull()
  })
})

describe('addUsage', () => {
  it('adds field-wise starting from EMPTY_USAGE', () => {
    const a = addUsage(EMPTY_USAGE, { inputMiss: 1, inputCacheHit: 2, output: 3, reasoning: 4 })
    expect(addUsage(a, { inputMiss: 10, inputCacheHit: 20, output: 30, reasoning: 40 })).toEqual({
      inputMiss: 11,
      inputCacheHit: 22,
      output: 33,
      reasoning: 44,
    })
  })
})
