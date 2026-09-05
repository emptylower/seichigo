import { describe, it, expect, vi, beforeEach } from 'vitest'
import type OpenAI from 'openai'

const { fakeCreate, resolveLlmForScope } = vi.hoisted(() => ({
  fakeCreate: vi.fn(),
  resolveLlmForScope: vi.fn(),
}))

vi.mock('openai', () => {
  class FakeOpenAI {
    chat = { completions: { create: fakeCreate } }
    constructor(_opts: unknown) {}
  }
  return { default: FakeOpenAI }
})

vi.mock('@/lib/llm/registry', () => ({
  resolveLlmForScope: (...args: unknown[]) => resolveLlmForScope(...(args as [])),
}))

import { createChatCompletion, describePlanAgentModel, withModelUsageInRunLog, type PlanAgentModelUsage } from '@/lib/planAgent/api'
import { isUserStoppedAbort } from '@/lib/planAgent/stop'
import { createLlmClient } from '@/lib/llm/client'
import { LlmHttpError } from '@/lib/llm/http'
import type { TripPlanRepo, TripPlanRunLogEntry } from '@/lib/tripPlan/repo'

type Delta = Record<string, unknown>

function chunk(delta: Delta, finishReason: string | null = null): unknown {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

function fakeStream(chunks: unknown[]): unknown {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  }
}

beforeEach(() => {
  fakeCreate.mockReset()
  resolveLlmForScope.mockReset()
  resolveLlmForScope.mockResolvedValue(null)
  process.env.PLAN_AGENT_API_KEY = 'test-key'
  process.env.PLAN_AGENT_STREAM_RETRY_BACKOFF_MS = '1'
  delete process.env.PLAN_AGENT_MODEL
  delete process.env.PLAN_AGENT_BASE_URL
})

