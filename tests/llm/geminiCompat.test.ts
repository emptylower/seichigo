import { describe, expect, it, vi } from 'vitest'
import { isGoogleGeminiOpenAiEndpoint } from '@/lib/llm/geminiCompat'
import { createLlmClient } from '@/lib/llm/client'

/**
 * A2 补充：Gemini 官方 OpenAI 兼容端点的思考回显（2026-09-04 实测）。
 * generativelanguage.googleapis.com 需要 extra_body.google.thinking_config
 * 才回传思考摘要（thought:true 标记 + <thought> 标签）；其它 host 不加任何
 * 额外字段，避免中转（如 404gemini）因未知字段报错。
 */

const GOOGLE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return (
    'data: ' +
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    }) +
    '\n\n'
  )
}

describe('isGoogleGeminiOpenAiEndpoint', () => {
  it('Google 官方 OpenAI 兼容端点返回 true', () => {
    expect(isGoogleGeminiOpenAiEndpoint(GOOGLE_ENDPOINT)).toBe(true)
  })

  it('中转/其它供应商端点返回 false', () => {
    expect(isGoogleGeminiOpenAiEndpoint('https://api.codelife.eu.cc/v1/chat/completions')).toBe(false)
    expect(isGoogleGeminiOpenAiEndpoint('https://api.deepseek.com/chat/completions')).toBe(false)
    expect(isGoogleGeminiOpenAiEndpoint('https://api.openai.com/v1/chat/completions')).toBe(false)
  })

  it('host 精确匹配：伪 suffix 域名不算（SSRF 式绕过）', () => {
    expect(
      isGoogleGeminiOpenAiEndpoint('https://generativelanguage.googleapis.com.evil.com/v1/chat/completions'),
    ).toBe(false)
  })

  it('非法 URL 返回 false 而不是抛错', () => {
    expect(isGoogleGeminiOpenAiEndpoint('not a url')).toBe(false)
  })
})

describe('streamChat 请求体的 extra_body 口径', () => {
  it('Google host：追加 extra_body.google.thinking_config（include_thoughts），且不带 reasoning_effort / thinking_level', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([chunk({ role: 'assistant' }), chunk({ content: 'ok' }), chunk({}, 'stop'), 'data: [DONE]\n\n']),
    )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: GOOGLE_ENDPOINT,
      apiKey: 'g-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await client.streamChat({ model: 'gemini-2.5-flash', messages: [], maxTokens: 64 })

    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.extra_body).toEqual({ google: { thinking_config: { include_thoughts: true } } })
    expect(body.reasoning_effort).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('thinking_level')
  })

  it('非 Google host：请求体完全没有 extra_body 字段', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([chunk({ role: 'assistant' }), chunk({}, 'stop'), 'data: [DONE]\n\n']),
    )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://api.codelife.eu.cc/v1/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await client.streamChat({ model: 'gemini-3.8-flash-high', messages: [], maxTokens: 64 })

    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body).not.toHaveProperty('extra_body')
  })
})

describe('Google 思考摘要的流式回显（实测形态）', () => {
  it('thought:true 标记 + <thought> 标签：正文不含思考，reasoning_content 含思考', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        chunk({ role: 'assistant' }),
        // 思考摘要：普通 content 增量 + extra_content.google.thought 标记，文本包在 <thought> 里
        chunk({ content: '<thought>', extra_content: { google: { thought: true } } }),
        chunk({ content: '先想一下用户', extra_content: { google: { thought: true } } }),
        chunk({ content: '要什么', extra_content: { google: { thought: true } } }),
        // </thought> 可能出现在正文第一个 chunk 的开头（此时不再带 thought 标记）
        chunk({ content: '</thought>你好！这里是结论。' }),
        chunk({}, 'stop'),
        'data: [DONE]\n\n',
      ]),
    )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: GOOGLE_ENDPOINT,
      apiKey: 'g-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const message = await client.streamChat({ model: 'gemini-2.5-flash', messages: [], maxTokens: 64 })

    expect(message.content).toBe('你好！这里是结论。')
    expect(message.reasoning_content).toBe('先想一下用户要什么')
  })
})
