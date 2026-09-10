import { describe, it, expect, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Prisma } from '@prisma/client'
import type OpenAI from 'openai'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanMessage, TripPlanMessageKind, TripPlanRepo } from '@/lib/tripPlan/repo'
import { runPlanAgent, sanitizeChatHistory } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import { PLAN_AGENT_SYSTEM_PROMPT } from '@/lib/planAgent/prompt'
import type { PointFinder } from '@/lib/planAgent/points'

/**
 * 金样本（任务 0，2026-09-10 前奏提速 B 部分唯一守卫）：CUT-3/CUT-6 改的是
 * 驱动整个提示词的阶段推断，推断错了不会报错、只会让 agent 行为静默改变。
 * 本文件把「首次模型调用收到的 messages」锁成 committed fixture——改动前后
 * 必须逐字节相同（`JSON.stringify(captured) === fixture`）。
 *
 * 重新生成：`UPDATE_GOLDEN=1 npx vitest run tests/planAgent/loop.messagesGolden.test.ts`
 * ⚠️ 只允许在生产行为「理应不变」的改动之前/之后各跑一次对拍，不许拿它当
 * 「先改代码再落 fixture」的捷径。
 */

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

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessage
type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam

function assistantMessage(partial: Partial<ChatMessage>): ChatMessage {
  return { role: 'assistant', content: null, refusal: null, ...partial } as ChatMessage
}

const tc = (id: string, name: string, args: Record<string, unknown>) => [
  { id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } },
]

const toolReply = (callId: string, content: string): { role: 'tool'; tool_call_id: string; content: string } => ({
  role: 'tool',
  tool_call_id: callId,
  content,
})

const passedQuality = {
  passed: true,
  hard: [],
  soft: [],
  stats: { visitItems: 4, withCoords: 4, withMedia: 3, transitLegs: 3, transitReal: 3, transitEstimated: 0, missingTransit: 0, daySpanMaxMin: 420 },
  evaluatedAt: '2026-09-02T08:00:00Z',
}

const failedQuality = {
  passed: false,
  hard: [
    { gate: 'transport', severity: 'hard', dayIndex: 2, itemTitle: '宇治桥 → 京都站', fix: '用 estimate_travel 补「宇治桥」→「京都站」的交通' },
    { gate: 'coords', severity: 'hard', dayIndex: 2, itemTitle: '神秘酒店', fix: '条目「神秘酒店」缺少坐标' },
  ],
  soft: [{ gate: 'media', severity: 'soft', dayIndex: 1, fix: '有图条目 3/5（低于 80%）' }],
  stats: { visitItems: 5, withCoords: 4, withMedia: 3, transitLegs: 3, transitReal: 2, transitEstimated: 1, missingTransit: 1, daySpanMaxMin: 480 },
  evaluatedAt: '2026-09-02T06:30:00Z',
}

/** daymap content：完整 days 快照 + quality（quality.passed 两种取值都要有 fixture 覆盖） */
const daymapContent = (revisionId: string, quality: typeof passedQuality | typeof failedQuality) => ({
  type: 'daymap',
  revisionId,
  savedAt: '2026-09-02T08:00:00Z',
  days: [
    {
      id: `day-${revisionId}-1`,
      dayIndex: 1,
      date: '2026-09-15T00:00:00Z',
      citySlug: 'uji',
      summary: '宇治一日',
      items: [
        { id: `i-${revisionId}-1`, sortOrder: 0, type: 'point', pointId: 'p1', timeHint: '09:30', title: '宇治桥', note: null, reason: '第 1 话开场', payload: null, point: { id: 'p1', name: '宇治橋', nameZh: '宇治桥', nameEn: 'Uji Bridge', lat: 34.8892, lng: 135.8075, image: null } },
        { id: `i-${revisionId}-2`, sortOrder: 1, type: 'point', pointId: 'p2', timeHint: '10:30', title: '朝雾桥', note: null, reason: '利兹与玛基雅薇尔', payload: null, point: { id: 'p2', name: '朝霧橋', nameZh: '朝雾桥', nameEn: 'Asagiri Bridge', lat: 34.8941, lng: 135.8079, image: null } },
      ],
    },
    {
      id: `day-${revisionId}-2`,
      dayIndex: 2,
      date: '2026-09-16T00:00:00Z',
      citySlug: 'kyoto',
      summary: '京都一日',
      items: [
        { id: `i-${revisionId}-3`, sortOrder: 0, type: 'point', pointId: 'p3', timeHint: '10:00', title: '府立图书馆', note: null, reason: '第 2 话', payload: null, point: { id: 'p3', name: '京都府立図書館', nameZh: '府立图书馆', nameEn: null, lat: 35.0106, lng: 135.7681, image: null } },
        { id: `i-${revisionId}-4`, sortOrder: 1, type: 'meal', pointId: null, timeHint: '12:00', title: '近江牛饭', note: null, reason: null, payload: { mealSlot: 'lunch' }, point: null },
      ],
    },
  ],
  quality,
})

