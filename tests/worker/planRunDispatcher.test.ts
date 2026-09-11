import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  registerPlanRunLocalHandler,
  type OpenNextFetchHandler,
  type PlanRunDispatcherCtx,
  type PlanRunDispatcherEnv,
  type PlanRunDispatcherStorage,
} from '@/worker/planRunDispatcher'

/** 本测试文件模块求值时刻：被测模块的 MODULE_EVAL_AT（import 期求值）必然 ≤ 它 */
const TEST_LOADED_AT = Date.now()

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

function makeDispatcher(
  options: {
    storage?: PlanRunDispatcherStorage
    fetchImpl?: FetchImpl
    env?: Record<string, unknown>
  } = {},
) {
  const fetchImpl = options.fetchImpl ?? makeFetch()
  const env: PlanRunDispatcherEnv = {
    WORKER_SELF_REFERENCE: { fetch: fetchImpl },
    PLAN_AGENT_INTERNAL_SECRET: 'secret-x',
    ...(options.env ?? {}),
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
  it('首次合法投递 → 持久接纳（payload + state）、setAlarm(≈now)、{accepted:true}；state 带 doEnteredAt 与 setAlarm 后的 acceptedDoneAt', async () => {
    const { map, setAlarm, storage } = makeStorage()
    const { dispatcher } = makeDispatcher({ storage })
    const msg = queueMessage()
    const before = Date.now()

    const res = await dispatcher.fetch(dispatchRequest(msg))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ accepted: true })
    expect(map.get('payload')).toEqual(msg)
    const state = map.get('state') as { acceptedAt: number; attempts: number; doEnteredAt: number; acceptedDoneAt: number }
    expect(state).toEqual({
      acceptedAt: expect.any(Number),
      attempts: 0,
      doEnteredAt: expect.any(Number),
      acceptedDoneAt: expect.any(Number),
    })
    // P2-B 补充：doEnteredAt（fetch 入口）≤ acceptedAt（写盘）≤ acceptedDoneAt（setAlarm 成功后）
    expect(state.doEnteredAt).toBeLessThanOrEqual(state.acceptedAt)
    expect(state.acceptedAt).toBeLessThanOrEqual(state.acceptedDoneAt)
    expect(state.acceptedDoneAt).toBeGreaterThanOrEqual(before)
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

  it('内部路由请求头：transport=do、secret、consumer-at/seq（epoch ms / 整数）、P2-B 派发段八个埋点头', async () => {
    const fetchImpl = makeFetch()
    const made = makeStorage()
    const { dispatcher } = makeDispatcher({ storage: made.storage, fetchImpl })
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

    // P2-B 补充：入口/接纳完成/alarm/前奏/身份，数值关系正确
    const state = made.map.get('state') as {
      acceptedAt: number
      attempts: number
      doEnteredAt: number
      acceptedDoneAt: number
    }
    expect(headers['x-plan-agent-do-entered-at']).toBe(String(state.doEnteredAt))
    // do-accepted-at 承载 setAlarm 之后的接纳完成戳（不是 acceptedAt）
    expect(headers['x-plan-agent-do-accepted-at']).toBe(String(state.acceptedDoneAt))
    const alarmAt = Number(headers['x-plan-agent-alarm-at'])
    expect(Number.isFinite(alarmAt)).toBe(true)
    expect(alarmAt).toBeGreaterThanOrEqual(state.acceptedDoneAt)
    // alarm 前奏 ≥ 0（alarm 入口 → handler 调用前，含三次存储 IO）
    const preludeMs = Number(headers['x-plan-agent-alarm-prelude-ms'])
    expect(Number.isFinite(preludeMs)).toBe(true)
    expect(preludeMs).toBeGreaterThanOrEqual(0)
    const isolateAgeMs = Number(headers['x-plan-agent-isolate-age-ms'])
    expect(Number.isFinite(isolateAgeMs)).toBe(true)
    // isolate 年龄反推的模块求值时刻必然不晚于测试文件求值时刻（import 先于用例）
    expect(alarmAt - isolateAgeMs).toBeLessThanOrEqual(TEST_LOADED_AT)
    expect(alarmAt - isolateAgeMs).toBeGreaterThan(0)
    expect(headers['x-plan-agent-alarm-attempt']).toBe('1')
    // 模块实例 id 与 DO 对象实例 id 分开（workerd 模块求值一次、DO 对象每次构造）
    expect(headers['x-plan-agent-module-id']).toMatch(/^[0-9a-f]{8}$/)
    expect(headers['x-plan-agent-do-instance-id']).toMatch(/^[0-9a-f]{8}$/)
    expect(headers['x-plan-agent-do-instance-id']).toBe(dispatcher.instanceId)
    expect(headers['x-plan-agent-module-id']).not.toBe(headers['x-plan-agent-do-instance-id'])
  })
})

