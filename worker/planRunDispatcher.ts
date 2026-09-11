/// <reference path="./cloudflare-workers.d.ts" />
// 相对路径导入：wrangler 打包 worker 入口时走 esbuild 自身的模块解析，
// 不认 Next 的路径别名（@/* 只在 Next / Vitest 侧生效）
import { DurableObject } from 'cloudflare:workers'
import { isPlanAgentQueueMessage, type PlanAgentQueueMessage } from '../lib/planAgent/queueMessage'
import { drainBody } from './drainResponse'
import type { PlanAgentFetcher } from './planAgentConsumer'

/**
 * Phase 1-A（2026-09-11 联合方案 §1）：per-run Durable Object alarm 派发器。
 *
 * 每个 runToken 一个 DO 实例（binding 侧 idFromName(runToken)）：POST 路由经
 * binding fetch 进来 → storage 持久接纳 + setAlarm(now) → alarm 里做的事与
 * worker/planAgentConsumer.ts 一字不差（自引用服务绑定回调内部路由并读响应
 * 体到底）——把队列派发的 2.8–7.3s 换成 DO alarm 的亚秒级调度，执行体一行
 * 不改。默认关（PLAN_AGENT_DISPATCH=queue），白名单 canary 灰度。
 *
 * 本文件与 planAgentConsumer 同策略：不 import 任何 @/ 应用代码（仅
 * queueMessage 纯类型模块 + worker/ 内共用件），避免把 Prisma/Next 再打包
 * 一遍进 worker 入口。
 *
 * Phase 1.1（2026-09-11 P1_1 受控实验，默认关）：PLAN_AGENT_DO_LOCAL=1 时
 * alarm 改为本 isolate 直调 worker/entry.ts 注册进来的 OpenNext 默认
 * handler——省掉 WORKER_SELF_REFERENCE 服务绑定打到冷 Next isolate 的那一跳
 *（canary 实测 0.55–1.09s）。注入点在模块求值期（DO alarm 可能在从未跑过
 * HTTP fetch 的 isolate 上启动），dispatcher 只保存 handler 本身，不捕获
 * env/ctx；本地路径同样不 import .open-next/**（handler 由 entry 注入）。
 */

/** 与 PlanAgentWorkerEnv 一致的结构（DO 派发不需要队列绑定）。本地路径把原始完整 env 原样传给 OpenNext handler（R2/D1/Hyperdrive 等绑定缺一不可），故带字符串索引签名 */
export type PlanRunDispatcherEnv = {
  WORKER_SELF_REFERENCE: PlanAgentFetcher
  PLAN_AGENT_INTERNAL_SECRET: string
  /** P1_1 受控实验开关：'1' 时 alarm 本 isolate 直调 OpenNext handler */
  PLAN_AGENT_DO_LOCAL?: string
} & Record<string, unknown>

/** OpenNext 生成的默认 handler 的形状（.open-next/worker.js 的 default export，由 entry 注入——dispatcher 不能 import .open-next/**） */
export type OpenNextFetchHandler = {
  fetch(request: globalThis.Request, env: unknown, ctx: unknown): Promise<globalThis.Response>
}

let localHandler: OpenNextFetchHandler | null = null

/** 由 worker/entry.ts 在模块求值时注册（不在 HTTP fetch 内——DO alarm 可能在从未跑过 HTTP 的 isolate 上启动）。只保存 handler，不捕获任何 env/ctx。 */
export function registerPlanRunLocalHandler(h: OpenNextFetchHandler): void {
  localHandler = h
}

/** DurableObjectStorage 的结构子集（项目未装 workers-types，就地声明） */
export type PlanRunDispatcherStorage = {
  get<T = unknown>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  setAlarm(scheduledTime: number | Date): Promise<void>
}

export type PlanRunDispatcherCtx = {
  storage: PlanRunDispatcherStorage
}

type DispatcherState = {
  acceptedAt: number
  attempts: number
}

const INTERNAL_RUN_URL = 'https://seichigo.com/api/internal/plan-agent/run'

/** DO alarm 单次调用的 wall-clock 硬上限（与内部路由 13 分钟软截止配套的约定值） */
const ALARM_WALL_MS = 15 * 60_000