type Row = { kind: TripPlanMessageKind; content: Prisma.JsonValue }

/**
 * 约 36 条混合历史：human / assistant（带 tool_calls）/ tool / ask / daymap，
 * 并故意埋了一组悬空 tool_calls（call_10 无回执）与一条孤儿 tool 回执
 * （call_ghost）——sanitizeChatHistory 的两条清洗分支都进金样本。
 */
const baseHistory: Row[] = [
  { kind: 'human', content: { role: 'user', content: '你好，帮我规划一次京吹的圣地巡礼' } },
  { kind: 'assistant', content: { role: 'assistant', content: '好的！先确认一下作品。' } },
  { kind: 'assistant', content: { role: 'assistant', content: null, tool_calls: tc('call_1', 'search_bangumi_tv', { keyword: '吹响吧上低音号' }) } },
  { kind: 'tool', content: toolReply('call_1', '{"results":[{"id":115908,"titleZh":"吹响吧！上低音号","city":"宇治"}]}') },
  { kind: 'assistant', content: { role: 'assistant', content: '找到《吹响吧！上低音号》，主要舞台在宇治。打算什么时候出发、玩几天？' } },
  { kind: 'human', content: { role: 'user', content: '9 月 15 日出发，玩两天' } },
  { kind: 'assistant', content: { role: 'assistant', content: null, tool_calls: tc('call_2', 'update_plan_meta', { startDate: '2026-09-15', dayCount: 2, bangumiIds: [115908] }) } },
  { kind: 'tool', content: toolReply('call_2', '{"ok":true}') },
  { kind: 'assistant', content: { role: 'assistant', content: null, tool_calls: tc('call_3', 'list_points', { bangumiId: 115908 }) } },
  { kind: 'tool', content: toolReply('call_3', '{"points":[{"id":"p1","name":"宇治橋","lat":34.8892},{"id":"p2","name":"朝霧橋","lat":34.8941}]}') },
  { kind: 'assistant', content: { role: 'assistant', content: '宇治的点位很集中。第一天排宇治桥、朝雾桥一带，第二天去京都，可以吗？' } },
  { kind: 'human', content: { role: 'user', content: '可以，先排第一版' } },
  { kind: 'assistant', content: { role: 'assistant', content: null, tool_calls: tc('call_4', 'save_plan_days', { days: [{ dayIndex: 1, items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }] }] }) } },
  { kind: 'daymap', content: daymapContent('rev-1', failedQuality) },
  { kind: 'tool', content: toolReply('call_4', '{"ok":true,"enrich":{"applied":{"transport":1},"skipped":[]}}') },
  { kind: 'assistant', content: { role: 'assistant', content: '第一版存好了，不过交通门还没过，我把接驳补上。' } },
  { kind: 'assistant', content: { role: 'assistant', content: null, tool_calls: tc('call_5', 'estimate_travel', { from: '宇治桥', to: '京都站' }) } },
  { kind: 'tool', content: toolReply('call_5', '{"ok":true,"mode":"train","durationSeconds":2100,"distanceMeters":17000}') },
  { kind: 'assistant', content: { role: 'assistant', content: null, tool_calls: tc('call_6', 'save_plan_days', { days: [{ dayIndex: 1, items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'point', pointId: 'p2', title: '朝雾桥' }] }, { dayIndex: 2, items: [{ type: 'point', pointId: 'p3', title: '府立图书馆' }] }] }) } },
  { kind: 'daymap', content: daymapContent('rev-2', passedQuality) },
  { kind: 'tool', content: toolReply('call_6', '{"ok":true,"enrich":{"applied":{"transport":3},"skipped":[]}}') },
  { kind: 'assistant', content: { role: 'assistant', content: '交通补齐、门控全过，这版行程交付！' } },
  { kind: 'human', content: { role: 'user', content: '午饭有什么推荐？' } },
  { kind: 'assistant', content: { role: 'assistant', content: null, tool_calls: tc('call_7', 'ask_user', { taskType: 'choice', question: '想吃什么类型的午餐？', options: ['和食', 'café', '拉面'] }) } },
  { kind: 'tool', content: toolReply('call_7', '{"asked":true}') },
  { kind: 'ask', content: { taskType: 'choice', question: '想吃什么类型的午餐？', options: ['和食', 'café', '拉面'] } },
  { kind: 'human', content: { role: 'user', content: '和食吧' } },
  { kind: 'assistant', content: { role: 'assistant', content: '好，第二天的午餐安排成中书岛的近江牛饭。' } },
  { kind: 'human', content: { role: 'user', content: '第二天下午还能加什么？' } },
  { kind: 'assistant', content: { role: 'assistant', content: null, tool_calls: tc('call_8', 'list_points', { bangumiId: 115908, keyword: '大吉山' }) } },
  { kind: 'tool', content: toolReply('call_8', '{"points":[{"id":"p4","name":"大吉山","lat":34.8963}]}') },
  { kind: 'assistant', content: { role: 'assistant', content: '可以加大吉山的展望台，步行 20 分钟就能到。' } },
  // 孤儿 tool 回执：清洗时丢弃
  { kind: 'tool', content: toolReply('call_ghost', '{"stale":true}') },
  // 悬空 tool_calls（崩溃遗留）：assistant 整条丢弃，绝不发出非法序列
  { kind: 'assistant', content: { role: 'assistant', content: null, tool_calls: tc('call_10', 'read_plan', {}) } },
  { kind: 'human', content: { role: 'user', content: '住宿定在哪里比较顺路？' } },
  { kind: 'assistant', content: { role: 'assistant', content: '建议住京都站附近，第二天退房后行李寄存也方便。' } },
  { kind: 'human', content: { role: 'user', content: '好，就这么定' } },
]