describe('PlanRunDispatcher alarm 本地路径（P1_1：PLAN_AGENT_DO_LOCAL=1）', () => {
  type LocalCall = { request: Request; env: unknown; ctx: unknown }

  function makeLocalHandler(impl?: (call: LocalCall) => Promise<Response>) {
    const calls: LocalCall[] = []
    const handler: OpenNextFetchHandler = {
      async fetch(request, env, ctx) {
        calls.push({ request, env, ctx })
        return impl ? impl({ request, env, ctx }) : new Response('done\n', { status: 200 })
      },
    }
    return { handler, calls }
  }

  function localSeeded(options: { fetchImpl?: FetchImpl } = {}) {
    const made = makeStorage()
    const { dispatcher, env } = makeDispatcher({
      storage: made.storage,
      fetchImpl: options.fetchImpl,
      env: { PLAN_AGENT_DO_LOCAL: '1' },
    })
    return { ...made, dispatcher, env }
  }

  async function flushMicrotasks(rounds = 20): Promise<void> {
    for (let i = 0; i < rounds; i++) await Promise.resolve()
  }

  // localHandler 是模块级单例：每个用例先复位（测试专用，生产只有 entry 注册
  // 一个入口），需要 handler 的用例自行注册
  beforeEach(() => {
    registerPlanRunLocalHandler(null as unknown as OpenNextFetchHandler)
  })

  it('注册 + 开关 1 → alarm 直调 handler 而非 WORKER_SELF_REFERENCE；env 为同一对象引用；头含 x-plan-agent-local 与全部既有头', async () => {
    const { handler, calls } = makeLocalHandler()
    registerPlanRunLocalHandler(handler)
    const fetchImpl = makeFetch()
    const made = makeStorage()
    const { dispatcher, env } = makeDispatcher({ storage: made.storage, fetchImpl, env: { PLAN_AGENT_DO_LOCAL: '1' } })
    const msg = queueMessage()

    await dispatcher.fetch(dispatchRequest(msg))
    await dispatcher.alarm()

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(calls.length).toBe(1)
    const call = calls[0]!
    expect(call.request.url).toBe('https://seichigo.com/api/internal/plan-agent/run')
    expect(call.request.method).toBe('POST')
    expect(call.request.headers.get('content-type')).toBe('application/json')
    expect(call.request.headers.get('x-plan-agent-secret')).toBe('secret-x')
    expect(call.request.headers.get('x-plan-agent-transport')).toBe('do')
    expect(call.request.headers.get('x-plan-agent-local')).toBe('1')
    expect(Number.isInteger(Number(call.request.headers.get('x-plan-agent-consumer-at')))).toBe(true)
    expect(Number.isInteger(Number(call.request.headers.get('x-plan-agent-consumer-seq')))).toBe(true)
    // P2-B 补充：本地直调路径同样带 DO 派发段八个埋点头
    const state = made.map.get('state') as {
      acceptedAt: number
      attempts: number
      doEnteredAt: number
      acceptedDoneAt: number
    }
    expect(call.request.headers.get('x-plan-agent-do-entered-at')).toBe(String(state.doEnteredAt))
    expect(call.request.headers.get('x-plan-agent-do-accepted-at')).toBe(String(state.acceptedDoneAt))
    const alarmAt = Number(call.request.headers.get('x-plan-agent-alarm-at'))
    expect(Number.isFinite(alarmAt)).toBe(true)
    expect(alarmAt).toBeGreaterThanOrEqual(state.acceptedDoneAt)
    expect(Number(call.request.headers.get('x-plan-agent-alarm-prelude-ms'))).toBeGreaterThanOrEqual(0)
    const isolateAgeMs = Number(call.request.headers.get('x-plan-agent-isolate-age-ms'))
    expect(Number.isFinite(isolateAgeMs)).toBe(true)
    expect(alarmAt - isolateAgeMs).toBeLessThanOrEqual(TEST_LOADED_AT)
    expect(call.request.headers.get('x-plan-agent-alarm-attempt')).toBe('1')
    expect(call.request.headers.get('x-plan-agent-module-id')).toMatch(/^[0-9a-f]{8}$/)
    expect(call.request.headers.get('x-plan-agent-do-instance-id')).toBe(dispatcher.instanceId)
    // env 传原始完整对象（同一引用），不重建子集
    expect(call.env).toBe(env)
    expect(await new Response(call.request.body).text()).toBe(JSON.stringify(msg))
  })

  it('未注册 + 开关 1 → console.error 一次并回落自引用路径（payload 语义不变）', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = makeFetch()
    const { map, dispatcher } = localSeeded({ fetchImpl })
    try {
      await dispatcher.fetch(dispatchRequest(queueMessage()))
      await dispatcher.alarm()

      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledTimes(1)
      expect(error.mock.calls[0]![0]).toBe(
        '[worker/planRunDispatcher] PLAN_AGENT_DO_LOCAL=1 but no handler registered, falling back to self-reference',
      )
      expect(map.has('payload')).toBe(false)
    } finally {
      error.mockRestore()
    }
  })

  it('开关 0 → 自引用路径，注册过的 handler 不被调', async () => {
    const { handler, calls } = makeLocalHandler()
    registerPlanRunLocalHandler(handler)
    const fetchImpl = makeFetch()
    const { dispatcher } = makeDispatcher({ fetchImpl, env: { PLAN_AGENT_DO_LOCAL: '0' } })

    await dispatcher.fetch(dispatchRequest(queueMessage()))
    await dispatcher.alarm()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(calls.length).toBe(0)
  })

  it('ctx 适配器：waitUntil(p1)、p1 settle 后再 waitUntil(p2) → 两者都 settle 后才删 payload', async () => {
    const events: string[] = []
    let releaseP2: (() => void) | undefined
    const p2 = new Promise<void>((resolve) => {
      releaseP2 = () => {
        events.push('p2-released')
        resolve()
      }
    })
    const { handler } = makeLocalHandler(async ({ ctx }) => {
      const c = ctx as { waitUntil(p: Promise<unknown>): void }
      c.waitUntil(Promise.resolve())
      void Promise.resolve().then(() => {
        c.waitUntil(p2)
      })
      return new Response('done\n', { status: 200 })
    })
    registerPlanRunLocalHandler(handler)
    const made = makeStorage()
    const rawDelete = made.storage.delete
    made.storage.delete = async (key: string) => {
      const result = await rawDelete(key)
      events.push(`deleted:${key}`)
      return result
    }
    const { dispatcher } = makeDispatcher({ storage: made.storage, env: { PLAN_AGENT_DO_LOCAL: '1' } })

    await dispatcher.fetch(dispatchRequest(queueMessage()))
    const alarmP = dispatcher.alarm()
    await flushMicrotasks()

    // p2 挂起：收束未完成，删 payload 未发生
    expect(events).toEqual([])
    expect(made.map.has('payload')).toBe(true)

    releaseP2!()
    await alarmP

    expect(events).toEqual(['p2-released', 'deleted:payload'])
    expect(made.map.has('payload')).toBe(false)
  })

  it('永不 resolve 的后台任务 + 假定时器 → 到收束上限后 warn 未完成数并仍删 payload（不抛）', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { handler } = makeLocalHandler(async ({ ctx }) => {
        const c = ctx as { waitUntil(p: Promise<unknown>): void }
        c.waitUntil(new Promise<void>(() => {}))
        return new Response('done\n', { status: 200 })
      })
      registerPlanRunLocalHandler(handler)
      const { map, dispatcher } = localSeeded()

      await dispatcher.fetch(dispatchRequest(queueMessage()))
      const alarmP = dispatcher.alarm()
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(240_000)
      await alarmP

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]![0]).toBe(
        '[worker/planRunDispatcher] local background tasks not settled before deadline',
      )
      expect(warn.mock.calls[0]![1]).toEqual({ pending: 1 })
      expect(map.has('payload')).toBe(false)
    } finally {
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  it.each([400, 401, 503])('本地 handler 返回 %s → 永久故障：删 payload 不重试（不抛）', async (status) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { handler, calls } = makeLocalHandler(async () => new Response('nope', { status }))
    registerPlanRunLocalHandler(handler)
    const { map, dispatcher } = localSeeded()
    try {
      await dispatcher.fetch(dispatchRequest(queueMessage()))
      await dispatcher.alarm()

      expect(calls.length).toBe(1)
      expect(map.has('payload')).toBe(false)
    } finally {
      error.mockRestore()
    }
  })

  it('本地 handler 返回 5xx → attempts<3 rethrow 且 payload 保留', async () => {
    const { handler } = makeLocalHandler(async () => new Response('boom', { status: 502 }))
    registerPlanRunLocalHandler(handler)
    const { map, dispatcher } = localSeeded()
    const msg = queueMessage()

    await dispatcher.fetch(dispatchRequest(msg))
    await expect(dispatcher.alarm()).rejects.toThrow('internal run responded 502')

    expect(map.get('payload')).toEqual(msg)
    expect((map.get('state') as { attempts: number }).attempts).toBe(1)
  })

  it('本地 handler 抛错 → attempts<3 rethrow 且 payload 保留', async () => {
    const { handler } = makeLocalHandler(async () => {
      throw new Error('local handler blew up')
    })
    registerPlanRunLocalHandler(handler)
    const { map, dispatcher } = localSeeded()

    await dispatcher.fetch(dispatchRequest(queueMessage()))
    await expect(dispatcher.alarm()).rejects.toThrow('local handler blew up')

    expect(map.has('payload')).toBe(true)
  })
})

