/**
 * 模型 token 用量的统一口径（设计 §7.1）。四个字段全部是 token 数：
 * - inputMiss：未命中缓存的输入（含 Anthropic 的 cache_creation）
 * - inputCacheHit：命中缓存的输入
 * - output：输出总量（含 reasoning）
 * - reasoning：输出里属于推理过程的部分（仅供分析，计价已含在 output 内）
 */
export type LlmUsage = {
  inputMiss: number
  inputCacheHit: number
  output: number
  reasoning: number
}

export const EMPTY_USAGE: LlmUsage = { inputMiss: 0, inputCacheHit: 0, output: 0, reasoning: 0 }

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputMiss: a.inputMiss + b.inputMiss,
    inputCacheHit: a.inputCacheHit + b.inputCacheHit,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * OpenAI 兼容协议的 usage：DeepSeek 在顶层给 prompt_cache_hit_tokens /
 * prompt_cache_miss_tokens，OpenAI 官方给 prompt_tokens_details.cached_tokens。
 * prompt_tokens 与 completion_tokens 缺失或非数字 → null（调用方记 usageMissing）。
 */
export function parseOpenAiUsage(raw: unknown): LlmUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  const prompt = num(u.prompt_tokens)
  const completion = num(u.completion_tokens)
  if (prompt === null || completion === null) return null
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>
  const completionDetails = (u.completion_tokens_details ?? {}) as Record<string, unknown>
  const hit = num(u.prompt_cache_hit_tokens) ?? num(details.cached_tokens) ?? 0
  const miss = num(u.prompt_cache_miss_tokens) ?? Math.max(0, prompt - hit)
  return {
    inputMiss: miss,
    inputCacheHit: hit,
    output: completion,
    reasoning: num(completionDetails.reasoning_tokens) ?? 0,
  }
}

export type AnthropicStartUsage = {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}
export type AnthropicDeltaUsage = { output_tokens?: number }

/** Anthropic：message_start 带输入侧，message_delta 带输出侧；两者都没有 → null。 */
export function parseAnthropicUsage(
  start: AnthropicStartUsage | undefined,
  delta: AnthropicDeltaUsage | undefined,
): LlmUsage | null {
  if (!start && !delta) return null
  return {
    inputMiss: (num(start?.input_tokens) ?? 0) + (num(start?.cache_creation_input_tokens) ?? 0),
    inputCacheHit: num(start?.cache_read_input_tokens) ?? 0,
    output: num(delta?.output_tokens) ?? 0,
    reasoning: 0,
  }
}

const USAGE_KEY = 'llm_usage'

/**
 * 把 usage 以不可枚举属性挂到返回消息上（与 lib/planAgent/api.ts 的
 * provider 同一手法）：任何 JSON 序列化路径都不会把它带进 TripPlanMessage。
 */
export function attachLlmUsage<T extends object>(message: T, usage: LlmUsage): T {
  Object.defineProperty(message, USAGE_KEY, {
    value: usage,
    enumerable: false,
    writable: false,
    configurable: true,
  })
  return message
}

export function llmUsageOf(message: object | null | undefined): LlmUsage | null {
  if (!message) return null
  const value = (message as Record<string, unknown>)[USAGE_KEY]
  return value && typeof value === 'object' ? (value as LlmUsage) : null
}
