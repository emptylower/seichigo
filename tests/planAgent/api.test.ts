import { describe, it, expect, vi, beforeEach } from 'vitest'
import type OpenAI from 'openai'

const { fakeCreate } = vi.hoisted(() => ({ fakeCreate: vi.fn() }))

vi.mock('openai', () => {
  class FakeOpenAI {
    chat = { completions: { create: fakeCreate } }
    constructor(_opts: unknown) {}
  }
  return { default: FakeOpenAI }
})

import { createChatCompletion } from '@/lib/planAgent/api'

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

  it('returns the empty assistant message when chunks arrived but carried no content — upstream did respond', async () => {
    fakeCreate.mockResolvedValue(
      fakeStream([chunk({ role: 'assistant', content: null }), chunk({}, 'stop')]),
    )
    const message = await createChatCompletion({ messages: [], tools: [] })
    expect(message.role).toBe('assistant')
    expect(message.content).toBeNull()
    expect(message.tool_calls).toBeUndefined()
  })
})
