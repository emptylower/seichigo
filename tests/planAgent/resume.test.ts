import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import { canResume, inferInterrupted, RESUME_NOTE, type CurrentRunState } from '@/lib/planAgent/resume'
import type { TripPlanMessage, TripPlanRunLogRecord } from '@/lib/tripPlan/repo'
import type { PointFinder } from '@/lib/planAgent/points'

/** 第八轮 §0 / A3 / F2：canResume 判定（与 F1 中断推断对齐）+ resume 回合不追加 human 消息、注入中断说明 */

const finder: PointFinder = {
  async searchBangumi() {
    return [{ id: 115908, titleZh: '吹响吧！上低音号', titleJaRaw: null, city: '宇治' }]
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return [{ id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, ep: '1' }]
  },
  async getPointsByIds() {
    return [{ id: 'p1', lat: 34.8892, lng: 135.8075 }]
  },
}

function message(kind: TripPlanMessage['kind'], content: unknown, at: Date = new Date()): TripPlanMessage {
  return {
    id: `${kind}-${Math.random()}`,
    planId: 'p1',
    kind,
    content: content as TripPlanMessage['content'],
    createdAt: at,
  }
}

function runLog(
  stage: string,
  turnIndex: number,
  at: Date = new Date(),
  runToken: string | null = null,
): TripPlanRunLogRecord {
  return {
    id: `log-${Math.random()}`,
    planId: 'p1',
    runToken,
    turnIndex,
    stage,
    enrichReport: null,
    gateReport: null,
    toolCalls: null,
    modelUsage: null,
    durationMs: 100,
    createdAt: at,
  }
}

const TOOL_CALLS = [{ id: 'c1', type: 'function', function: { name: 'list_points', arguments: '{}' } }]

describe('canResume（第八轮 §0 / F2）', () => {
  it('最后一条是 human（回合刚开始就被打断、无日志）→ 可续', () => {
    expect(canResume([message('human', { role: 'user', content: '安排一天' })], [])).toBe(true)
  })

  it('最后是 assistant 带 tool_calls（工具执行到一半，含尾部 tool 回执/daymap；该回合已有日志）→ 可续（dangling）', () => {
    const t0 = new Date('2026-09-03T02:00:00.000Z')
    const t1 = new Date('2026-09-03T02:00:01.000Z')
    const logs = [runLog('works', 1, t1)]
    expect(
      canResume(
        [
          message('human', { role: 'user', content: '安排一天' }, t0),
          message('assistant', { role: 'assistant', content: null, tool_calls: TOOL_CALLS }, t1),
          message('tool', { role: 'tool', tool_call_id: 'c1', content: '{}' }, t1),
        ],
        logs,
      ),
    ).toBe(true)
    // daymap 交付物落在 assistant 与 tool 回执之间：尾部是 daymap 同样可续
    expect(
      canResume(
        [
          message('human', { role: 'user', content: '安排一天' }, t0),
          message('assistant', { role: 'assistant', content: null, tool_calls: TOOL_CALLS }, t1),
          message('daymap', { revisionId: 'd1' }, t1),
        ],
        logs,
      ),
    ).toBe(true)
  })

  it('最后一条是 ask 且未回答：该回合无运行日志（硬杀在收尾前）→ 可续；正常等待回答（有日志）→ 无事可续', () => {
    const t0 = new Date('2026-09-03T02:00:00.000Z')
    const t1 = new Date('2026-09-03T02:00:01.000Z')
    const base = [
      message('human', { role: 'user', content: '安排一天' }, t0),
      message('assistant', { role: 'assistant', content: null, tool_calls: TOOL_CALLS }, t1),
      message('ask', { askId: 'a1', kind: 'single_choice' }, t1),
      message('tool', { role: 'tool', tool_call_id: 'c1', content: '{"status":"asked"}' }, t1),
    ]
    // 硬杀：ask 已落库但 finally 日志没写 → missing_run_log
    expect(canResume(base, [])).toBe(true)
    // 正常等待回答：ask 回合正常收尾（日志已写、stage 非 interrupted）→ 不是被打断
    expect(canResume(base, [runLog('works', 1, t1)])).toBe(false)
  })

  it('最后一条是不带 tool_calls 的 assistant 文本（回合已自然收尾、有本回合日志）→ nothing_to_resume', () => {
    const t0 = new Date('2026-09-03T02:00:00.000Z')
    const t1 = new Date('2026-09-03T02:00:01.000Z')
    expect(
      canResume(
        [
          message('human', { role: 'user', content: '安排一天' }, t0),
          message('assistant', { role: 'assistant', content: '安排好了。' }, t1),
        ],
        [runLog('works', 1, t1)],
      ),
    ).toBe(false)
  })

  it('空对话 → nothing_to_resume', () => {
    expect(canResume([], [])).toBe(false)
  })

  it('F2：尾部 assistant 纯文本但该回合无运行日志（完全无日志/只有上一回合日志）→ 可续（missing_run_log）', () => {
    const t0 = new Date('2026-09-03T02:00:00.000Z')
    const t1 = new Date('2026-09-03T02:00:01.000Z')
    const t2 = new Date('2026-09-03T02:05:00.000Z')
    const t3 = new Date('2026-09-03T02:05:01.000Z')
    // 第二回合硬杀现场：human + 中途 assistant 文本已落库，但该回合日志写不到
    const messages = [
      message('human', { role: 'user', content: '排第一天' }, t0),
      message('assistant', { role: 'assistant', content: '第一天排好了。' }, t1),
      message('human', { role: 'user', content: '换第 6 天午餐' }, t2),
      message('assistant', { role: 'assistant', content: '现在把第 6 天午餐换成这家并完整重存' }, t3),
    ]
    // 完全无日志
    expect(canResume(messages, [])).toBe(true)
    // 有上一回合的正常日志，但 lastHuman 在其后（本回合无日志）→ 仍可续
    expect(canResume(messages, [runLog('works', 1, t1)])).toBe(true)
  })

  it('F2：尾部 assistant 纯文本且有本回合的正常日志 → nothing_to_resume', () => {
    const t0 = new Date('2026-09-03T02:05:00.000Z')
    const t1 = new Date('2026-09-03T02:05:01.000Z')
    const t2 = new Date('2026-09-03T02:05:02.000Z')
    expect(
      canResume(
        [
          message('human', { role: 'user', content: '换第 6 天午餐' }, t0),
          message('assistant', { role: 'assistant', content: '换好了，已完整重存。' }, t1),
        ],
        [runLog('works', 1, t2)],
      ),
    ).toBe(false)
  })
})

