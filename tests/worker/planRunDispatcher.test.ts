import { describe, it, expect, vi } from 'vitest'
import { readFile } from 'node:fs/promises'

/**
 * Phase 1-A（2026-09-11）：per-run DO 派发器——fetch 接纳协议（持久接纳 /
 * 幂等 duplicate / 非法拒收 / storage 失败回收）与 alarm 分类（永久故障丢弃 /
 * 200 drain 后删除 / 可重试错误 rethrow 保留 payload / 三次耗尽丢弃）。
 */

// workerd 内建模块：测试里用最小假基类替换（真基类只在部署运行时存在）
vi.mock('cloudflare:workers', () => {
  class DurableObject {
    constructor(
      public ctx: unknown,
      public env: unknown,
    ) {}
  }
  return { DurableObject }
})

import {
  PlanRunDispatcher,
  type PlanRunDispatcherCtx,
  type PlanRunDispatcherEnv,
  type PlanRunDispatcherStorage,
} from '@/worker/planRunDispatcher'

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

function makeStorage() {
  const map = new Map<string, unknown>()
  const setAlarm = vi.fn(async (_scheduledTime: number | Date) => undefined)
  const storage: PlanRunDispatcherStorage = {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined
    },
    async put(key: string, value: unknown) {
      map.set(key, value)
    },
    async delete(key: string) {
      return map.delete(key)
    },
    setAlarm,
  }
  return { map, setAlarm, storage }
}

type FetchImpl = ReturnType<typeof makeFetch>

function makeFetch(impl?: (input: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(
    impl ??
      (async (_input: string, _init?: RequestInit) => new Response('done\n', { status: 200 })),
  )
}

function makeDispatcher(options: { storage?: PlanRunDispatcherStorage; fetchImpl?: FetchImpl } = {}) {
  const fetchImpl = options.fetchImpl ?? makeFetch()
  const env: PlanRunDispatcherEnv = {
    WORKER_SELF_REFERENCE: { fetch: fetchImpl },
    PLAN_AGENT_INTERNAL_SECRET: 'secret-x',
  }
  const ctx: PlanRunDispatcherCtx = { storage: options.storage ?? makeStorage().storage }
  const dispatcher = new PlanRunDispatcher(ctx, env)
  return { dispatcher, ctx, env, fetchImpl }
}

function dispatchRequest(body: unknown) {
  return new Request('https://plan-run-dispatcher/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('PlanRunDispatcher fetch（接纳协议）', () => {
  it('首次合法投递 → 持久接纳（payload + state）、setAlarm(≈now)、{accepted:true}', async () => {
    const { map, setAlarm, storage } = makeStorage()
    const { dispatcher } = makeDispatcher({ storage })
    const msg = queueMessage()
    const before = Date.now()

    const res = await dispatcher.fetch(dispatchRequest(msg))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ accepted: true })
    expect(map.get('payload')).toEqual(msg)
    expect(map.get('state')).toEqual({ acceptedAt: expect.any(Number), attempts: 0 })
    expect(setAlarm).toHaveBeenCalledTimes(1)
    const scheduledAt = setAlarm.mock.calls[0]![0] as number
    expect(scheduledAt).toBeGreaterThanOrEqual(before)
    expect(scheduledAt).toBeLessThanOrEqual(Date.now())
  })

  it('重复投递 → {accepted:true, duplicate:true}，不覆盖、setAlarm 不再调', async () => {
    const { setAlarm, storage } = makeStorage()
    const { dispatcher } = makeDispatcher({ storage })
    const first = queueMessage()
    const second = queueMessage({ message: '后来的消息' })

    await dispatcher.fetch(dispatchRequest(first))
    const res = await dispatcher.fetch(dispatchRequest(second))

    expect(await res.json()).toEqual({ accepted: true, duplicate: true })
    expect(setAlarm).toHaveBeenCalledTimes(1)
    expect(await storage.get<Record<string, unknown>>('payload')).toEqual(first)
  })

  it('非法 body → 400 {accepted:false, reason:"invalid"}，payload 不落库', async () => {
    const { map, setAlarm, storage } = makeStorage()
    const { dispatcher } = makeDispatcher({ storage })

    const res = await dispatcher.fetch(dispatchRequest({ v: 2, garbage: true }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ accepted: false, reason: 'invalid' })
    expect(map.has('payload')).toBe(false)
    expect(setAlarm).not.toHaveBeenCalled()
  })

  it('setAlarm 抛错 → payload 被回收、{accepted:false, reason:"storage"}', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { map, storage } = makeStorage()
    storage.setAlarm = vi.fn(async () => {
      throw new Error('alarm write failed')
    })
    const { dispatcher } = makeDispatcher({ storage })

    try {
      const res = await dispatcher.fetch(dispatchRequest(queueMessage()))
      expect(await res.json()).toEqual({ accepted: false, reason: 'storage' })
      // 协议承诺：rejected ⇒ 未持久接纳
      expect(map.has('payload')).toBe(false)
    } finally {
      error.mockRestore()
    }
  })
})

