import { describe, expect, it, vi } from 'vitest'
import { createLlmClient } from '@/lib/llm/client'
import { LlmHttpError } from '@/lib/llm/http'
import { llmUsageOf } from '@/lib/llm/usage'

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

/** 把任意字符串片段按序注入响应体（模拟 TCP 分片把一行 data: 拆开）。 */
function sseResponseChunks(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('openai-compatible client', () => {
  it('streams via the full endpointUrl with a Bearer header and rebuilds the message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        chunk({ role: 'assistant' }),
        chunk({ reasoning_content: '先想想' }),
        chunk({ content: '你' }),
        chunk({ content: '好' }),
        chunk({}, 'stop'),
        'data: [DONE]\n\n',
      ]),
    )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://api.deepseek.com/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const onDelta = vi.fn()
    const message = await client.streamChat(
      { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1024 },
      onDelta,
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-v4-flash',
      max_tokens: 1024,
      stream: true,
    })

    expect(message.role).toBe('assistant')
    expect(message.content).toBe('你好')
    expect(message.reasoning_content).toBe('先想想')
    expect(message.finish_reason).toBe('stop')
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual([
      { reasoning: '先想想' },
      { content: '你' },
      { content: '好' },
    ])
  })

  it('accumulates two tool_calls with concatenated argument fragments', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        chunk({
          tool_calls: [
            { index: 0, id: 'call_1', type: 'function', function: { name: 'list_points', arguments: '' } },
          ],
        }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"ba' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'ngumiId":1}' } }] }),
        chunk({
          tool_calls: [
            { index: 1, id: 'call_2', type: 'function', function: { name: 'read_plan', arguments: '{}' } },
          ],
        }),
        chunk({}, 'tool_calls'),
      ]),
    )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://example.com/v1/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const message = await client.streamChat({
      model: 'm',
      messages: [],
      tools: [
        {
          type: 'function',
          function: { name: 'list_points', description: 'd', parameters: { type: 'object', properties: {} } },
        },
      ],
      maxTokens: 100,
    })

    expect(message.tool_calls).toHaveLength(2)
    expect(message.tool_calls?.[0]).toMatchObject({
      id: 'call_1',
      function: { name: 'list_points', arguments: '{"bangumiId":1}' },
    })
    expect(message.tool_calls?.[1]).toMatchObject({
      id: 'call_2',
      function: { name: 'read_plan', arguments: '{}' },
    })
    expect(message.finish_reason).toBe('tool_calls')
    // 请求体带上 tools
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.tools).toHaveLength(1)
  })

  it('throws LlmHttpError with status and a body snippet on non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"error":{"message":"bad key"}}', { status: 401 }),
    )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://example.com/v1/chat/completions',
      apiKey: 'sk-bad',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await expect(
      client.streamChat({ model: 'm', messages: [], maxTokens: 1 }),
    ).rejects.toBeInstanceOf(LlmHttpError)
  })

  it('completeText sends response_format json_object and returns the content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }), {
        status: 200,
      }),
    )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://example.com/v1/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const text = await client.completeText({
      model: 'm',
      system: 'be brief',
      prompt: 'hi',
      maxTokens: 64,
      json: true,
      temperature: 0.1,
    })

    expect(text).toBe('{"a":1}')
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be brief' })
    expect(body.stream).toBe(false)
  })

  it('completeText retries once without response_format when the endpoint rejects it with 400', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('response_format not supported', { status: 400 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
          status: 200,
        }),
      )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://example.com/v1/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const text = await client.completeText({ model: 'm', prompt: 'hi', maxTokens: 8, json: true })

    expect(text).toBe('{"ok":true}')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(String((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body))
    expect(secondBody.response_format).toBeUndefined()
  })

  it('treats a stream with zero SSE payloads as an empty-stream (retryable) error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([]))
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://example.com/v1/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.streamChat({ model: 'm', messages: [], maxTokens: 1 })).rejects.toThrow(
      '模型未返回消息',
    )
  })

  it('F8：只含 usage 帧（choices 为空数组）的流仍判空流', async () => {
    const usageOnlyFrame =
      'data: ' +
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }) +
      '\n\n'
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([usageOnlyFrame, 'data: [DONE]\n\n']))
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://f8-usage-only.example.com/v1/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.streamChat({ model: 'm', messages: [], maxTokens: 1 })).rejects.toThrow('模型未返回消息')
  })

  it('F1：端点 400 提到 stream_options → 去掉该字段立即重发一次，并记住该端点', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":{"message":"Unknown parameter: stream_options"}}', { status: 400 }),
      )
      .mockResolvedValueOnce(
        sseResponse([chunk({ role: 'assistant' }), chunk({ content: '好' }), chunk({}, 'stop'), 'data: [DONE]\n\n']),
      )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://legacy-f1.example.com/v1/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const message = await client.streamChat({ model: 'm', messages: [], maxTokens: 8 })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(message.content).toBe('好')
    const firstBody = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))
    const secondBody = JSON.parse(String((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body))
    expect(firstBody.stream_options).toEqual({ include_usage: true })
    expect(secondBody.stream_options).toBeUndefined()

    // 同端点再发：记忆生效，只调一次 fetch 且直接不带 stream_options
    fetchImpl.mockReset()
    fetchImpl.mockResolvedValue(sseResponse([chunk({ content: '再来' }), chunk({}, 'stop'), 'data: [DONE]\n\n']))
    const again = await client.streamChat({ model: 'm', messages: [], maxTokens: 8 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(again.content).toBe('再来')
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body)).stream_options).toBeUndefined()
  })

  it('F1：与 stream_options 无关的 400 原样抛出（单次请求，不做无差别重试）', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{"error":{"message":"max_tokens is too large"}}', { status: 400 }))
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://other400-f1.example.com/v1/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const err: unknown = await client.streamChat({ model: 'm', messages: [], maxTokens: 1 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmHttpError)
    expect((err as LlmHttpError).status).toBe(400)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reassembles a data: line split across multiple chunks mid-JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponseChunks([
        'data: {"cho',
        'ices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
        'data: {"cho',
        'ices":[{"index":0,"delta":{"content":"跨片"},"finish_reason":null}]}\n\n',
        'data: {"cho',
        'ices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://example.com/v1/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const message = await client.streamChat({ model: 'm', messages: [], maxTokens: 8 })

    expect(message.content).toBe('跨片')
    expect(message.finish_reason).toBe('stop')
  })

  it('requests stream_options.include_usage and attaches the final usage chunk', async () => {
    const usageChunk =
      'data: ' +
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 300,
          prompt_cache_hit_tokens: 1000,
          prompt_cache_miss_tokens: 200,
          completion_tokens_details: { reasoning_tokens: 120 },
        },
      }) +
      '\n\n'
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([chunk({ role: 'assistant' }), chunk({ content: '好' }), chunk({}, 'stop'), usageChunk, 'data: [DONE]\n\n']),
    )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://api.deepseek.com/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const message = await client.streamChat({ model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 })

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).stream_options).toEqual({ include_usage: true })
    expect(message.content).toBe('好')
    expect(llmUsageOf(message)).toEqual({ inputMiss: 200, inputCacheHit: 1000, output: 300, reasoning: 120 })
    expect(Object.keys(message)).not.toContain('llm_usage')
  })

  it('rejects 3xx redirects without following them and never sends a second request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'http://169.254.169.254/latest/meta-data' },
      }),
    )
    const client = createLlmClient({
      protocol: 'openai',
      endpointUrl: 'https://example.com/v1/chat/completions',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const err: unknown = await client
      .streamChat({ model: 'm', messages: [], maxTokens: 1 })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmHttpError)
    expect((err as LlmHttpError).status).toBe(302)
    expect((err as LlmHttpError).message).toContain('上游返回重定向，已拒绝')
    // 只发出一次请求：没有跟随 Location 去打内网地址
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const init = (fetchImpl.mock.calls[0] as [string, RequestInit])[1]
    expect(init.redirect).toBe('manual')
  })
})
