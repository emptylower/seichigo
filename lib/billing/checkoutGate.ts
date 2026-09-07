/** F2：结账开关与付费意向 source 归一化（Creem 审核期生产不开放订阅） */

/** 意向来源白名单；unknown 为非法/缺省兜底 */
export const INTENT_SOURCES = ['pricing', 'profile', 'hint', 'usage', 'unknown'] as const

export type IntentSource = (typeof INTENT_SOURCES)[number]

/** `BILLING_CHECKOUT_ENABLED === '1'` 才走结账；env 可注入便于测试（ProcessEnv 只有索引签名） */
export function isCheckoutEnabled(env: Readonly<Record<string, unknown>> = process.env): boolean {
  return env.BILLING_CHECKOUT_ENABLED === '1'
}

/** 未知来源/非字符串一律归 'unknown'（入库前归一，管理端按 source 聚合不受脏数据影响） */
export function normalizeIntentSource(value: unknown): IntentSource {
  return typeof value === 'string' && (INTENT_SOURCES as readonly string[]).includes(value)
    ? (value as IntentSource)
    : 'unknown'
}