/** 本地路径后台任务（ctx 适配器收集的 waitUntil）收束上限 */
const LOCAL_TASKS_SETTLE_CAP_MS = 240_000

/**
 * 与消费者同义（C 部分埋点）：invocation 序号。workerd 的 Date.now() 在无
 * I/O 期间冻结，测不出 isolate 冷启动；seq === 1 表示本次 invocation 跑过
 * 全局作用域（冷 isolate），内部路由据此把 timing 样本切冷/热两组。
 */
let INVOCATION_SEQ = 0

export class PlanRunDispatcher extends DurableObject<PlanRunDispatcherEnv> {
  private readonly doStorage: PlanRunDispatcherStorage
  private readonly doEnv: PlanRunDispatcherEnv

  constructor(ctx: PlanRunDispatcherCtx, env: PlanRunDispatcherEnv) {
    super(ctx, env)
    this.doStorage = ctx.storage
    this.doEnv = env
  }

  /**
   * 接纳入口（只经 binding 调用，仍逐字段校验）。协议承诺：返回
   * accepted:false（rejected）时消息一定**未**被持久接纳；accepted:true 表示
   * 已落 storage 并定好 alarm。重复投递幂等（duplicate），不覆盖、不重置
   * alarm。
   */
  async fetch(request: globalThis.Request): Promise<globalThis.Response> {
    let body: unknown = undefined
    try {
      body = await request.json()
    } catch {
      body = undefined
    }
    if (!isPlanAgentQueueMessage(body)) {
      return globalThis.Response.json({ accepted: false, reason: 'invalid' }, { status: 400 })
    }
    const existing = await this.doStorage.get<PlanAgentQueueMessage>('payload')
    if (existing !== undefined) {
      return globalThis.Response.json({ accepted: true, duplicate: true })
    }
    try {
      await this.doStorage.put('payload', body)
      await this.doStorage.put('state', { acceptedAt: Date.now(), attempts: 0 })
      await this.doStorage.setAlarm(Date.now())
    } catch (err) {
      // 协议承诺"rejected ⇒ 未持久接纳"：put 之后任何一步抛错都要先回收
      await this.doStorage.delete('payload').catch(() => undefined)
      console.error('[worker/planRunDispatcher] storage write failed, refusing dispatch', err)
      return globalThis.Response.json({ accepted: false, reason: 'storage' })
    }
    return globalThis.Response.json({ accepted: true })
  }