describe('P0-C：恢复推断识别"当前 run 身份"', () => {
  const t0 = new Date('2026-09-10T02:00:00.000Z')
  const t1 = new Date('2026-09-10T02:00:01.000Z')
  const t2 = new Date('2026-09-10T02:00:02.000Z')
  // 用户主动停止后的现场：human 之后模型已产出 tool_calls，stop 收尾写下
  // token A 的 stopped 日志；此后手动 resume 又 begin 了 token B（不追加 human）
  const toolCallsTail = [
    message('human', { role: 'user', content: '安排一天' }, t0),
    message('assistant', { role: 'assistant', content: null, tool_calls: TOOL_CALLS }, t1),
  ]
  const plainTail = [
    message('human', { role: 'user', content: '安排一天' }, t0),
    message('assistant', { role: 'assistant', content: '安排好了。' }, t1),
  ]
  const stoppedLogA = () => runLog('stopped', 1, t2, 'run-a')

  it('F3：current.token 与 stopped 尾日志相同 → 仍是主动停笔（今天的行为）', () => {
    const current: CurrentRunState = { token: 'run-a', startedAt: null, busyUntil: new Date(Date.now() - 1_000) }
    expect(inferInterrupted(toolCallsTail, [stoppedLogA()], current)).toBeNull()
    expect(canResume(toolCallsTail, [stoppedLogA()], current)).toBe(true)
  })

  it('F5/F6：current.token 不同 + 从未被领取（startedAt=null、busy 过期、无该 token 日志）→ reason=unclaimed', () => {
    const busyUntil = new Date(Date.now() - 60_000)
    const current: CurrentRunState = { token: 'run-b', startedAt: null, busyUntil }
    const inferred = inferInterrupted(toolCallsTail, [stoppedLogA()], current)
    expect(inferred).not.toBeNull()
    expect(inferred!.reason).toBe('unclaimed')
    // at = busyUntil（这次尝试事实上的死亡时刻）；turnIndex 沿用 (最后日志 turnIndex ?? 0)+1
    expect(inferred!.at.getTime()).toBe(busyUntil.getTime())
    expect(inferred!.turnIndex).toBe(2)
    expect(canResume(toolCallsTail, [stoppedLogA()], current)).toBe(true)
  })

  it('F5：current.token 不同但已被领取（startedAt 非空）→ 走既有规则（回归快照：tool_calls 尾 → dangling；纯文本尾 → null）', () => {
    const current: CurrentRunState = { token: 'run-b', startedAt: new Date(), busyUntil: new Date(Date.now() - 60_000) }
    expect(inferInterrupted(toolCallsTail, [stoppedLogA()], current)).toMatchObject({ reason: 'dangling', turnIndex: 2 })
    expect(inferInterrupted(plainTail, [stoppedLogA()], current)).toBeNull()
  })

  it('F5：unclaimed 但 busy TTL 未过 → 不报 unclaimed（不会被误报可恢复）', () => {
    const current: CurrentRunState = { token: 'run-b', startedAt: null, busyUntil: new Date(Date.now() + 60_000) }
    expect(inferInterrupted(plainTail, [stoppedLogA()], current)).toBeNull()
  })

  it('current 缺省 / 为 null（无当前 run）→ 与既有行为逐字相同（stopped 尾日志仍是主动停笔）', () => {
    expect(inferInterrupted(toolCallsTail, [stoppedLogA()])).toBeNull()
    expect(inferInterrupted(toolCallsTail, [stoppedLogA()], null)).toBeNull()
    expect(inferInterrupted(toolCallsTail, [stoppedLogA()], undefined)).toBeNull()
    expect(canResume(toolCallsTail, [stoppedLogA()])).toBe(true)
  })
})

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessage

