import type { LlmModelConfig, LlmProtocol, LlmProviderView } from './types'

/**
 * 数据库行形状：包含 apiKeyCiphertext，只在 lib/llm 内部流转，
 * 绝不进入 API 响应（对外一律经 toProviderView 剥离）。
 */
export type LlmProviderRow = {
  id: string
  name: string
  protocol: string
  /** 用户输入的接口地址（可为基地址）；旧行为 null，视图层回落到 endpointUrl */
  baseUrl: string | null
  endpointUrl: string
  apiKeyCiphertext: string | null
  apiKeyHint: string | null
  models: LlmModelConfig[]
  takeoverAgent: boolean
  takeoverTranslation: boolean
  agentModel: string | null
  translationModel: string | null
  source: string
  envKey: string | null
  enabled: boolean
  lastTest: unknown
  createdAt: Date
  updatedAt: Date
}

export type LlmProviderCreateInput = {
  name: string
  protocol: string
  baseUrl?: string | null
  endpointUrl: string
  apiKeyCiphertext: string | null
  apiKeyHint: string | null
  models: LlmModelConfig[]
  takeoverAgent?: boolean
  takeoverTranslation?: boolean
  agentModel?: string | null
  translationModel?: string | null
  source?: string
  envKey?: string | null
  enabled?: boolean
}

export type LlmProviderPatch = Partial<Omit<LlmProviderCreateInput, 'envKey' | 'source'>> & {
  lastTest?: unknown
}

export type LlmLastTest = {
  model: string
  ok: boolean
  latencyMs: number | null
  message: string | null
  testedAt: string
}

export type LlmProviderRepo = {
  list(): Promise<LlmProviderRow[]>
  get(id: string): Promise<LlmProviderRow | null>
  create(input: LlmProviderCreateInput): Promise<LlmProviderRow>
  update(id: string, patch: LlmProviderPatch): Promise<LlmProviderRow | null>
  delete(id: string): Promise<boolean>
  /** 把 scope 范围内除 exceptId 外所有供应商的接管位清成 false，返回受影响行数。 */
  clearTakeover(scope: 'agent' | 'translation', exceptId: string): Promise<number>
  setLastTest(id: string, result: LlmLastTest): Promise<LlmProviderRow | null>
}

function asModelConfigs(value: unknown): LlmModelConfig[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is LlmModelConfig =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as LlmModelConfig).name === 'string' &&
      typeof (item as LlmModelConfig).contextLength === 'number',
  )
}

function asLastTest(value: unknown): LlmLastTest | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<LlmLastTest>
  if (typeof raw.model !== 'string' || typeof raw.ok !== 'boolean') return null
  return {
    model: raw.model,
    ok: raw.ok,
    latencyMs: typeof raw.latencyMs === 'number' ? raw.latencyMs : null,
    message: typeof raw.message === 'string' ? raw.message : null,
    testedAt: typeof raw.testedAt === 'string' ? raw.testedAt : new Date(0).toISOString(),
  }
}

/** 行 → 前端视图：剥掉密文，补 hasApiKey，Date 转 ISO 字符串。 */
export function toProviderView(row: LlmProviderRow): LlmProviderView {
  return {
    id: row.id,
    name: row.name,
    protocol: (row.protocol === 'anthropic' ? 'anthropic' : 'openai') as LlmProtocol,
    baseUrl: row.baseUrl ?? row.endpointUrl,
    endpointUrl: row.endpointUrl,
    apiKeyHint: row.apiKeyHint ?? null,
    hasApiKey: Boolean(row.apiKeyCiphertext),
    models: row.models,
    takeover: { agent: row.takeoverAgent, translation: row.takeoverTranslation },
    agentModel: row.agentModel ?? null,
    translationModel: row.translationModel ?? null,
    source: row.source === 'env' ? 'env' : 'custom',
    enabled: row.enabled,
    lastTest: asLastTest(row.lastTest),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export { asModelConfigs }