/** 场景尾巴：deliver 以 daymap 收尾（resume 型回合）；revise/enrich 以本轮 human 收尾 */
const scenarioTails: Record<string, Row[]> = {
  deliver: [{ kind: 'daymap', content: daymapContent('rev-3', passedQuality) }],
  revise: [{ kind: 'human', content: { role: 'user', content: '把第二天的行程单再发我一次' } }],
  enrich: [
    { kind: 'daymap', content: daymapContent('rev-3', failedQuality) },
    { kind: 'human', content: { role: 'user', content: '怎么还有坐标缺失？补一下' } },
  ],
}

const expectedStage: Record<string, string> = { deliver: '已交付', revise: '修订中', enrich: '补齐中' }

async function runFirstTurn(name: keyof typeof scenarioTails): Promise<{
  repo: MemoryTripPlanRepo
  planId: string
  captured: ChatMessageParam[]
  listMessagesRaw: TripPlanMessage[]
}> {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: '京吹两日巡礼' })
  await repo.updateMeta(plan.id, { bangumiIds: [115908], startDate: new Date('2026-09-15T00:00:00Z'), dayCount: 2 })
  await repo.replaceDays(plan.id, [
    { dayIndex: 1, items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'point', pointId: 'p2', title: '朝雾桥' }] },
    { dayIndex: 2, items: [{ type: 'point', pointId: 'p3', title: '府立图书馆' }, { type: 'meal', title: '近江牛饭' }] },
  ])
  const rows = [...baseHistory, ...scenarioTails[name]]
  expect(rows.length).toBeGreaterThanOrEqual(34) // 「约 36 条」的健全性检查
  for (const row of rows) await repo.appendMessage(plan.id, row.kind, row.content)

  // 捕获 loop 首次读取的持久化历史（sanitize 的输入只能来自它）
  let listMessagesRaw: TripPlanMessage[] | null = null
  const observedRepo: TripPlanRepo = new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop === 'listMessages') {
        return async (planId: string) => {
          const out = await target.listMessages(planId)
          if (!listMessagesRaw) listMessagesRaw = out
          return out
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  const createMessage = vi.fn(async (_params: { messages: ChatMessageParam[] }) => assistantMessage({ content: '收到' }))
  const events: PlanAgentEvent[] = []
  await runPlanAgent(
    {
      createMessage,
      repo: observedRepo,
      planId: plan.id,
      toolDeps: { planId: plan.id, repo, points: finder },
      userMessagePersisted: true,
      maxIterations: 3,
    },
    '（继续）',
    (e) => events.push(e),
  )
  expect(createMessage).toHaveBeenCalledTimes(1)
  const captured = createMessage.mock.calls[0]![0].messages as ChatMessageParam[]
  return { repo, planId: plan.id, captured, listMessagesRaw: listMessagesRaw! }
}

describe('金样本：首次模型调用的 messages（CUT-3/CUT-6 改动前后逐字节不变）', () => {
  for (const name of ['deliver', 'revise', 'enrich'] as const) {
    it(`${name}：与 committed fixture 逐字节相同，且 [系统状态] 只改内存里的 user 消息`, async () => {
      const { repo, planId, captured, listMessagesRaw } = await runFirstTurn(name)

      // 阶段确实穿到了目标分支（stageContext 注进 [系统状态]，锁进金样本）
      const lastUser = [...captured].reverse().find((m) => m.role === 'user')!
      expect(String(lastUser.content)).toContain(`阶段：${expectedStage[name]}`)

      // 1) 逐字节金样本
      const json = JSON.stringify(captured)
      const fixtureUrl = new URL(`./__fixtures__/first-turn-messages.${name}.json`, import.meta.url)
      if (process.env.UPDATE_GOLDEN === '1') {
        mkdirSync(fileURLToPath(new URL('./__fixtures__/', import.meta.url)), { recursive: true })
        writeFileSync(fixtureUrl, json)
      }
      expect(existsSync(fixtureUrl), `缺 fixture：${name}（先在未改动的代码上 UPDATE_GOLDEN=1 生成）`).toBe(true)
      expect(json, `${name}：首次模型调用 messages 与金样本不一致`).toBe(readFileSync(fixtureUrl, 'utf8'))

      // 2) system 恒为原始提示词（保前缀缓存）
      expect(captured[0]).toEqual({ role: 'system', content: PLAN_AGENT_SYSTEM_PROMPT })

      // 3) sanitizeChatHistory 的输入 === repo.listMessages() 的原始输出：
      //    [系统状态] 前缀只改内存里最后一条 user，绝不进 sanitize 的输入
      expect(JSON.stringify(listMessagesRaw.map((m) => m.content))).not.toContain('[系统状态]')
      const isChatParam = (c: Prisma.JsonValue): c is Prisma.JsonObject =>
        typeof c === 'object' && c !== null && !Array.isArray(c) && 'role' in c
      const rawContents = listMessagesRaw
        .map((m) => m.content)
        .filter(isChatParam) as unknown as ChatMessageParam[]
      const tail = captured.slice(1)
      let lastUserIndex = -1
      for (let i = tail.length - 1; i >= 0; i--) {
        if (tail[i]!.role === 'user') {
          lastUserIndex = i
          break
        }
      }
      expect(lastUserIndex).toBeGreaterThanOrEqual(0)
      const prefixed = String(tail[lastUserIndex]!.content)
      expect(prefixed.startsWith('[系统状态]')).toBe(true)
      const rawUser = String(
        ([...listMessagesRaw].reverse().find((m) => m.kind === 'human')!.content as { content: unknown }).content,
      )
      expect(prefixed.endsWith(rawUser)).toBe(true)
      const unPrefixed = [...tail]
      unPrefixed[lastUserIndex] = { ...tail[lastUserIndex]!, content: rawUser } as ChatMessageParam
      expect(JSON.stringify(unPrefixed)).toBe(JSON.stringify(sanitizeChatHistory(rawContents)))

      // 4) 落库原文不含前缀（改写只发生在发给模型的内存数组上）
      expect((await repo.listMessages(planId)).some((m) => JSON.stringify(m.content).includes('[系统状态]'))).toBe(false)
    })
  }
})

// ---------------------------------------------------------------------------
// CUT-6：updateStage 的发起时刻推到首次模型请求发出之后（顺序栅栏）
// ---------------------------------------------------------------------------

/** revise 场景的种子：作品/日期/点位齐全 + daymap(通过) + 本轮 human（已持久化） */
async function seedRevisePlan(repo: MemoryTripPlanRepo): Promise<string> {
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  await repo.updateMeta(plan.id, { bangumiIds: [115908], startDate: new Date('2026-09-15T00:00:00Z'), dayCount: 2 })
  await repo.replaceDays(plan.id, [{ dayIndex: 1, items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }] }])
  await repo.appendMessage(plan.id, 'human', { role: 'user', content: '帮我安排' })
  await repo.appendMessage(plan.id, 'daymap', {
    type: 'daymap',
    revisionId: 'rev-1',
    savedAt: '2026-09-02T00:00:00Z',
    days: [],
    quality: passedQuality,
  })
  await repo.appendMessage(plan.id, 'human', { role: 'user', content: '改一下第二天的顺序' })
  return plan.id
}