describe('resume 回合（第八轮 A3）', () => {
  it('不追加 human 消息：以已落库历史直接续跑；中断说明注入 [系统状态] 前缀且不落库', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    // 模拟被打断的现场：human + assistant(tool_calls) + tool 回执，模型还没来得及回应
    await repo.appendMessage(plan.id, 'human', { role: 'user', content: '安排一天' })
    await repo.appendMessage(plan.id, 'assistant', {
      role: 'assistant',
      content: null,
      tool_calls: TOOL_CALLS,
    })
    await repo.appendMessage(plan.id, 'tool', { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' })

    // beginAgentRun content=null：抢占 busy 位但不追加 human 消息
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      content: null,
      since: new Date(0),
      limit: 100,
      busyTtlMs: 60_000,
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    expect(await repo.listMessages(plan.id)).toHaveLength(3)

    let modelMessages: Array<{ role: string; content?: unknown }> = []
    const createMessage = vi.fn(async (params: { messages: Array<{ role: string; content?: unknown }> }) => {
      modelMessages = params.messages
      return { role: 'assistant', content: '接着安排。', refusal: null } as ChatMessage
    })

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage: createMessage as unknown as Parameters<typeof runPlanAgent>[0]['createMessage'],
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        userMessagePersisted: true,
        runToken: begin.token,
        resumeNote: RESUME_NOTE,
      },
      '',
      (e) => events.push(e),
    )

    // resume 不追加 human 消息：历史只在末尾多出最终 assistant 文本
    const persisted = await repo.listMessages(plan.id)
    expect(persisted.map((m) => m.kind)).toEqual(['human', 'assistant', 'tool', 'assistant'])

    // 中断说明进入本回合 [系统状态] 前缀（发给模型的内存消息），拼在最后一条
    // human 消息前部；落库的 human 行仍是纯用户原文
    const users = modelMessages.filter((m) => m.role === 'user')
    expect(users).toHaveLength(1)
    const userContent = String(users[0]!.content)
    expect(userContent.startsWith('[系统状态]')).toBe(true)
    expect(userContent).toContain('上一回合因连接中断被打断')
    expect(userContent.endsWith('安排一天')).toBe(true)
    const humanRow = persisted[0]!.content as { content: string }
    expect(humanRow.content).toBe('安排一天')
    expect(JSON.stringify(persisted.map((m) => m.content))).not.toContain('被打断')

    // 回合正常收尾：done 照发，运行日志不是 interrupted
    expect(events[events.length - 1].type).toBe('done')
    const logs = await repo.listRunLogs(plan.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]!.stage).not.toBe('interrupted')
    expect(logs[0]!.turnIndex).toBe(1)
  })
})

describe('RESUME_NOTE（第九轮 L2）', () => {
  it('明确已落库的工具结果可直接复用，不重新查询同样的路线或餐厅', () => {
    expect(RESUME_NOTE).toContain('已落库的工具结果都在历史消息里')
    expect(RESUME_NOTE).toContain('不要重新查询同样的路线或餐厅')
  })
})
