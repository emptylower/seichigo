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
})
