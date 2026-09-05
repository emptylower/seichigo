/**
 * A2 补充：Gemini 官方 OpenAI 兼容端点的思考回显适配（2026-09-04 实测）。
 *
 * generativelanguage.googleapis.com 的 /v1beta/openai 兼容层只有在请求体带
 * `extra_body.google.thinking_config.include_thoughts` 时才回传思考摘要
 * （摘要作为普通 content 增量、同 chunk 带 extra_content.google.thought === true、
 * 文本包在 <thought>…</thought> 里，先思考后正文）。注意：
 * - 不能与 reasoning_effort 同传（同传 400），这里也不指定 thinking_level，
 *   沿用模型默认；
 * - 中转端点（如 404gemini / freecode）会把 extra_content 整个剥掉且不识别
 *   extra_body，因此只对 Google 官方 host 精确追加，其它 host 一律不加。
 */

export const GOOGLE_GEMINI_OPENAI_HOST = 'generativelanguage.googleapis.com'

/** host 精确等于 Google 官方 OpenAI 兼容端点（suffix 域名不算，防绕过）。 */
export function isGoogleGeminiOpenAiEndpoint(endpointUrl: string): boolean {
  try {
    return new URL(endpointUrl).host === GOOGLE_GEMINI_OPENAI_HOST
  } catch {
    return false
  }
}

/** streamChat 请求体追加的思考回显开关（不带 thinking_level，沿用模型默认）。 */
export const GEMINI_THINKING_EXTRA_BODY = {
  google: { thinking_config: { include_thoughts: true } },
} as const
