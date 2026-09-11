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
 */

/** 与 PlanAgentWorkerEnv 一致的结构子集（DO 派发不需要队列绑定） */
export type PlanRunDispatcherEnv = {
  WORKER_SELF_REFERENCE: PlanAgentFetcher
  PLAN_AGENT_INTERNAL_SECRET: string
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
   */
  async alarm(): Promise<void> {
    const payload = await this.doStorage.get<PlanAgentQueueMessage>('payload')
    if (payload === undefined) return
    const state =
      (await this.doStorage.get<DispatcherState>('state')) ?? { acceptedAt: Date.now(), attempts: 0 }
    const attempts = state.attempts + 1
    await this.doStorage.put('state', { ...state, attempts })

    try {
      const res = await this.doEnv.WORKER_SELF_REFERENCE.fetch(INTERNAL_RUN_URL, {
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
}
