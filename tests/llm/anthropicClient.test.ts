import { describe, expect, it, vi } from 'vitest'
import { createLlmClient } from '@/lib/llm/client'
import { convertMessages } from '@/lib/llm/anthropicClient'

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

/** 把任意字符串片段按序注入响应体（模拟 TCP 分片把一行 data: 拆开）。 */
function sseResponseChunks(chunks: string[]): Response {
  return sseResponse(chunks)
}

function event(type: string, payload: Record<string, unknown> = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`
}

describe('anthropic client', () => {
  it('sends x-api-key + anthropic-version headers and the converted request body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        event('message_start'),
        event('content_block_start', { index: 0, content_block: { type: 'text' } }),
        event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK' } }),
        event('message_delta', { delta: { stop_reason: 'end_turn' } }),
        event('message_stop'),
      ]),
    )
    const client = createLlmClient({
      protocol: 'anthropic',
      endpointUrl: 'https://api.anthropic.com/v1/messages',
      apiKey: 'sk-ant-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const message = await client.streamChat({
      model: 'claude-x',
      messages: [
        { role: 'system', content: '你是巡礼规划师' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_plan', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 't1', content: '{"days":[]}' },
        { role: 'tool', tool_call_id: 't2', content: '{"ok":true}' },
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'read_plan', description: '读取计划', parameters: { type: 'object', properties: {} } },
        },
      ],
      maxTokens: 512,
    })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    // system 抽取
    expect(body.system).toBe('你是巡礼规划师')
    // tool_calls → tool_use block（input 已 parse）
    // 连续两条 tool 回执合并进同一条 user 消息（tool_result blocks）
    const messages = body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>
    expect(messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'read_plan', input: {} }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: '{"days":[]}' },
          { type: 'tool_result', tool_use_id: 't2', content: '{"ok":true}' },
        ],
      },
    ])
    // tools 转换
    expect(body.tools).toEqual([
      {
        name: 'read_plan',
        description: '读取计划',
        input_schema: { type: 'object', properties: {} },
      },
    ])
    expect(body.max_tokens).toBe(512)

    expect(message.content).toBe('OK')
    expect(message.finish_reason).toBe('stop')
  })

  it('accumulates tool_use blocks and maps stop_reason max_tokens → finish_reason length', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'save_plan_days' } }),
        event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"day' } }),
        event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: 's":1}' } }),
        event('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'tu_2', name: 'ask_user' } }),
        event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } }),
        event('message_delta', { delta: { stop_reason: 'tool_use' } }),
      ]),
    )
    const client = createLlmClient({
      protocol: 'anthropic',
      endpointUrl: 'https://api.anthropic.com/v1/messages',
      apiKey: 'sk-ant-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const message = await client.streamChat({ model: 'claude-x', messages: [], maxTokens: 64 })

    expect(message.tool_calls).toHaveLength(2)
    expect(message.tool_calls?.[0]).toMatchObject({
      id: 'tu_1',
      function: { name: 'save_plan_days', arguments: '{"days":1}' },
    })
    expect(message.tool_calls?.[1]).toMatchObject({
      id: 'tu_2',
      function: { name: 'ask_user', arguments: '{}' },
    })
    expect(message.finish_reason).toBe('tool_calls')
  })

  it('forwards thinking_delta as reasoning and maps max_tokens stop to length', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: '思' } }),
        event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: '考' } }),
        event('content_block_delta', { index: 1, delta: { type: 'text_delta', text: '答案' } }),
        event('message_delta', { delta: { stop_reason: 'max_tokens' } }),
      ]),
    )
    const client = createLlmClient({
      protocol: 'anthropic',
      endpointUrl: 'https://api.anthropic.com/v1/messages',
      apiKey: 'sk-ant-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const onDelta = vi.fn()
    const message = await client.streamChat({ model: 'c', messages: [], maxTokens: 8 }, onDelta)

    expect(message.reasoning_content).toBe('思考')
    expect(message.content).toBe('答案')
    expect(message.finish_reason).toBe('length')
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual([
      { reasoning: '思' },
      { reasoning: '考' },
      { content: '答案' },
    ])
  })

  it('completeText posts a non-stream request and joins text blocks', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            { type: 'text', text: '{"0":' },
            { type: 'text', text: '"Tokyo"}' },
          ],
        }),
        { status: 200 },
      ),
    )
    const client = createLlmClient({
      protocol: 'anthropic',
      endpointUrl: 'https://api.anthropic.com/v1/messages',
      apiKey: 'sk-ant-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const text = await client.completeText({
      model: 'c',
      system: 'translate',
      prompt: '东京',
      maxTokens: 8192,
      temperature: 0.1,
    })

    expect(text).toBe('{"0":"Tokyo"}')
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.system).toBe('translate')
    expect(body.stream).toBeUndefined()
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '东京' }] }])
  })
})

describe('convertMessages (empty message dropping)', () => {
  it('drops assistant messages with null content (no text, no tool_use)', () => {
    const { messages } = convertMessages([{ role: 'assistant', content: null }])
    expect(messages).toEqual([])
  })

  it('drops user messages whose text is empty', () => {
    const { messages } = convertMessages([{ role: 'user', content: '' }])
    expect(messages).toEqual([])
  })

  it('keeps real neighbors while dropping empties between them', () => {
    const { messages } = convertMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null },
      { role: 'user', content: '' },
      { role: 'assistant', content: '你好' },
    ])
    expect(messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: '你好' }] },
    ])
  })
})

describe('stop_reason edge mapping (pause_turn / refusal)', () => {
  it('maps pause_turn to finish_reason length (budget-exhaustion style continuation)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '部分' } }),
        event('message_delta', { delta: { stop_reason: 'pause_turn' } }),
      ]),
    )
    const client = createLlmClient({
      protocol: 'anthropic',
      endpointUrl: 'https://api.anthropic.com/v1/messages',
      apiKey: 'sk-ant-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const message = await client.streamChat({ model: 'c', messages: [], maxTokens: 8 })
    expect(message.content).toBe('部分')
    expect(message.finish_reason).toBe('length')
  })

  it('maps refusal to finish_reason stop and guarantees at least an empty-string content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([event('message_delta', { delta: { stop_reason: 'refusal' } })]),
    )
    const client = createLlmClient({
      protocol: 'anthropic',
      endpointUrl: 'https://api.anthropic.com/v1/messages',
      apiKey: 'sk-ant-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const message = await client.streamChat({ model: 'c', messages: [], maxTokens: 8 })
    expect(message.finish_reason).toBe('stop')
    expect(message.content).toBe('')
  })
})

describe('SSE chunk splitting', () => {
  it('reassembles an anthropic event whose data: line is split across chunks mid-JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponseChunks([
        'event: content_block_delta\n',
        'data: {"type":"content_block_del',
        'ta","index":0,"delta":{"type":"text_del',
        'ta","text":"跨片"}}\n\n',
        'event: message_de',
        'lta\ndata: {"type":"message_delta","delta":{"stop_r',
        'eason":"end_turn"}}\n\n',
      ]),
    )
    const client = createLlmClient({
      protocol: 'anthropic',
      endpointUrl: 'https://api.anthropic.com/v1/messages',
      apiKey: 'sk-ant-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const message = await client.streamChat({ model: 'c', messages: [], maxTokens: 8 })
    expect(message.content).toBe('跨片')
    expect(message.finish_reason).toBe('stop')
  })
})
