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

export const createChatCompletion: CreateMessageFn = async ({ messages, tools }) => {
  const completion = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 8000,
    messages,
    tools,
  })
  const message = completion.choices[0]?.message
  if (!message) throw new Error('模型未返回消息')
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