describe('createChatCompletion (streaming)', () => {
  it('accumulates content deltas and forwards each delta via onDelta', async () => {
    fakeCreate.mockResolvedValue(
      fakeStream([
        chunk({ role: 'assistant', content: null }),
        chunk({ content: '你' }),
        chunk({ content: '好' }),
        chunk({}, 'stop'),
      ]),
    )
    const onDelta = vi.fn()
    const message = await createChatCompletion({ messages: [{ role: 'user', content: 'hi' }], tools: [] }, onDelta)

    expect(fakeCreate).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
      // A3：无 signal 时第二参显式 undefined（SDK options 位）
      undefined,
    )
    expect(message.role).toBe('assistant')
    expect(message.content).toBe('你好')
    expect(message.tool_calls).toBeUndefined()
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual([{ content: '你' }, { content: '好' }])
  })

  it('forwards reasoning_content deltas (non-standard DeepSeek field) and attaches the accumulated text', async () => {
    fakeCreate.mockResolvedValue(
      fakeStream([
        chunk({ role: 'assistant', reasoning_content: '' }),
        chunk({ reasoning_content: '思考' }),
        chunk({ reasoning_content: '中' }),
        chunk({ content: '答案' }),
        chunk({}, 'stop'),
      ]),
    )
    const onDelta = vi.fn()
    const message = await createChatCompletion({ messages: [], tools: [] }, onDelta)

    expect(onDelta.mock.calls.map((c) => c[0])).toEqual([{ reasoning: '思考' }, { reasoning: '中' }, { content: '答案' }])
    expect(message.content).toBe('答案')
    expect((message as OpenAI.Chat.Completions.ChatCompletionMessage & { reasoning_content?: string }).reasoning_content).toBe(
      '思考中',
    )
  })

  it('skips null reasoning_content on the final chunk', async () => {
    fakeCreate.mockResolvedValue(
      fakeStream([chunk({ content: 'ok' }), chunk({ content: '', reasoning_content: null }, 'stop')]),
    )
    const onDelta = vi.fn()
    const message = await createChatCompletion({ messages: [], tools: [] }, onDelta)

    expect(onDelta).not.toHaveBeenCalledWith(expect.objectContaining({ reasoning: expect.anything() }))
    expect(message.content).toBe('ok')
  })

  it('rebuilds tool_calls by index: id/name once, arguments concatenated as JSON fragments', async () => {
    fakeCreate.mockResolvedValue(
      fakeStream([
        chunk({ role: 'assistant' }),
        chunk({ reasoning_content: '先查点位' }),
        chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'list_points', arguments: '' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"bangumi' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'Id":115908}' } }] }),
        chunk({ tool_calls: [{ index: 1, id: 'call_2', type: 'function', function: { name: 'read_plan', arguments: '{}' } }] }),
        chunk({}, 'tool_calls'),
      ]),
    )
    const onDelta = vi.fn()
    const message = await createChatCompletion({ messages: [], tools: [] }, onDelta)

    expect(message.tool_calls).toHaveLength(2)
    const first = message.tool_calls?.[0]
    if (first?.type !== 'function') throw new Error('expected function tool call')
    expect(first.id).toBe('call_1')
    expect(first.function.name).toBe('list_points')
    expect(JSON.parse(first.function.arguments)).toEqual({ bangumiId: 115908 })
    const second = message.tool_calls?.[1]
    if (second?.type !== 'function') throw new Error('expected function tool call')
    expect(second.id).toBe('call_2')
    expect(second.function.name).toBe('read_plan')
    // tool_call 片段不作为 onDelta 转发（只转发 reasoning/content）
    expect(onDelta).toHaveBeenCalledTimes(1)
    expect(onDelta).toHaveBeenCalledWith({ reasoning: '先查点位' })
  })

  it('returns a message without tool_calls when the stream has none', async () => {
    fakeCreate.mockResolvedValue(fakeStream([chunk({ content: 'plain' }, 'stop')]))
    const message = await createChatCompletion({ messages: [], tools: [] })
    expect(message.content).toBe('plain')
    expect('tool_calls' in message).toBe(false)
  })

  it('throws when the upstream stream yields zero chunks (empty stream is not success)', async () => {
    fakeCreate.mockResolvedValue(fakeStream([]))
    await expect(createChatCompletion({ messages: [], tools: [] })).rejects.toThrow('模型未返回消息')
  })

  it('retries a mid-stream "Network connection lost." failure and returns the retried attempt result', async () => {
    // 第一次尝试：流出部分 chunk 后连接中断（生产案例的错误形态——裸 TypeError
    // 穿透 async iterator）；第二次尝试完整成功
    async function* brokenStream() {
      yield chunk({ content: ' partial' })
      throw new TypeError('Network connection lost.')
    }
    fakeCreate
      .mockResolvedValueOnce(brokenStream())
      .mockResolvedValueOnce(fakeStream([chunk({ content: '你好' }), chunk({}, 'stop')]))

    const onDelta = vi.fn()
    const message = await createChatCompletion({ messages: [], tools: [] }, onDelta)

    expect(fakeCreate).toHaveBeenCalledTimes(2)
    expect(message.content).toBe('你好')
    // 重试会从头重新流出：两次尝试的增量都透传（仅实时遥测，可接受的重复）
    expect(onDelta.mock.calls.map((c) => (c[0] as { content?: string }).content)).toEqual([' partial', '你好'])
  })

  it('retries connection-establishment failures (openai SDK wraps the cause) up to the attempt budget', async () => {
    const wrapped = new Error('Connection error.')
    ;(wrapped as Error & { cause?: unknown }).cause = new TypeError('Network connection lost.')
    fakeCreate.mockRejectedValueOnce(wrapped).mockResolvedValueOnce(fakeStream([chunk({ content: 'ok' }, 'stop')]))

    const message = await createChatCompletion({ messages: [], tools: [] })
    expect(fakeCreate).toHaveBeenCalledTimes(2)
    expect(message.content).toBe('ok')
  })

  it('retries empty streams (connection opened then closed) and fails with the domain message after exhausting attempts', async () => {
    fakeCreate.mockResolvedValue(fakeStream([]))
    await expect(createChatCompletion({ messages: [], tools: [] })).rejects.toThrow('模型未返回消息')
    expect(fakeCreate).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-network errors (auth/quota/domain) — surfaces immediately', async () => {
    fakeCreate.mockRejectedValueOnce(new Error('Incorrect API key provided'))
    await expect(createChatCompletion({ messages: [], tools: [] })).rejects.toThrow('Incorrect API key provided')
    expect(fakeCreate).toHaveBeenCalledTimes(1)
  })

  it('gives up after the attempt budget on persistent network failures', async () => {
    fakeCreate.mockRejectedValue(new TypeError('Network connection lost.'))
    await expect(createChatCompletion({ messages: [], tools: [] })).rejects.toThrow('Network connection lost.')
    expect(fakeCreate).toHaveBeenCalledTimes(3)
  })

  it('L3：env 回退路径的 describePlanAgentModel 用「默认模型」，不把内部路径名 env 露给用户', () => {
    const info = describePlanAgentModel(null)
    expect(info.providerName).toBe('默认模型')
    expect(typeof info.model).toBe('string')
  })

  it('M1：env 路径流结束但 signal 已 abort → 抛 user_stopped，不把半截流伪装成正常消息', async () => {
    const controller = new AbortController()
    // SDK/中转在 abort 后可能仍把流收尾成正常结束（或 mock 不理会 signal）——
    // for await 正常走完后必须检查 signal，否则停止会被当成一次成功调用
    fakeCreate.mockImplementation(async () => {
      controller.abort(new DOMException('user_stopped', 'AbortError'))
      return fakeStream([chunk({ content: '部分输出' }, 'stop')])
    })
    const err: unknown = await createChatCompletion(
      { messages: [], tools: [], signal: controller.signal },
    ).catch((e: unknown) => e)
    expect(isUserStoppedAbort(err)).toBe(true)
    expect(fakeCreate).toHaveBeenCalledTimes(1)
  })

  it('M1：可重试错误发生后 signal 已 abort → 立即抛 user_stopped，不再重试', async () => {
    const controller = new AbortController()
    fakeCreate.mockImplementation(async () => {
      controller.abort(new DOMException('user_stopped', 'AbortError'))
      throw new TypeError('Network connection lost.')
    })
    const err: unknown = await createChatCompletion(
      { messages: [], tools: [], signal: controller.signal },
    ).catch((e: unknown) => e)
    expect(isUserStoppedAbort(err)).toBe(true)
    expect(fakeCreate).toHaveBeenCalledTimes(1)
  })

  it('returns the empty assistant message when chunks arrived but carried no content — upstream did respond', async () => {
    fakeCreate.mockResolvedValue(
      fakeStream([chunk({ role: 'assistant', content: null }), chunk({}, 'stop')]),
    )
    const message = await createChatCompletion({ messages: [], tools: [] })
    expect(message.role).toBe('assistant')
    expect(message.content).toBeNull()
    expect(message.tool_calls).toBeUndefined()
  })

  it('carries the trailing finish_reason (length) on the rebuilt message so the loop can tell truncation from a clean stop', async () => {
    fakeCreate.mockResolvedValue(
      fakeStream([chunk({ reasoning_content: '思考' }), chunk({ content: '' }, 'length')]),
    )
    const message = await createChatCompletion({ messages: [], tools: [] })
    expect(message.content).toBeNull()
    expect(message.finish_reason).toBe('length')
  })

  it('keeps the last non-null finish_reason and omits it when the stream never sent one', async () => {
    fakeCreate.mockResolvedValue(
      fakeStream([chunk({ content: 'ok' }, 'stop'), chunk({}, null)]),
    )
    const withStop = await createChatCompletion({ messages: [], tools: [] })
    expect(withStop.finish_reason).toBe('stop')

    fakeCreate.mockResolvedValue(fakeStream([chunk({ content: 'ok' })]))
    const withoutFinish = await createChatCompletion({ messages: [], tools: [] })
    expect(withoutFinish.finish_reason).toBeUndefined()
  })
})

