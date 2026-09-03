import type { LlmModelConfig, LlmProtocol } from './types'

export type ProviderFormValues = {
  name: string
  protocol: LlmProtocol
  endpointUrl: string
  apiKey: string
  enabled: boolean
  models: LlmModelConfig[]
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

  const endpointUrl = values.endpointUrl.trim()
  if (endpointUrl.length > 500) return '请求 URL 长度不能超过 500 字'
  let parsed: URL
  try {
    parsed = new URL(endpointUrl)
  } catch {
    return '请求 URL 必须是以 https:// 开头的完整 URL'
  }
  if (parsed.protocol !== 'https:') return '请求 URL 必须使用 https://'
  if (isPrivateHost(parsed.hostname)) return '请求 URL 不允许指向内网或本机地址'

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
