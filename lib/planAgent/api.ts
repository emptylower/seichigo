import OpenAI from 'openai'
import type { CreateMessageFn } from './loop'

const MODEL = process.env.PLAN_AGENT_MODEL || 'deepseek-v4-flash'
const BASE_URL = process.env.PLAN_AGENT_BASE_URL || 'https://api.deepseek.com'

let cachedClient: OpenAI | null = null

function getClient(): OpenAI {
  if (!cachedClient) {
    if (!process.env.PLAN_AGENT_API_KEY) {
      throw new Error('PLAN_AGENT_API_KEY 未配置')
    }
    cachedClient = new OpenAI({ apiKey: process.env.PLAN_AGENT_API_KEY, baseURL: BASE_URL })
  }
  return cachedClient
}

/**
 * DeepSeek 推理模型的非标准扩展字段：流式时挂在 chunk 的 delta 上、非流式时挂在
 * message 上，OpenAI SDK 类型均未声明。收敛到这一个断言点，其余代码只读它。
 */
type WithReasoningContent = { reasoning_content?: string | null }

function extractReasoningDelta(delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta): string {
  const value = (delta as WithReasoningContent).reasoning_content
  return typeof value === 'string' ? value : ''
}

type AccumulatedToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/**
 * 流式版模型调用：按 OpenAI 流式协议增量累积 content 与 tool_calls（tool_calls
 * 按 index 归并，function.arguments 是需要拼接的 JSON 字符串片段），并透传
 * DeepSeek 的 reasoning_content 增量给 onDelta。返回累积重建后的完整 message，
 * 形状与非流式响应一致（reasoning_content 同样附在返回值上，由调用方决定去留）。
 */
export const createChatCompletion: CreateMessageFn = async ({ messages, tools }, onDelta) => {
  const stream = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 8000,
    messages,
    tools,
    stream: true,
  })

  let content = ''
  let reasoning = ''
  const toolCalls = new Map<number, AccumulatedToolCall>()

  for await (const chunk of stream) {
    const choice = chunk.choices[0]
    if (!choice) continue
    const delta = choice.delta

    const reasoningDelta = extractReasoningDelta(delta)
    if (reasoningDelta) {
      reasoning += reasoningDelta
      onDelta?.({ reasoning: reasoningDelta })
    }

    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content
      onDelta?.({ content: delta.content })
    }

    for (const part of delta.tool_calls ?? []) {
      const existing = toolCalls.get(part.index)
      if (!existing) {
        toolCalls.set(part.index, {
          id: part.id ?? '',
          type: 'function',
          function: {
            name: part.function?.name ?? '',
            arguments: part.function?.arguments ?? '',
          },
        })
      } else {
        if (part.id) existing.id = part.id
        if (part.function?.name) existing.function.name = part.function.name
        if (part.function?.arguments) existing.function.arguments += part.function.arguments
      }
    }
  }

  const rebuiltToolCalls = [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
  // 镜像 DeepSeek 非流式响应里 message 自带 reasoning_content 的形状；loop
  // 落库/回传历史时本来就只保留协议字段，不会把它写进 TripPlanMessage
  const message: OpenAI.Chat.Completions.ChatCompletionMessage & { reasoning_content?: string } = {
    role: 'assistant',
    content: content || null,
    refusal: null,
    ...(rebuiltToolCalls.length ? { tool_calls: rebuiltToolCalls } : {}),
    ...(reasoning ? { reasoning_content: reasoning } : {}),
  }
  return message
}

/**
 * 标题侧信道的独立轻量调用：无工具、小 max_tokens，与主 agent loop 并行。
 * 注意 PLAN_AGENT_MODEL 是推理模型，reasoning 也要消耗 completion 预算
 * （实测一个标题约耗 400+ reasoning tokens），额度太小会导致 content 为空。
 * 返回 null 表示这次没有可用标题（内容缺失或清洗后为空）。
 */
export async function generatePlanTitle(userMessage: string, signal?: AbortSignal): Promise<string | null> {
  const completion = await getClient().chat.completions.create(
    {
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content:
            '根据用户的巡礼规划请求生成不超过 12 字的计划标题，只输出标题文字本身，不要引号，不要以标点符号结尾。',
        },
        { role: 'user', content: userMessage.slice(0, 500) },
      ],
    },
    signal ? { signal } : undefined,
  )
  const text = completion.choices[0]?.message?.content
  if (typeof text !== 'string') return null
  const cleaned = text
    .trim()
    .replace(/^["'“”«»《]+/, '')
    .replace(/["'“”«»》.。!！?？,，、;；:：~～-]+$/, '')
    .trim()
  if (!cleaned) return null
  return cleaned.slice(0, 80)
}
