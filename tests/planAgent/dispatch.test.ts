import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dispatchRun, shouldDispatchViaDo } from '@/lib/planAgent/dispatch'
import type { CfBindingsEnv } from '@/lib/anitabi/cf/bindings'
import type { PlanAgentQueueMessage } from '@/lib/planAgent/queueMessage'

/**
 * Phase 1-A（联合方案 §3.3）：dispatchRun 三分类——accepted / rejected（落
 * 队列）/ unknown（绝不改投队列）；白名单空 = 没有人走 DO；PLAN_AGENT_DISPATCH
 * 只决定 DO，与队列开关无关。
 */

function queueMessage(): PlanAgentQueueMessage {
  return {
    v: 1,
    planId: 'plan-1',
    runToken: 'run-1',
    locale: 'zh',
    message: 'hi',
    resume: false,
    enqueuedAt: new Date('2026-09-11T00:00:00Z').toISOString(),
  }
}

type DoEnv = {
  env: CfBindingsEnv
  doFetch: ReturnType<typeof vi.fn>
  queueSend: ReturnType<typeof vi.fn>
}

function makeEnv(doFetch?: (input: string, init?: RequestInit) => Promise<Response>): DoEnv {
  const doFetchMock = vi.fn(doFetch ?? (async () => Response.json({ accepted: true })))
  const queueSend = vi.fn(async () => undefined)
  const env: CfBindingsEnv = {
    PLAN_RUN_DISPATCHER: {
      idFromName: (name: string) => ({ id: name }),
      get: (_id: unknown) => ({ fetch: doFetchMock }),
    },
    PLAN_AGENT_QUEUE: { send: queueSend },
  }
  return { env, doFetch: doFetchMock, queueSend }
}

