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
