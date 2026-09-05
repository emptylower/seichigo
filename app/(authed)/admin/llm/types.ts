// §0 A/B 契约：管理端 LLM 供应商视图（绝不含明文 key）
export type LlmProtocol = 'openai' | 'anthropic'

export type LlmModelConfig = {
  name: string
  contextLength: number
  maxOutputTokens?: number | null
}

export type LlmProviderView = {
  id: string
  name: string
  protocol: LlmProtocol
  /** §0.3：用户输入的基地址（可为 https://host/v1 形态） */
  baseUrl: string
  /** §0.3：服务端归一后的完整请求 URL（只读展示） */
  endpointUrl: string
  apiKeyHint: string | null
  hasApiKey: boolean
  models: LlmModelConfig[]
  takeover: { agent: boolean; translation: boolean }
  agentModel: string | null
  translationModel: string | null
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

export type LlmEffectiveScope = { providerId: string; model: string } | null

export type LlmProvidersResponse = {
  ok: true
  providers: LlmProviderView[]
  effective: { agent: LlmEffectiveScope; translation: LlmEffectiveScope }
}

export type LlmTestResult = {
  ok: boolean
  latencyMs: number | null
  message: string | null
  sample?: string | null
}