beforeEach(() => {
  vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '1')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('shouldDispatchViaDo（白名单）', () => {
  it('PLAN_AGENT_DISPATCH=do + 白名单含 userId + 绑定存在 → true', () => {
    vi.stubEnv('PLAN_AGENT_DISPATCH', 'do')
    vi.stubEnv('PLAN_AGENT_DO_CANARY_USER_IDS', 'u1,u2')
    expect(shouldDispatchViaDo(makeEnv().env, 'u2')).toBe(true)
  })

  it('白名单为空 → false（没有人走 DO）', () => {
    vi.stubEnv('PLAN_AGENT_DISPATCH', 'do')
    vi.stubEnv('PLAN_AGENT_DO_CANARY_USER_IDS', '')
    expect(shouldDispatchViaDo(makeEnv().env, 'u1')).toBe(false)
  })

  it('PLAN_AGENT_DISPATCH=queue → false（与队列开关无关）', () => {
    vi.stubEnv('PLAN_AGENT_DISPATCH', 'queue')
    vi.stubEnv('PLAN_AGENT_DO_CANARY_USER_IDS', 'u1')
    expect(shouldDispatchViaDo(makeEnv().env, 'u1')).toBe(false)
  })

  it('无 DO 绑定（next dev / vitest）→ false', () => {
    vi.stubEnv('PLAN_AGENT_DISPATCH', 'do')
    vi.stubEnv('PLAN_AGENT_DO_CANARY_USER_IDS', 'u1')
    expect(shouldDispatchViaDo(undefined, 'u1')).toBe(false)
    expect(shouldDispatchViaDo({}, 'u1')).toBe(false)
  })

  it('白名单按逗号分隔并容忍空白', () => {
    vi.stubEnv('PLAN_AGENT_DISPATCH', 'do')
    vi.stubEnv('PLAN_AGENT_DO_CANARY_USER_IDS', ' u1 , u2 ')
    expect(shouldDispatchViaDo(makeEnv().env, 'u2')).toBe(true)
    expect(shouldDispatchViaDo(makeEnv().env, 'u3')).toBe(false)
  })
})

describe('dispatchRun 三分类', () => {
  function doCanary() {
    vi.stubEnv('PLAN_AGENT_DISPATCH', 'do')
    vi.stubEnv('PLAN_AGENT_DO_CANARY_USER_IDS', 'u1')
  }

  it('DO accepted:true → {do, accepted}，队列不被调', async () => {
    doCanary()
    const { env, doFetch, queueSend } = makeEnv()

    const outcome = await dispatchRun({ env, message: queueMessage(), userId: 'u1' })

    expect(outcome).toEqual({ transport: 'do', state: 'accepted' })
    expect(doFetch).toHaveBeenCalledTimes(1)
    expect(queueSend).not.toHaveBeenCalled()
  })

  it('DO accepted:true, duplicate:true → 仍算 accepted', async () => {
    doCanary()
    const { env, queueSend } = makeEnv(async () => Response.json({ accepted: true, duplicate: true }))

    expect(await dispatchRun({ env, message: queueMessage(), userId: 'u1' })).toEqual({
      transport: 'do',
      state: 'accepted',
    })
    expect(queueSend).not.toHaveBeenCalled()
  })

  it('DO accepted:false + reason → rejected → 继续投队列（消息带 transport:"queue"）', async () => {
    doCanary()
    const { env, doFetch, queueSend } = makeEnv(async () =>
      Response.json({ accepted: false, reason: 'invalid' }, { status: 400 }),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const message = queueMessage()

    try {
      const outcome = await dispatchRun({ env, message, userId: 'u1' })
      expect(outcome).toEqual({ transport: 'queue', state: 'accepted' })
      expect(doFetch).toHaveBeenCalledTimes(1)
      expect(queueSend).toHaveBeenCalledWith({ ...message, transport: 'queue' })
    } finally {
      warn.mockRestore()
    }
  })

  it('DO 响应非 JSON → unknown，队列不被调', async () => {
    doCanary()
    const { env, queueSend } = makeEnv(async () => new Response('<html>bad gateway</html>', { status: 502 }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(await dispatchRun({ env, message: queueMessage(), userId: 'u1' })).toEqual({
        transport: 'do',
        state: 'unknown',
      })
      expect(queueSend).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('DO fetch 抛错 → unknown，队列不被调', async () => {
    doCanary()
    const { env, queueSend } = makeEnv(async () => {
      throw new Error('binding unavailable')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(await dispatchRun({ env, message: queueMessage(), userId: 'u1' })).toEqual({
        transport: 'do',
        state: 'unknown',
      })
      expect(queueSend).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('DO 超时（stub 永不 resolve）→ unknown，队列不被调', async () => {
    doCanary()
    vi.useFakeTimers()
    const { env, queueSend } = makeEnv(() => new Promise<Response>(() => {}))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const pending = dispatchRun({ env, message: queueMessage(), userId: 'u1' })
      await vi.advanceTimersByTimeAsync(5_000)
      expect(await pending).toEqual({ transport: 'do', state: 'unknown' })
      expect(queueSend).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('白名单空 + PLAN_AGENT_DISPATCH=do → 不调 DO，直接队列', async () => {
    vi.stubEnv('PLAN_AGENT_DISPATCH', 'do')
    vi.stubEnv('PLAN_AGENT_DO_CANARY_USER_IDS', '')
    const { env, doFetch, queueSend } = makeEnv()

    const outcome = await dispatchRun({ env, message: queueMessage(), userId: 'u1' })

    expect(outcome).toEqual({ transport: 'queue', state: 'accepted' })
    expect(doFetch).not.toHaveBeenCalled()
    expect(queueSend).toHaveBeenCalledTimes(1)
  })

  it('PLAN_AGENT_DISPATCH=queue → 不调 DO（即便白名单命中）', async () => {
    vi.stubEnv('PLAN_AGENT_DISPATCH', 'queue')
    vi.stubEnv('PLAN_AGENT_DO_CANARY_USER_IDS', 'u1')
    const { env, doFetch } = makeEnv()

    expect(await dispatchRun({ env, message: queueMessage(), userId: 'u1' })).toEqual({
      transport: 'queue',
      state: 'accepted',
    })
    expect(doFetch).not.toHaveBeenCalled()
  })

  it('PLAN_AGENT_QUEUE_ENABLED=0 不影响 DO 选择（开关各管各的）', async () => {
    vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '0')
    doCanary()
    const { env, queueSend } = makeEnv()

    expect(await dispatchRun({ env, message: queueMessage(), userId: 'u1' })).toEqual({
      transport: 'do',
      state: 'accepted',
    })
    expect(queueSend).not.toHaveBeenCalled()
  })

  it('队列 send 抛错 → none（内联回退语义不变）', async () => {
    const { env, queueSend } = makeEnv()
    queueSend.mockImplementation(async () => {
      throw new Error('queue unavailable')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(await dispatchRun({ env, message: queueMessage(), userId: 'u1' })).toEqual({ transport: 'none' })
    } finally {
      warn.mockRestore()
    }
  })

  it('队列开关未开且无 DO 候选 → none', async () => {
    vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '0')
    const { env } = makeEnv()

    expect(await dispatchRun({ env, message: queueMessage(), userId: 'u1' })).toEqual({ transport: 'none' })
  })
})
