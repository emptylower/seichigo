/**
 * 2026-09-06 §0.2：规划 run 的队列消息类型。
 *
 * 本文件是纯类型 + 校验函数，**不 import 任何其它模块**——worker/ 目录的
 * 消费者要引用它做逐字段校验，不能因此把 Prisma/Next 应用代码打包进
 * worker 入口。类型需要演进时只加可选字段并保持 v 不变（消费者按字段容错）。
 */

/**
 * 与 lib/i18n/types 的 SupportedLocale 同构的字面量联合：为满足"零 import"
 * 约束在此重复声明；两处口径变更时必须同步（zh/en/ja）。
 */
type QueueSupportedLocale = 'zh' | 'en' | 'ja'

/**
 * 与 lib/billing/tiers 的 Tier 同构的字面量联合：为满足"零 import"约束
 * 在此重复声明；两处口径变更时必须同步（free/standard/pro）。
 */
type QueueTier = 'free' | 'standard' | 'pro'

export type PlanAgentQueueMessage = {
  v: 1
  planId: string
  runToken: string
  locale: QueueSupportedLocale
  /** 普通轮/答复轮的用户原文（循环输入 + 标题侧信道）；续跑轮为 null */
  message: string | null
  resume: boolean
  enqueuedAt: string
  /**
   * 授权本次 run 的档位快照——POST 时刻 getAccount 得到的**有效 tier**
   * （已含 F2 降档），**不是消费时刻的档位**。缺失或无法识别时，消费者
   * 必须回落到 getAccount 三读，绝不能回落 free。
   */
  tier?: QueueTier
  /**
   * P0-B（2026-09-11）：首次派发时刻（POST 成功同步预扣后、投递/内联启动
   * 前取一次）。消费者用它把软截止从派发而非入口起算。校验策略与 tier
   * 的"完全不校验"不同：dispatchedAt 参与软截止计算，存在但非法（非
   * 字符串 / Date.parse 为 NaN）会把 deadline 算错，必须拒；缺省放行
   * （滚动部署窗口内在途消息没有这个字段，沿用入口起算）。
   */
  dispatchedAt?: string
}

const LOCALES: readonly string[] = ['zh', 'en', 'ja']

/**
 * 逐字段校验：消费者与内部路由共用，畸形消息（队列投毒、版本演进后的
 * 旧格式）在入口就被拒掉，绝不进执行器。
 */
export function isPlanAgentQueueMessage(value: unknown): value is PlanAgentQueueMessage {
  if (typeof value !== 'object' || value === null) return false
  const msg = value as Record<string, unknown>
  return (
    msg.v === 1 &&
    typeof msg.planId === 'string' &&
    msg.planId.length > 0 &&
    typeof msg.runToken === 'string' &&
    msg.runToken.length > 0 &&
    typeof msg.locale === 'string' &&
    LOCALES.includes(msg.locale) &&
    (msg.message === null || typeof msg.message === 'string') &&
    typeof msg.resume === 'boolean' &&
    typeof msg.enqueuedAt === 'string' &&
    msg.enqueuedAt.length > 0 &&
    // dispatchedAt：缺省放行（在途旧消息）；存在则必须是可解析的时间戳
    // （参与软截止计算，见类型注释）
    (msg.dispatchedAt === undefined ||
      (typeof msg.dispatchedAt === 'string' && Number.isFinite(Date.parse(msg.dispatchedAt))))
  )
}
