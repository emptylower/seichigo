import type OpenAI from 'openai'

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam

/**
 * A4 补充：发给模型的历史清洗（2026-09-04 主会话实测）。
 *
 * 官方 Gemini 的 OpenAI 兼容层会把 assistant `tool_calls[].function.arguments`
 * 解析成结构化 `functionCall.args`，遇到 DeepSeek 时期被输出长度截断的非法
 * JSON 会直接 400 INVALID_ARGUMENT 拒掉整个请求（DeepSeek/freecode 原样
 * 透传所以从不报错）。因此每次组装模型请求时都要过一遍本函数：
 *
 * 1. 非法 JSON 的 arguments 替换为占位符（保留 id/name，后续 tool 回执仍能
 *    配对；原文不再发给模型——工具层的错误回复已经说明情况）。
 * 2. 剥掉消息上模型协议不认识的额外字段（answerTo/answerValue 等落库元数
 *    据），只保留 role/content/tool_calls/tool_call_id/name/reasoning_content。
 *
 * 纯函数：不改数据库里的消息，也不改传入数组本身。
 */
export const INVALID_TOOL_ARGUMENTS_PLACEHOLDER = '{"_invalid_arguments":true}'

const ALLOWED_MESSAGE_KEYS = new Set([
  'role',
  'content',
  'tool_calls',
  'tool_call_id',
  'name',
  'reasoning_content',
])

function isParsableJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

export function sanitizeHistoryForModel(messages: ChatMessageParam[]): ChatMessageParam[] {
  return messages.map((message) => {
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(message)) {
      if (ALLOWED_MESSAGE_KEYS.has(key)) cleaned[key] = value
    }
    if (message.role === 'assistant' && 'tool_calls' in message && Array.isArray(message.tool_calls)) {
      cleaned.tool_calls = message.tool_calls.map((call) => {
        if (call.type !== 'function') return call
        const args = call.function?.arguments
        if (typeof args === 'string' && !isParsableJson(args)) {
          return { ...call, function: { ...call.function, arguments: INVALID_TOOL_ARGUMENTS_PLACEHOLDER } }
        }
        return call
      })
    }
    return cleaned as unknown as ChatMessageParam
  })
}
