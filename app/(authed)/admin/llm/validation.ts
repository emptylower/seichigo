import type { LlmModelConfig, LlmProtocol } from './types'

export type ProviderFormValues = {
  name: string
  protocol: LlmProtocol
  /** 用户输入的基地址（服务端按 §0.3 归一成完整请求 URL） */
  baseUrl: string
  apiKey: string
  enabled: boolean
  models: LlmModelConfig[]
}

/**
 * 与服务端 A4 同规则的 endpoint 归一（新建态本地预览用）：
 * openai：已是 /chat/completions → 原样；以 /v1 结尾 → 补 /chat/completions；
 * 其他 → 补 /v1/chat/completions。anthropic 同理（/messages）。保留 query。
 */
export function normalizeEndpointUrl(protocol: LlmProtocol, baseUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(baseUrl.trim())
  } catch {
    return baseUrl.trim()
  }
  const path = parsed.pathname.replace(/\/+$/, '')
  if (protocol === 'openai') {
    parsed.pathname = path.endsWith('/chat/completions')
      ? path
      : path.endsWith('/v1')
        ? `${path}/chat/completions`
        : `${path}/v1/chat/completions`
  } else {
    parsed.pathname = path.endsWith('/messages')
      ? path
      : path.endsWith('/v1')
        ? `${path}/messages`
        : `${path}/v1/messages`
  }
  return parsed.toString()
}

function isPrivateHost(hostname: string): boolean {
  let host = hostname.trim().toLowerCase()
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  if (host.startsWith('fe80:') || host.startsWith('fec0:')) return true
  if (/^[0-9.]+$/.test(host)) {
    const parts = host.split('.').map((part) => Number(part))
    if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      const [a, b] = parts
      if (a === 0 || a === 10 || a === 127) return true
      if (a === 169 && b === 254) return true
      if (a === 192 && b === 168) return true
      if (a === 172 && b >= 16 && b <= 31) return true
    }
  }
  return false
}

/** 与 §0 校验规则一致的前端即时校验；返回错误文案，合法时返回 null。 */
export function validateProviderValues(values: ProviderFormValues, mode: 'create' | 'edit'): string | null {
  const name = values.name.trim()
  if (name.length < 1 || name.length > 60) return '供应商名称需为 1–60 字'

  const baseUrl = values.baseUrl.trim()
  if (baseUrl.length > 500) return '接口地址长度不能超过 500 字'
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return '接口地址必须是以 https:// 开头的完整 URL'
  }
  if (parsed.protocol !== 'https:') return '接口地址必须使用 https://'
  if (isPrivateHost(parsed.hostname)) return '接口地址不允许指向内网或本机地址'

  if (mode === 'create' && !values.apiKey.trim()) return '请填写 API key'

  const models = values.models
  if (models.length < 1 || models.length > 20) return '模型数量需为 1–20 个'
  const seen = new Set<string>()
  for (const model of models) {
    const modelName = model.name.trim()
    if (modelName.length < 1 || modelName.length > 100) return '模型名称需为 1–100 字'
    if (seen.has(modelName)) return '模型名称不能重复'
    seen.add(modelName)
    if (!Number.isInteger(model.contextLength) || model.contextLength < 1000 || model.contextLength > 10_000_000) {
      return '上下文长度需为 1000–10000000 的整数'
    }
    if (model.maxOutputTokens !== null && model.maxOutputTokens !== undefined) {
      if (!Number.isInteger(model.maxOutputTokens) || model.maxOutputTokens < 256 || model.maxOutputTokens > 1_000_000) {
        return '最大输出需为 256–1000000 的整数'
      }
    }
  }
  return null
}
