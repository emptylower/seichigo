import type OpenAI from 'openai'
import type { PlanAgentChatMessage } from '@/lib/planAgent/loop'

/** §0 A/B 契约类型：管理 API 响应与前端共用的数据形状（绝不含明文 key）。 */
export type LlmProtocol = 'openai' | 'anthropic'

export type LlmModelConfig = {
  name: string
  contextLength: number
  maxOutputTokens?: number | null
  /**
   * P1 价格覆盖（微美元/百万 token，peak 牌价，offPeak 由计价层减半推导）。
   * 三个字段齐全才算配置（缺任一个视为未配置，回落 lib/billing 价格表）；
   * null = 显式未设置。存在 LlmProvider.models 这个 Json 列里，无需迁移。
   */
  inputMissPerM?: number | null
  inputCacheHitPerM?: number | null
  outputPerM?: number | null
}

export type LlmProviderView = {
  id: string
  name: string
  protocol: LlmProtocol
  /** 用户输入的接口地址（可为基地址，如 https://gw.example.com/v1）；旧行回落到 endpointUrl */
  baseUrl: string
  /** 服务端归一后的完整请求 URL，如 https://api.deepseek.com/chat/completions 或 https://api.anthropic.com/v1/messages */
  endpointUrl: string
  /** 形如 "sk-…a1b2"（前 3 + 后 4），未设置为 null */
  apiKeyHint: string | null
  hasApiKey: boolean
  models: LlmModelConfig[]
  takeover: { agent: boolean; translation: boolean }
  /** takeover.agent 时使用的模型名（必须在 models 里） */
  agentModel: string | null
  translationModel: string | null
  /** env = 由环境变量内化的内置供应商（可编辑；删除后需要重新内化） */
  source: 'env' | 'custom'
  enabled: boolean
  lastTest: {
    model: string
    ok: boolean
    latencyMs: number | null
    message: string | null
    testedAt: string
  } | null
  createdAt: string
  updatedAt: string
}

/** 统一模型客户端输入：OpenAI 消息形状为内部标准（与 planAgent loop 完全兼容）。 */
export type LlmChatInput = {
  model: string
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[]
  maxTokens: number
  signal?: AbortSignal
}

export type LlmCompleteTextInput = {
  model: string
  system?: string
  prompt: string
  maxTokens: number
  /** true 时尽量要求 JSON 输出（openai: response_format；anthropic: 无原生支持，忽略） */
  json?: boolean
  temperature?: number
  signal?: AbortSignal
}

export type LlmStreamDelta = { reasoning?: string; content?: string }

export interface LlmClient {
  /** 流式；返回累积重建的 assistant 消息（含 tool_calls / reasoning_content / finish_reason） */
  streamChat(input: LlmChatInput, onDelta?: (d: LlmStreamDelta) => void): Promise<PlanAgentChatMessage>
  /** 非流式纯文本（翻译/标题用） */
  completeText(input: LlmCompleteTextInput): Promise<string>
}

export type LlmClientConfig = {
  protocol: LlmProtocol
  endpointUrl: string
  apiKey: string
  fetchImpl?: typeof fetch
}
