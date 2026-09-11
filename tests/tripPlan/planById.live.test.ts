import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { createPlanByIdHandlers, readPlanRunState } from '@/lib/tripPlan/handlers/planById'
import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'

/** 第七轮 A1/A2：GET /api/me/plans/:id 的运行实况（live）与 chatRevision */

function makeDeps(): TripPlanHandlerDeps {
  return {
    repo: new MemoryTripPlanRepo(),
    getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
  }
}

async function beginRun(repo: TripPlanRepo, planId: string) {
  const begin = await repo.beginAgentRun({
    planId,
    userId: 'u1',
    content: { role: 'user', content: '帮我排一天' },
    since: new Date(0),
    limit: 10,
    busyTtlMs: 10 * 60 * 1000,
  })
  if (begin.status !== 'ok') throw new Error('unreachable')
  return begin
}

describe('planById GET live / chatRevision', () => {
  it('busy 且实况行 runToken 与当前持有者一致时返回 live；run 结束后 live 缺省', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    const handlers = createPlanByIdHandlers(deps)
    const begin = await beginRun(deps.repo, plan.id)

    await deps.repo.upsertRunLive(plan.id, {
      runToken: begin.token,
      reasoningReplace: '正在考虑第一天的路线……',
      statusText: '正在搜索作品',
      toolCalls: [{ name: 'search_bangumi_tv', status: 'running', summary: '京吹' }],
    })

    const during = await handlers.GET(plan.id)
    expect(during.status).toBe(200)
    const body = (await during.json()) as {
      agentBusy: boolean
      live: {
        reasoning: string
        statusText: string | null
        toolCalls: Array<{ name: string; status: string; summary?: string }>
        updatedAt: string
      } | null
    }
    expect(body.agentBusy).toBe(true)
    // L5：服务端已做 runToken 匹配，响应不再回传该字段
    expect(body.live).not.toHaveProperty('runToken')
    expect(body.live).toMatchObject({
      reasoning: '正在考虑第一天的路线……',
      statusText: '正在搜索作品',
      toolCalls: [{ name: 'search_bangumi_tv', status: 'running', summary: '京吹' }],
    })
    expect(typeof body.live!.updatedAt).toBe('string')

    await deps.repo.endAgentRun(plan.id, begin.token)
    const after = (await (await handlers.GET(plan.id)).json()) as { agentBusy: boolean; live?: unknown }
    expect(after.agentBusy).toBe(false)
    expect(after.live).toBeUndefined()
  })

  it('实况行 runToken 与当前持有者不一致（过期 run 残留）时 live 为 null', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    const handlers = createPlanByIdHandlers(deps)
    const begin = await beginRun(deps.repo, plan.id)

    // 被接管 run 的残留行：token 不是当前持有者
    await deps.repo.upsertRunLive(plan.id, {
      runToken: 'stale-token',
      reasoningReplace: '旧 run 的残留思考',
      statusText: '旧状态',
    })

    const body = (await (await handlers.GET(plan.id)).json()) as { agentBusy: boolean; live?: unknown }
    expect(body.agentBusy).toBe(true)
    expect(body.live).toBeUndefined()
  })

  it('busy 但尚无实况行（run 刚起步）时 live 缺省，agentBusy 仍为 true', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    const handlers = createPlanByIdHandlers(deps)
    await beginRun(deps.repo, plan.id)

    const body = (await (await handlers.GET(plan.id)).json()) as { agentBusy: boolean; live?: unknown }
    expect(body.agentBusy).toBe(true)
    expect(body.live).toBeUndefined()
  })

  it('runStartedAt = 本 run 被领取的时刻（agentRunStartedAt）；未领取/已结束时为 null', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    const handlers = createPlanByIdHandlers(deps)
    const begin = await beginRun(deps.repo, plan.id)

    // 已投递但消费者尚未 claim：还没有启动时刻，前端退回本地此刻
    const queued = (await (await handlers.GET(plan.id)).json()) as { agentBusy: boolean; runStartedAt: string | null }
    expect(queued.agentBusy).toBe(true)
    expect(queued.runStartedAt).toBeNull()

    const claimedAt = Date.now()
    await deps.repo.claimAgentRun(plan.id, begin.token, 10 * 60 * 1000)
    const running = (await (await handlers.GET(plan.id)).json()) as { runStartedAt: string | null }
    expect(typeof running.runStartedAt).toBe('string')
    expect(Math.abs(Date.parse(running.runStartedAt!) - claimedAt)).toBeLessThan(5_000)

    await deps.repo.endAgentRun(plan.id, begin.token)
    const after = (await (await handlers.GET(plan.id)).json()) as { agentBusy: boolean; runStartedAt: string | null }
    expect(after.agentBusy).toBe(false)
    expect(after.runStartedAt).toBeNull()
  })

  it('chatRevision = 最后一条消息的 createdAt 毫秒，随新消息变化；空对话为 0', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    const handlers = createPlanByIdHandlers(deps)

    const empty = (await (await handlers.GET(plan.id)).json()) as { chatRevision: number }
    expect(empty.chatRevision).toBe(0)

    await deps.repo.appendMessage(plan.id, 'human', { role: 'user', content: 'hi' })
    const first = (await (await handlers.GET(plan.id)).json()) as {
      chatRevision: number
      chat: unknown[]
    }
    expect(first.chat).toHaveLength(1)
    expect(first.chatRevision).toBeGreaterThan(0)

    await deps.repo.appendMessage(plan.id, 'assistant', { role: 'assistant', content: '你好' })
    const second = (await (await handlers.GET(plan.id)).json()) as { chatRevision: number }
    expect(second.chatRevision).toBeGreaterThan(first.chatRevision)
  })

  it('M3：同毫秒多条消息 chatRevision 仍单调（消息数 × 1e14 位推进）', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    const handlers = createPlanByIdHandlers(deps)

    vi.useFakeTimers({ now: new Date('2026-09-03T00:00:00.000Z') })
    try {
      await deps.repo.appendMessage(plan.id, 'human', { role: 'user', content: '第一条' })
      const first = (await (await handlers.GET(plan.id)).json()) as { chatRevision: number }
      // 同一毫秒内追加第二条（假时钟冻结 Date.now，memory repo 的 createdAt 相同）
      await deps.repo.appendMessage(plan.id, 'assistant', { role: 'assistant', content: '第二条' })
      const second = (await (await handlers.GET(plan.id)).json()) as { chatRevision: number }

      expect(second.chatRevision).toBeGreaterThan(first.chatRevision)
      // 修订号可分解：高位 = 消息数，低位 = 最后一条消息的毫秒时间戳
      const ms = new Date('2026-09-03T00:00:00.000Z').getTime()
      expect(second.chatRevision).toBe(2 * 1e14 + ms)
    } finally {
      vi.useRealTimers()
    }
  })

  it('L8：agentBusy=false 且残留实况行时顺手清除；清除失败只 warn 不影响响应', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    const handlers = createPlanByIdHandlers(deps)
    const begin = await beginRun(deps.repo, plan.id)
    // busy 位已落幕但实况行没被清（fenced run 不写库 / finish 超时未清的残留形态）
    await deps.repo.upsertRunLive(plan.id, { runToken: begin.token, reasoningReplace: '残留思考' })
    await deps.repo.endAgentRun(plan.id, begin.token)

    const res = await handlers.GET(plan.id)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { agentBusy: boolean; live?: unknown }
    expect(body.agentBusy).toBe(false)
    expect(body.live).toBeUndefined()
    expect(await deps.repo.getRunLive(plan.id)).toBeNull()

    // 清理失败：GET 仍 200，只 warn
    await deps.repo.upsertRunLive(plan.id, { runToken: 'stale', reasoningReplace: '再残留' })
    vi.spyOn(deps.repo, 'clearRunLive').mockRejectedValueOnce(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res2 = await handlers.GET(plan.id)
      expect(res2.status).toBe(200)
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  // ---- 第八轮 §0 / A2：interrupted 字段 ----

  it('A2：最后一条运行日志 stage=interrupted 且无新 run（agentBusy=false）→ 返回 interrupted；chatRevision 不受影响', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    const handlers = createPlanByIdHandlers(deps)
    await deps.repo.appendMessage(plan.id, 'human', { role: 'user', content: '安排一天' })

    await deps.repo.appendRunLog({
      planId: plan.id,
      runToken: null,
      turnIndex: 1,
      stage: 'interrupted',
      durationMs: 1_234,
    })

    const res = await handlers.GET(plan.id)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      agentBusy: boolean
      interrupted: { at: string; turnIndex: number; reason: string } | null
      chatRevision: number
    }
    expect(body.agentBusy).toBe(false)
    expect(body.interrupted).not.toBeNull()
    expect(body.interrupted!.reason).toBe('run_log')
    // F1：turnIndex = (最后一条日志的 turnIndex ?? 0) + 1
    expect(body.interrupted!.turnIndex).toBe(2)
    expect(new Date(body.interrupted!.at).getTime()).not.toBeNaN()
    // chatRevision 计算不受影响：仍由消息数 + 最后一条消息时间决定
    expect(body.chatRevision).toBeGreaterThan(0)
  })

  it('A2：正常结束的日志（非 interrupted）或其后有新 run（agentBusy/busy 位存活）→ interrupted=null', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    const handlers = createPlanByIdHandlers(deps)

    // 无任何运行日志：null
    const empty = (await (await handlers.GET(plan.id)).json()) as { interrupted: unknown }
    expect(empty.interrupted).toBeNull()

    // 正常结束的日志：null
    await deps.repo.appendRunLog({ planId: plan.id, runToken: null, turnIndex: 1, stage: 'works', durationMs: 100 })
    const normal = (await (await handlers.GET(plan.id)).json()) as { interrupted: unknown }
    expect(normal.interrupted).toBeNull()

    // 日志是 interrupted，但新 run 正在跑（agentBusy=true）：null——被打断的回合已被接续
    await deps.repo.appendRunLog({ planId: plan.id, runToken: null, turnIndex: 2, stage: 'interrupted', durationMs: 100 })
    const active = await beginRun(deps.repo, plan.id)
    const busy = (await (await handlers.GET(plan.id)).json()) as { agentBusy: boolean; interrupted: unknown }
    expect(busy.agentBusy).toBe(true)
    expect(busy.interrupted).toBeNull()

    // interrupted 之后又有一条更晚的正常日志：null（最新一条不是 interrupted）
    await deps.repo.endAgentRun(plan.id, active.token)
    await deps.repo.appendRunLog({ planId: plan.id, runToken: null, turnIndex: 3, stage: 'works', durationMs: 100 })
    const superseded = (await (await handlers.GET(plan.id)).json()) as { interrupted: unknown }
    expect(superseded.interrupted).toBeNull()
  })

  // ---- 第八轮 F1：从状态推断中断（硬杀场景，finally 写不到日志）----

  it('F1：硬杀（有 human、无运行日志、尾部 assistant 纯文本）→ interrupted reason=missing_run_log', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    const handlers = createPlanByIdHandlers(deps)
    await deps.repo.appendMessage(plan.id, 'human', { role: 'user', content: '现在把第 6 天午餐换成这家并完整重存' })
    // 硬杀现场：中途的 assistant 文本已落库，但该回合的运行日志永远写不到了
    await deps.repo.appendMessage(plan.id, 'assistant', { role: 'assistant', content: '好的，我来处理……' })

    const body = (await (await handlers.GET(plan.id)).json()) as {
      agentBusy: boolean
      interrupted: { at: string; turnIndex: number; reason: string } | null
    }
    expect(body.agentBusy).toBe(false)
    expect(body.interrupted).not.toBeNull()
    expect(body.interrupted!.reason).toBe('missing_run_log')
    // 无日志 → turnIndex = (0) + 1
    expect(body.interrupted!.turnIndex).toBe(1)
    // at = 最后一条消息（assistant）的 createdAt
    const messages = await deps.repo.listMessages(plan.id)
    expect(new Date(body.interrupted!.at).getTime()).toBe(messages[messages.length - 1]!.createdAt.getTime())
  })

  it('F1：正常收尾（本回合有 stage 非 interrupted 的日志、尾部 assistant 纯文本）→ interrupted=null', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    const handlers = createPlanByIdHandlers(deps)
    await deps.repo.appendMessage(plan.id, 'human', { role: 'user', content: '安排一天' })
    await deps.repo.appendMessage(plan.id, 'assistant', { role: 'assistant', content: '安排好了。' })
    await deps.repo.appendRunLog({ planId: plan.id, runToken: null, turnIndex: 1, stage: 'works', durationMs: 100 })

    const body = (await (await handlers.GET(plan.id)).json()) as { interrupted: unknown }
    expect(body.interrupted).toBeNull()
  })

  it('F1：尾部 assistant 带 tool_calls（对话悬空）→ interrupted reason=dangling', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    const handlers = createPlanByIdHandlers(deps)
    await deps.repo.appendMessage(plan.id, 'human', { role: 'user', content: '安排一天' })
    await deps.repo.appendMessage(plan.id, 'assistant', {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'save_plan_days', arguments: '{}' } }],
    })
    // 该回合有正常收尾日志（错误中断也会写日志），但对话悬空在工具调用半途
    await deps.repo.appendRunLog({ planId: plan.id, runToken: null, turnIndex: 2, stage: 'works', durationMs: 100 })

    const body = (await (await handlers.GET(plan.id)).json()) as {
      interrupted: { at: string; turnIndex: number; reason: string } | null
    }
    expect(body.interrupted).not.toBeNull()
    expect(body.interrupted!.reason).toBe('dangling')
    // turnIndex = 最后一条日志的 turnIndex(2) + 1
    expect(body.interrupted!.turnIndex).toBe(3)
  })

  // ---- 第十一轮 A3：用户停止后不自动续跑 ----

  it('H2：agentBusy=false 时 5 分钟内的停止标记行不被顺手清掉；超过 5 分钟照旧清', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-04T00:00:00.000Z') })
    try {
      const deps = makeDeps()
      const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
      const handlers = createPlanByIdHandlers(deps)
      const begin = await beginRun(deps.repo, plan.id)
      // 用户停止：busy 清空、标记行落库（updatedAt = 假时钟的当前时刻）
      await deps.repo.stopAgentRun(plan.id)

      const body = (await (await handlers.GET(plan.id)).json()) as { agentBusy: boolean; live?: unknown }
      expect(body.agentBusy).toBe(false)
      expect(body.live).toBeUndefined()
      // 并发 GET 不能把 5 分钟内的停止标记清掉——loop 收尾还要靠它区分归属
      expect(await deps.repo.getRunLive(plan.id)).not.toBeNull()

      // 6 分钟后：标记行视为残留，照旧顺手清理
      vi.setSystemTime(new Date('2026-09-04T00:06:00.000Z'))
      await handlers.GET(plan.id)
      expect(await deps.repo.getRunLive(plan.id)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('A3：最后日志 stopped 且晚于最后 human → interrupted=null（即使尾部 assistant 带 tool_calls）', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-04T00:00:00.000Z') })
    try {
      const deps = makeDeps()
      const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
      const handlers = createPlanByIdHandlers(deps)
      await deps.repo.appendMessage(plan.id, 'human', { role: 'user', content: '安排一天' })
      // 停止发生在模型产出 tool_calls 之后：assistant 带 tool_calls 已落库
      await deps.repo.appendMessage(plan.id, 'assistant', {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'save_plan_days', arguments: '{}' } }],
      })
      // 运行结束后停止日志才写下（finally 收尾）——时间上严格晚于消息
      vi.setSystemTime(new Date('2026-09-04T00:00:05.000Z'))
      await deps.repo.appendRunLog({ planId: plan.id, runToken: null, turnIndex: 1, stage: 'stopped', durationMs: 800 })

      const body = (await (await handlers.GET(plan.id)).json()) as { interrupted: unknown }
      expect(body.interrupted).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('A3：stopped 日志早于新的 human 消息（停止后又发了新消息）→ 不吃掉该新回合的中断推断', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-04T00:00:00.000Z') })
    try {
      const deps = makeDeps()
      const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
      const handlers = createPlanByIdHandlers(deps)
      await deps.repo.appendRunLog({ planId: plan.id, runToken: null, turnIndex: 1, stage: 'stopped', durationMs: 100 })
      vi.setSystemTime(new Date('2026-09-04T00:00:05.000Z'))
      await deps.repo.appendMessage(plan.id, 'human', { role: 'user', content: '继续安排' })
      // 新回合尚无日志 → missing_run_log 推断照常（硬杀守卫不被停止规则吞掉）

      const body = (await (await handlers.GET(plan.id)).json()) as {
        interrupted: { reason: string } | null
      }
      expect(body.interrupted).not.toBeNull()
      expect(body.interrupted!.reason).toBe('missing_run_log')
    } finally {
      vi.useRealTimers()
    }
  })

  // ---- P0-C：恢复推断识别"当前 run 身份"（F3/F5/F6：停止→resume→派发丢失）----

  it('P0-C：停止后 resume 派发丢失（unclaimed、TTL 过期）→ interrupted.reason=unclaimed、stopped=false；busy 期间仍 null', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-10T00:00:00.000Z') })
    try {
      const deps = makeDeps()
      const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
      const handlers = createPlanByIdHandlers(deps)
      await deps.repo.appendMessage(plan.id, 'human', { role: 'user', content: '安排一天' })
      await deps.repo.appendMessage(plan.id, 'assistant', { role: 'assistant', content: '安排好了。' })

      // 第一轮：begin token A 后用户停止（写下 token A 的 stopped 日志、busy 清空）
      const first = await deps.repo.beginAgentRun({
        planId: plan.id,
        userId: 'u1',
        content: null,
        since: new Date(0),
        limit: 10,
        busyTtlMs: 60_000,
      })
      if (first.status !== 'ok') throw new Error('unreachable')
      await deps.repo.stopAgentRun(plan.id)

      // 用户手动 resume：begin 新 token B（不追加 human）；派发丢失、无人领取
      const second = await deps.repo.beginAgentRun({
        planId: plan.id,
        userId: 'u1',
        content: null,
        since: new Date(0),
        limit: 10,
        busyTtlMs: 60_000,
      })
      if (second.status !== 'ok') throw new Error('unreachable')

      // TTL 未过（busy 中）：interrupted 仍为 null（不变）
      const during = await readPlanRunState(deps, plan.id)
      expect(during!.agentBusy).toBe(true)
      expect(during!.interrupted).toBeNull()

      // TTL 过后：旧 stopped 日志（token A）不再遮蔽新尝试 → unclaimed；
      // stopped 标志随 token 不同判 false
      vi.setSystemTime(new Date('2026-09-10T00:05:00.000Z'))
      const after = await readPlanRunState(deps, plan.id)
      expect(after!.agentBusy).toBe(false)
      expect(after!.stopped).toBe(false)
      expect(after!.interrupted).not.toBeNull()
      expect(after!.interrupted!.reason).toBe('unclaimed')
      expect(after!.interrupted!.turnIndex).toBe(2)
      // at = 过期的 busyUntil（00:01:00，这次尝试事实上的死亡时刻）
      expect(after!.interrupted!.at).toBe(new Date('2026-09-10T00:01:00.000Z').toISOString())

      // GET 响应同样暴露 unclaimed（前端自动续跑只看 interrupted 是否非空）
      const body = (await (await handlers.GET(plan.id)).json()) as {
        agentBusy: boolean
        interrupted: { reason: string } | null
      }
      expect(body.agentBusy).toBe(false)
      expect(body.interrupted!.reason).toBe('unclaimed')
    } finally {
      vi.useRealTimers()
    }
  })
})