describe('PlanRunDispatcher alarm（派发分类）', () => {
  function seeded(options: { fetchImpl?: FetchImpl } = {}) {
    const made = makeStorage()
    const { dispatcher } = makeDispatcher({ storage: made.storage, fetchImpl: options.fetchImpl })
    return { ...made, dispatcher }
  }

  it('payload 缺失 → 不 fetch 直接返回', async () => {
    const fetchImpl = makeFetch(async () => new Response('done\n'))
    const { dispatcher } = makeDispatcher({ fetchImpl })

    await dispatcher.alarm()

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('200 → 读响应体到底后删 payload（skipped/done 都算派发结束）', async () => {
    const chunks = ['heartbeat\n', 'done\n']
    const drained: string[] = []
    let index = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          drained.push(chunks[index])
          controller.enqueue(new TextEncoder().encode(chunks[index++]))
        } else {
          controller.close()
        }
      },
    })
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }))
    const { map, dispatcher } = seeded({ fetchImpl })

    await dispatcher.fetch(dispatchRequest(queueMessage()))
    await dispatcher.alarm()

    expect(drained).toEqual(chunks)
    expect(map.has('payload')).toBe(false)
  })

  it('401 → 永久故障：删 payload 不重试（不抛）', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = makeFetch(async () => new Response('unauthorized', { status: 401 }))
    const { map, dispatcher } = seeded({ fetchImpl })

    try {
      await dispatcher.fetch(dispatchRequest(queueMessage()))
      await dispatcher.alarm()

      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(map.has('payload')).toBe(false)
    } finally {
      error.mockRestore()
    }
  })

  it('fetch 抛错且 attempts<3 → rethrow 且 payload 仍在（等平台重试 alarm）', async () => {
    const fetchImpl = makeFetch(async () => {
      throw new Error('subrequest failed')
    })
    const { map, dispatcher } = seeded({ fetchImpl })
    const msg = queueMessage()

    await dispatcher.fetch(dispatchRequest(msg))
    await expect(dispatcher.alarm()).rejects.toThrow('subrequest failed')

    expect(map.get('payload')).toEqual(msg)
    expect((map.get('state') as { attempts: number }).attempts).toBe(1)
  })

  it('5xx → 同可重试错误处理（attempts<3 rethrow，payload 保留）', async () => {
    const fetchImpl = makeFetch(async () => new Response('boom', { status: 502 }))
    const { map, dispatcher } = seeded({ fetchImpl })

    await dispatcher.fetch(dispatchRequest(queueMessage()))
    await expect(dispatcher.alarm()).rejects.toThrow('internal run responded 502')

    expect(map.has('payload')).toBe(true)
  })

  it('attempts≥3 → 删 payload 不抛（耗尽丢弃）', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = makeFetch(async () => {
      throw new Error('subrequest failed')
    })
    const { map, dispatcher } = seeded({ fetchImpl })

    try {
      await dispatcher.fetch(dispatchRequest(queueMessage()))
      await expect(dispatcher.alarm()).rejects.toThrow('subrequest failed')
      await expect(dispatcher.alarm()).rejects.toThrow('subrequest failed')
      await dispatcher.alarm() // 第三次：attempts=3 → 丢弃，不再抛

      expect(fetchImpl).toHaveBeenCalledTimes(3)
      expect(map.has('payload')).toBe(false)
      expect((map.get('state') as { attempts: number }).attempts).toBe(3)
    } finally {
      error.mockRestore()
    }
  })

  it('内部路由请求头：transport=do、secret、consumer-at/seq（epoch ms / 整数）', async () => {
    const fetchImpl = makeFetch()
    const { dispatcher } = seeded({ fetchImpl })
    const msg = queueMessage()

    await dispatcher.fetch(dispatchRequest(msg))
    await dispatcher.alarm()

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://seichigo.com/api/internal/plan-agent/run')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
    expect(headers['x-plan-agent-secret']).toBe('secret-x')
    expect(headers['x-plan-agent-transport']).toBe('do')
    expect(Number.isInteger(Number(headers['x-plan-agent-consumer-at']))).toBe(true)
    expect(Number.isInteger(Number(headers['x-plan-agent-consumer-seq']))).toBe(true)
    expect(JSON.parse(init.body as string)).toEqual(msg)
  })
})

describe('worker 入口打包边界', () => {
  it('源文件不 import 任何 @/ 应用代码（仅 queueMessage / cloudflare:workers / worker 内共用件）', async () => {
    const source = await readFile(new URL('../../worker/planRunDispatcher.ts', import.meta.url), 'utf8')
    const imports = source.match(/^import\b.*$/gm) ?? []
    expect(imports.length).toBeGreaterThan(0)
    for (const line of imports) {
      expect(line.includes(" from '@/")).toBe(false)
      expect(line.includes(' from "@/')).toBe(false)
    }
    expect(imports.some((line) => line.includes("from '../lib/planAgent/queueMessage'"))).toBe(true)
    expect(imports.some((line) => line.includes("from 'cloudflare:workers'"))).toBe(true)
  })
})