describe('createChatCompletion (custom provider takeover)', () => {
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

  function anthropicEvent(type: string, payload: Record<string, unknown> = {}): string {
    return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`
  }

  it('routes through the anthropic provider client when a takeover provider is resolved', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        anthropicEvent('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '好的' } }),
        anthropicEvent('message_delta', { delta: { stop_reason: 'end_turn' } }),
      ]),
    )
    resolveLlmForScope.mockResolvedValue({
      client: createLlmClient({
        protocol: 'anthropic',
        endpointUrl: 'https://api.anthropic.com/v1/messages',
        apiKey: 'sk-ant-admin-key',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
      model: 'claude-sonnet-4',
      maxOutputTokens: 8192,
      providerId: 'llm-1',
      providerName: 'Anthropic 中转',
      protocol: 'anthropic',
    })

    const message = await createChatCompletion(
      { messages: [{ role: 'user', content: '规划东京三日行程' }], tools: [] },
      undefined,
    )

    // 走 anthropic 统一客户端，而不是 OpenAI SDK
    expect(fakeCreate).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-admin-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')

    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('claude-sonnet-4')
    expect(body.max_tokens).toBe(8192)

    expect(message.role).toBe('assistant')
    expect(message.content).toBe('好的')
    expect(message.finish_reason).toBe('stop')
  })

  it('still uses the OpenAI SDK path (PLAN_AGENT_* env) when no provider takes over', async () => {
    resolveLlmForScope.mockResolvedValue(null)
    fakeCreate.mockResolvedValue(fakeStream([chunk({ content: 'ok' }, 'stop')]))

    const message = await createChatCompletion({ messages: [], tools: [] })

    expect(fakeCreate).toHaveBeenCalledTimes(1)
    expect(fakeCreate).toHaveBeenCalledWith(expect.objectContaining({ stream: true }), undefined)
    expect(message.content).toBe('ok')
  })
})

function openaiSseResponse(events: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function openaiSseChunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
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

type MessageWithProvider = { provider?: PlanAgentModelUsage }

describe('model usage reporting (per-call provider attachment)', () => {
  it('attaches each call provider usage onto its own returned message; concurrent calls do not cross', async () => {
    const gates: Array<(response: Response) => void> = []
    const fetchImpl = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => gates.push(resolve)),
    )
    const mkProvider = (id: string) => ({
      client: createLlmClient({
        protocol: 'openai' as const,
        endpointUrl: `https://${id}.example.com/v1/chat/completions`,
        apiKey: `sk-${id}`,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
      model: 'm',
      maxOutputTokens: 8,
      providerId: id,
      providerName: id,
      protocol: 'openai' as const,
    })
    let resolved = 0
    resolveLlmForScope.mockImplementation(async () =>
      resolved++ === 0 ? mkProvider('llm-a') : mkProvider('llm-b'),
    )

    const callA = createChatCompletion({ messages: [], tools: [] })
    const callB = createChatCompletion({ messages: [], tools: [] })
    // 两个并发请求都已拿到各自的供应商后按逆序放行：后完成的 B 不能覆盖 A 的返回
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    gates[1](openaiSseResponse([openaiSseChunk({ content: 'B' }, 'stop')]))
    gates[0](openaiSseResponse([openaiSseChunk({ content: 'A' }, 'stop')]))
    const [a, b] = await Promise.all([callA, callB])

    expect(a.content).toBe('A')
    expect(b.content).toBe('B')
    expect((a as MessageWithProvider).provider?.providerId).toBe('llm-a')
    expect((b as MessageWithProvider).provider?.providerId).toBe('llm-b')
    // provider 是不可枚举属性：不会跟着消息一起被序列化进历史
    expect(Object.keys(a)).not.toContain('provider')
    expect(JSON.stringify(a)).not.toContain('llm-a')
  })

  it('withModelUsageInRunLog reads usage from the most recent return value (null on env path)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(openaiSseResponse([openaiSseChunk({ content: 'ok' }, 'stop')]))
    resolveLlmForScope.mockResolvedValue({
      client: createLlmClient({
        protocol: 'openai',
        endpointUrl: 'https://relay.example.com/v1/chat/completions',
        apiKey: 'sk-relay',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
      model: 'gpt-mini',
      maxOutputTokens: 8,
      providerId: 'llm-1',
      providerName: '中转',
      protocol: 'openai',
    })
    await createChatCompletion({ messages: [], tools: [] })

    const appendRunLog = vi.fn().mockResolvedValue(undefined)
    const wrapped = withModelUsageInRunLog({ appendRunLog } as unknown as TripPlanRepo)
    const entry: TripPlanRunLogEntry = {
      planId: 'p1',
      runToken: null,
      turnIndex: 1,
      stage: 'works',
      modelUsage: null,
      durationMs: 5,
    }
    await wrapped.appendRunLog(entry)
    expect(appendRunLog).toHaveBeenCalledTimes(1)
    expect(appendRunLog).toHaveBeenCalledWith(
      expect.objectContaining({
        modelUsage: expect.objectContaining({ providerId: 'llm-1', model: 'gpt-mini' }),
      }),
    )

    // 环境变量路径：返回消息不带 provider → entry 原样透传
    resolveLlmForScope.mockResolvedValue(null)
    fakeCreate.mockResolvedValue(fakeStream([chunk({ content: 'env' }, 'stop')]))
    await createChatCompletion({ messages: [], tools: [] })
    await wrapped.appendRunLog(entry)
    expect(appendRunLog).toHaveBeenLastCalledWith(entry)
  })
})