  /**
   * 派发执行：与消费者一字不差地回调内部路由并读响应体到底。分类：
   * - 400/401/503 → 永久故障（密钥/配置/消息问题，重试无意义）：console.error
   *   + 删 payload，结束；
   * - 200 → drain 到底后删 payload（skipped/done 都算这次派发结束；业务结局
   *   看日志，不判成功）；
   * - fetch/drain 抛错或 5xx → attempts < 3 时 rethrow，让平台按官方 2s 起的
   *   指数退避重试 alarm（claim 一次性领取保证重试只会 winner 或 skipped）；
   *   attempts ≥ 3 → console.error + 删 payload。
   * payload 绝不在 fetch 之前删除。
   *
   * P1_1：PLAN_AGENT_DO_LOCAL=1 且 entry 已注册 handler 时，"回调内部路由"
   * 换成本 isolate 直调 OpenNext handler（请求头/分类完全相同，另带
   * x-plan-agent-local: 1），并在 drain 之后、删 payload 之前收束 handler
   * 经 ctx 适配器挂起的后台任务；开关开但未注册（entry 改动未生效）→
   * console.error 后走原自引用路径，payload 语义不变。
   */
  async alarm(): Promise<void> {
    const alarmStartedAt = Date.now()
    const payload = await this.doStorage.get<PlanAgentQueueMessage>('payload')
    if (payload === undefined) return
    const state =
      (await this.doStorage.get<DispatcherState>('state')) ?? { acceptedAt: Date.now(), attempts: 0 }
    const attempts = state.attempts + 1
    await this.doStorage.put('state', { ...state, attempts })

    const wantLocal = this.doEnv.PLAN_AGENT_DO_LOCAL === '1'
    if (wantLocal && localHandler === null) {
      console.error(
        '[worker/planRunDispatcher] PLAN_AGENT_DO_LOCAL=1 but no handler registered, falling back to self-reference',
      )
    }
    const handler = wantLocal ? localHandler : null

    try {
      let res: globalThis.Response
      let localTasks: Promise<unknown>[] | null = null
      if (handler !== null) {
        // ctx 用每次 alarm 独立的适配器：DO state（DurableObjectState）的
        // waitUntil 官方定义为无效，不能直接传 this.ctx，也不展开宿主对象
        const tasks: Promise<unknown>[] = []
        localTasks = tasks
        const ctxAdapter = {
          waitUntil(p: Promise<unknown>) {
            tasks.push(Promise.resolve(p).catch(() => undefined))
          },
          passThroughOnException() {},
          props: {},
        }
        // env 传原始完整对象（this.doEnv，不重建子集——OpenNext handler 需要
        // 全部绑定）。consumer-at 在调用前一刻打：本地路径下 selfRefHopMs 的
        // 语义就变成本 isolate 的初始化成本，可与旧路径对比
        res = await handler.fetch(
          new Request(INTERNAL_RUN_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-plan-agent-secret': this.doEnv.PLAN_AGENT_INTERNAL_SECRET,
              'x-plan-agent-transport': 'do',
              'x-plan-agent-local': '1',
              'x-plan-agent-consumer-at': String(Date.now()),
              'x-plan-agent-consumer-seq': String(++INVOCATION_SEQ),
            },
            body: JSON.stringify(payload),
          }),
          this.doEnv,
          ctxAdapter,
        )
      } else {
        res = await this.doEnv.WORKER_SELF_REFERENCE.fetch(INTERNAL_RUN_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-plan-agent-secret': this.doEnv.PLAN_AGENT_INTERNAL_SECRET,
            'x-plan-agent-transport': 'do',
            'x-plan-agent-consumer-at': String(Date.now()),
            'x-plan-agent-consumer-seq': String(++INVOCATION_SEQ),
          },
          body: JSON.stringify(payload),
        })
      }
      if (res.status === 400 || res.status === 401 || res.status === 503) {
        console.error('[worker/planRunDispatcher] permanent failure, dropping run', {
          status: res.status,
          runToken: payload.runToken,
        })
        await this.doStorage.delete('payload')
        return
      }
      if (res.status === 200) {
        await drainBody(res)
        if (localTasks !== null) await this.awaitLocalBackgroundTasks(localTasks, alarmStartedAt)
        await this.doStorage.delete('payload')
        return
      }
      throw new Error(`internal run responded ${res.status}`)
    } catch (err) {
      if (attempts < 3) throw err
      console.error('[worker/planRunDispatcher] attempts exhausted, dropping run', {
        runToken: payload.runToken,
        attempts,
        err,
      })
      await this.doStorage.delete('payload')
    }
  }

  /**
   * 收束本地调用挂起的后台任务（ctx 适配器收集的 waitUntil promises）：
   * drain 之后、删 payload 之前逐批 allSettled（等待期间新加入的任务下一批
   * 再等）。总上限 min(alarm 剩余 wall − 30s 缓冲, 240s)；到上限只 console.warn
   * 记录未完成数量、不抛、照常删 payload——服务绑定旧路径里这些任务在响应
   * 结束 30s 后就被平台直接砍掉，本设计只会更好，但不承诺全部完成。
   */
  private async awaitLocalBackgroundTasks(
    tasks: Promise<unknown>[],
    alarmStartedAt: number,
  ): Promise<void> {
    const budgetMs = Math.min(
      ALARM_WALL_MS - (Date.now() - alarmStartedAt) - 30_000,
      LOCAL_TASKS_SETTLE_CAP_MS,
    )
    const deadline = Date.now() + Math.max(budgetMs, 0)
    let drained = 0
    while (tasks.length > drained) {
      const batch = tasks.slice(drained)
      let timer: ReturnType<typeof setTimeout> | undefined
      const timedOut = await Promise.race([
        Promise.allSettled(batch).then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), Math.max(deadline - Date.now(), 0))
        }),
      ])
      if (timer !== undefined) clearTimeout(timer)
      if (timedOut) {
        console.warn(
          '[worker/planRunDispatcher] local background tasks not settled before deadline',
          { pending: tasks.length - drained },
        )
        return
      }
      drained += batch.length
    }
  }
}
