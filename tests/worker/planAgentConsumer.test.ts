import { describe, it, expect, vi } from 'vitest'
import { consumePlanAgentBatch, type PlanAgentWorkerEnv } from '@/worker/planAgentConsumer'
import type { PlanAgentMessageBatch } from '@/worker/planAgentConsumer'

/**
 * Task A5（§0.1）：队列消费者——经自引用服务绑定回调内部路由、逐条校验
 * 消息、读响应体到底、任何异常仍 ack（不重试）。
 */

function queueMessage(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    planId: 'plan-1',
    runToken: 'run-1',
    locale: 'zh',
    message: '帮我排一天',
    resume: false,
    enqueuedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeBatch(bodies: unknown[]): { batch: PlanAgentMessageBatch; acks: Array<ReturnType<typeof vi.fn>> } {
  const acks: Array<ReturnType<typeof vi.fn>> = []
  const messages = bodies.map((body) => {
    const ack = vi.fn()
    acks.push(ack)
    return { body, ack, retry: vi.fn() }
  })
  return { batch: { messages }, acks }
}

function makeEnv(fetchImpl: ReturnType<typeof makeFetch>): PlanAgentWorkerEnv {
  return {
    WORKER_SELF_REFERENCE: { fetch: fetchImpl },
    PLAN_AGENT_INTERNAL_SECRET: 'secret-x',
    PLAN_AGENT_QUEUE: { send: vi.fn(async () => undefined) },
  }
}

function makeFetch(impl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  return vi.fn(
    impl ??
      (async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response('heartbeat\ndone\n', { status: 200 })),
  )
}

describe('consumePlanAgentBatch（Task A5）', () => {
  it('合法消息 → fetch 内部路由（URL/密钥/body 完整）并读响应体到底，每条 ack 一次', async () => {
    const fetchImpl = makeFetch()
    const env = makeEnv(fetchImpl)
    const first = queueMessage()
    const second = queueMessage({ planId: 'plan-2', message: null, resume: true })
    const { batch, acks } = makeBatch([first, second])

    await consumePlanAgentBatch(batch, env)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://seichigo.com/api/internal/plan-agent/run')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect((init.headers as Record<string, string>)['x-plan-agent-secret']).toBe('secret-x')
    expect(JSON.parse(init.body as string)).toEqual(first)
    // 第二条消息的 body 原样透传
    const [, init2] = fetchImpl.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(init2.body as string)).toEqual(second)
    for (const ack of acks) expect(ack).toHaveBeenCalledTimes(1)
  })

  it('fetch 抛错 → console.error 后仍 ack，不 retry', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = makeFetch(async () => {
      throw new Error('subrequest failed')
    })
    const env = makeEnv(fetchImpl)
    const { batch, acks } = makeBatch([queueMessage()])

    await consumePlanAgentBatch(batch, env)
    expect(acks[0]).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('非法消息 → 不 fetch 但 ack（丢弃）', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = makeFetch(async () => new Response('done\n'))
    const env = makeEnv(fetchImpl)
    const { batch, acks } = makeBatch([{ v: 2, garbage: true }, queueMessage({ locale: 'fr' })])

    await consumePlanAgentBatch(batch, env)
    expect(fetchImpl).not.toHaveBeenCalled()
    for (const ack of acks) expect(ack).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })
})
