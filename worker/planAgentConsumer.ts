// 相对路径导入：wrangler 打包 worker 入口时走 esbuild 自身的模块解析，
// 不认 Next 的路径别名（@/* 只在 Next / Vitest 侧生效）
import { isPlanAgentQueueMessage, type PlanAgentQueueMessage } from '../lib/planAgent/queueMessage'

/**
 * 2026-09-06 §0.1：规划 run 的队列消费者。
 *
 * 本文件不引入任何 @/ 应用代码（queueMessage.ts 是零依赖的纯类型 + 校验
 * 模块，见 §0.2）——避免把 Prisma/Next 再打包一遍进 worker 入口。执行走
 * 自引用服务绑定回调 Next 内部路由，由内部路由里的 executePlanAgentRun
 * 跑循环；消费者只负责投递与确认。
 */

/** 自引用服务绑定（Workers Fetcher 的结构子集；项目未装 workers-types，就地声明） */
export type PlanAgentFetcher = {
  fetch(input: string | URL | globalThis.Request, init?: RequestInit): Promise<globalThis.Response>
}

/** 队列生产者绑定（结构子集） */
export type PlanAgentQueueProducer = {
  send(message: PlanAgentQueueMessage): Promise<void>
}

export type PlanAgentWorkerEnv = {
  WORKER_SELF_REFERENCE: PlanAgentFetcher
  PLAN_AGENT_INTERNAL_SECRET: string
  PLAN_AGENT_QUEUE: PlanAgentQueueProducer
}

/** MessageBatch<Message> 的结构子集：消费者只需要 body 与 ack */
export type PlanAgentQueueEnvelope = {
  body: unknown
  ack(): void
  retry(): void
}

export type PlanAgentMessageBatch = {
  messages: PlanAgentQueueEnvelope[]
}

/** ExportedHandler<Env> 的结构子集（fetch/queue 两个入口足够） */
export type PlanAgentExportedHandler<Env> = {
  fetch?: (request: globalThis.Request, env: Env, ctx: unknown) => Promise<globalThis.Response> | globalThis.Response
  queue?: (batch: PlanAgentMessageBatch, env: Env, ctx: unknown) => Promise<void> | void
}

const INTERNAL_RUN_URL = 'https://seichigo.com/api/internal/plan-agent/run'

/** 读响应体到底：内部路由用心跳流保持连接，消费者必须等它自然结束 */
async function drainBody(res: globalThis.Response): Promise<void> {
  const body = res.body
  if (!body) return
  const reader = body.getReader()
  try {
    while (true) {
      const { done } = await reader.read()
      if (done) return
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * 每条消息：校验 body → 经 WORKER_SELF_REFERENCE POST 内部路由 → 读响应体
 * 到底 → ack。任何异常 console.error 后仍 ack——不重试（max_retries: 0，
 * 见 wrangler.jsonc）：消费者被平台硬杀后的续跑交给现有"悬空 run → 续跑"
 * 路径，避免同一回合跑两遍。
 */
export async function consumePlanAgentBatch(batch: PlanAgentMessageBatch, env: PlanAgentWorkerEnv): Promise<void> {
  for (const message of batch.messages) {
    try {
      if (!isPlanAgentQueueMessage(message.body)) {
        console.error('[worker/planAgentConsumer] 非法队列消息，已丢弃', message.body)
      } else {
        const res = await env.WORKER_SELF_REFERENCE.fetch(INTERNAL_RUN_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-plan-agent-secret': env.PLAN_AGENT_INTERNAL_SECRET,
          },
          body: JSON.stringify(message.body),
        })
        await drainBody(res)
      }
    } catch (err) {
      console.error('[worker/planAgentConsumer] plan agent run 执行失败', err)
    }
    message.ack()
  }
}