function observedStageRepo(repo: MemoryTripPlanRepo, order: string[]): TripPlanRepo {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop === 'updateStageIfActive') {
        return async (planId: string, token: string, stage: string) => {
          order.push(`updateStageIfActive:${token}:${stage}`)
          return target.updateStageIfActive(planId, token, stage)
        }
      }
      if (prop === 'updateStage') {
        return async (planId: string, stage: string) => {
          order.push(`updateStage:${stage}`)
          return target.updateStage(planId, stage)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

describe('CUT-6：阶段缓存写在首次 createMessage 被调用之后才发起', () => {
  it('持有 token：dispatch 晚于 createMessage 调用、写值与旧实现相同；run 期间不发起写', async () => {
    const repo = new MemoryTripPlanRepo()
    const planId = await seedRevisePlan(repo)
    const begin = await repo.beginAgentRun({
      planId, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: 60_000, content: null,
    })
    if (begin.status !== 'ok') throw new Error('unreachable')

    const order: string[] = []
    const tasks: Array<() => Promise<unknown>> = []
    const createMessage = vi.fn(async (_params: unknown) => {
      order.push('createMessage')
      return assistantMessage({ content: '收到' })
    })
    await runPlanAgent(
      {
        createMessage,
        repo: observedStageRepo(repo, order),
        planId,
        toolDeps: { planId, repo, points: finder },
        userMessagePersisted: true,
        runToken: begin.token,
        runInBackground: (task) => {
          order.push('dispatch')
          tasks.push(task)
        },
      },
      '（继续）',
      () => {},
    )

    // 发起时刻：首次模型调用之后（拿到 promise、await 之前）
    expect(order.indexOf('createMessage')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('createMessage')).toBeLessThan(order.indexOf('dispatch'))
    // run 期间（任务执行前）没有发起任何 stage 写——不再阻塞关键路径
    expect(order.filter((e) => e.startsWith('updateStage'))).toEqual([])
    // 执行后台任务：走带栅栏的 updateStageIfActive，写值 = 推断出的 revise
    await Promise.all(tasks.map((t) => t()))
    expect(order.filter((e) => e.startsWith('updateStage'))).toEqual([`updateStageIfActive:${begin.token}:revise`])
    expect((await repo.getPlan(planId))?.stage).toBe('revise')
  })

  it('首次模型调用抛错（网络错误）时这次写仍然发起了——挂在 resolve 之后做不到', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: 60_000, content: null,
    })
    if (begin.status !== 'ok') throw new Error('unreachable')

    const order: string[] = []
    const tasks: Array<() => Promise<unknown>> = []
    const createMessage = vi.fn(async () => {
      order.push('createMessage')
      throw new Error('rate limited')
    })
    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage,
        repo: observedStageRepo(repo, order),
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        userMessagePersisted: true,
        runToken: begin.token,
        runInBackground: (task) => {
          order.push('dispatch')
          tasks.push(task)
        },
      },
      'hi',
      (e) => events.push(e),
    )
    expect(events.some((e) => e.type === 'error')).toBe(true)
    expect(tasks).toHaveLength(1)
    await tasks[0]!()
    expect((await repo.getPlan(plan.id))?.stage).toBe('works')
  })

  it('token 已被接管：仍走 updateStageIfActive（带旧 token 发起），但影响 0 行、不覆写新 run 的 stage', async () => {
    const repo = new MemoryTripPlanRepo()
    const planId = await seedRevisePlan(repo)
    const stale = await repo.beginAgentRun({
      planId, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: -1000, content: null,
    })
    if (stale.status !== 'ok') throw new Error('unreachable')
    const takeover = await repo.beginAgentRun({
      planId, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: 60_000, content: null,
    })
    if (takeover.status !== 'ok') throw new Error('unreachable')

    const order: string[] = []
    const tasks: Array<() => Promise<unknown>> = []
    const createMessage = vi.fn(async (_params: unknown) => {
      order.push('createMessage')
      return assistantMessage({ content: '来晚了' })
    })
    await runPlanAgent(
      {
        createMessage,
        repo: observedStageRepo(repo, order),
        planId,
        toolDeps: { planId, repo, points: finder },
        userMessagePersisted: true,
        runToken: stale.token,
        runInBackground: (task) => {
          order.push('dispatch')
          tasks.push(task)
        },
      },
      '（继续）',
      () => {},
    )
    await Promise.all(tasks.map((t) => t()))
    // 带旧 token 发起了栅栏写，但 0 行命中——stage 保持 null（未被覆写成 revise）
    expect(order.filter((e) => e.startsWith('updateStage'))).toEqual([`updateStageIfActive:${stale.token}:revise`])
    expect((await repo.getPlan(planId))?.stage).toBeNull()
  })

  it('无 runToken（单测/旧调用路径）：仍走无栅栏的 updateStage', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const order: string[] = []
    const tasks: Array<() => Promise<unknown>> = []
    const createMessage = vi.fn(async (_params: unknown) => {
      order.push('createMessage')
      return assistantMessage({ content: '收到' })
    })
    await runPlanAgent(
      {
        createMessage,
        repo: observedStageRepo(repo, order),
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        runInBackground: (task) => {
          order.push('dispatch')
          tasks.push(task)
        },
      },
      'hi',
      () => {},
    )
    await Promise.all(tasks.map((t) => t()))
    expect(order.filter((e) => e.startsWith('updateStage'))).toEqual(['updateStage:works'])
    expect((await repo.getPlan(plan.id))?.stage).toBe('works')
  })
})