describe('worker 入口打包边界', () => {
  it('源文件不 import 任何 @/ 应用代码与 .open-next（仅 queueMessage / cloudflare:workers / worker 内共用件）', async () => {
    const source = await readFile(new URL('../../worker/planRunDispatcher.ts', import.meta.url), 'utf8')
    const imports = source.match(/^import\b.*$/gm) ?? []
    expect(imports.length).toBeGreaterThan(0)
    for (const line of imports) {
      expect(line.includes(" from '@/")).toBe(false)
      expect(line.includes(' from="@/')).toBe(false)
      expect(line.includes('.open-next')).toBe(false)
    }
    expect(imports.some((line) => line.includes("from '../lib/planAgent/queueMessage'"))).toBe(true)
    expect(imports.some((line) => line.includes("from 'cloudflare:workers'"))).toBe(true)
  })

  it('entry.ts 在模块顶层注册 local handler（P1_1 注入点），且不 import @/ 应用代码', async () => {
    const source = await readFile(new URL('../../worker/entry.ts', import.meta.url), 'utf8')
    expect(source.includes('registerPlanRunLocalHandler(handler)')).toBe(true)
    for (const line of source.match(/^import\b.*$/gm) ?? []) {
      expect(line.includes(" from '@/")).toBe(false)
      expect(line.includes(' from="@/')).toBe(false)
    }
  })
})