describe('provider-path retry alignment (LlmHttpError 429/408/5xx)', () => {
  it('retries a 503 once and succeeds on the second attempt (exactly 2 fetches)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream overloaded', { status: 503 }))
      .mockResolvedValueOnce(openaiSseResponse([openaiSseChunk({ content: 'ok' }, 'stop')]))
    resolveLlmForScope.mockResolvedValue({
      client: createLlmClient({
        protocol: 'openai',
        endpointUrl: 'https://relay.example.com/v1/chat/completions',
        apiKey: 'sk-relay',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
      model: 'gpt-mini',
      maxOutputTokens: 8,
      providerId: 'llm-1',
      providerName: '中转',
      protocol: 'openai',
    })

    const message = await createChatCompletion({ messages: [], tools: [] })
    expect(message.content).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws immediately on 400 without retrying (single fetch)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }))
    resolveLlmForScope.mockResolvedValue({
      client: createLlmClient({
        protocol: 'openai',
        endpointUrl: 'https://relay.example.com/v1/chat/completions',
        apiKey: 'sk-relay',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
      model: 'gpt-mini',
      maxOutputTokens: 8,
      providerId: 'llm-1',
      providerName: '中转',
      protocol: 'openai',
    })

    const err: unknown = await createChatCompletion({ messages: [], tools: [] }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(LlmHttpError)
    expect((err as LlmHttpError).status).toBe(400)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
